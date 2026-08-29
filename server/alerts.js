'use strict';

const https = require('node:https');

/**
 * Email Seb when somebody's phone breaks.
 *
 * The log already has every report (see the `/api/oops` handler), and a log
 * nobody opens is only slightly better than no log at all. This is the part that
 * reaches him without him going to look.
 *
 * **Batching is the whole design, not a refinement.** One email per error would
 * be unusable within a week and actively harmful within a month, because the
 * failure that most needs reporting - a render loop, a bad deploy - is exactly
 * the one that throws hundreds of times a minute. So errors collect quietly, one
 * message goes out a little after the first of them, and nothing else goes out
 * for a good while afterwards however much arrives. An alert you start ignoring
 * is worse than no alert, because you think you are covered.
 *
 * **It is off unless configured**, and silence is the correct behaviour when it
 * is not: the app must run perfectly well for anybody who clones it without an
 * email account, and a missing key is not an error.
 *
 *   BLOB_ALERT_EMAIL   where to send. Nothing is sent without it.
 *   BLOB_ALERT_KEY     a Resend API key (https://resend.com, free tier).
 *   BLOB_ALERT_FROM    optional sender; defaults to Resend's test address.
 *
 * The email carries exactly what the log carries and nothing more - no names, no
 * codes, no cards. See `public/errors.js` for why that boundary matters.
 */

/** How long after the first error of a batch the email goes out. */
const GATHER_MS = 2 * 60 * 1000;
/** And the quiet period afterwards, however much arrives during it. */
const COOLDOWN_MS = 30 * 60 * 1000;
/** Distinct errors listed in one email. The rest are counted, not printed. */
const LIST_MAX = 10;
/** Reports held in memory at once, so a flood cannot grow the heap. */
const BUFFER_MAX = 200;

const RESEND_URL = 'https://api.resend.com/emails';
const DEFAULT_FROM = 'Blob <onboarding@resend.dev>';

/**
 * Post JSON and forget about it.
 *
 * Never throws and never rejects: a failure to send an alert must not become a
 * second fault, and there is nothing useful to do about it on a small server
 * with no queue.
 */
function postJson(url, headers, payload, log) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (note) => {
      if (done) return;
      done = true;
      if (note) log(`[blob] could not send the alert email: ${note}`);
      resolve();
    };
    try {
      const body = Buffer.from(JSON.stringify(payload));
      const req = https.request(
        url,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Content-Length': body.length, ...headers },
          timeout: 10000,
        },
        (res) => {
          res.resume();
          res.on('end', () => finish(res.statusCode >= 300 ? `the mail service said ${res.statusCode}` : ''));
        }
      );
      req.on('error', (err) => finish(err.message));
      req.on('timeout', () => {
        req.destroy();
        finish('timed out');
      });
      req.write(body);
      req.end();
    } catch (err) {
      finish(err.message);
    }
  });
}

function summarise(reports) {
  const counts = new Map();
  for (const r of reports) {
    const key = `${r.message} (${r.where})`;
    const seen = counts.get(key) || { count: 0, first: r };
    seen.count += 1;
    counts.set(key, seen);
  }
  const ordered = [...counts.entries()].sort((a, b) => b[1].count - a[1].count);
  const lines = [];
  lines.push(`${reports.length} error${reports.length === 1 ? '' : 's'} reported from ${counts.size} distinct fault${counts.size === 1 ? '' : 's'}.`);
  lines.push('');
  for (const [key, { count, first }] of ordered.slice(0, LIST_MAX)) {
    lines.push(`${count} x  ${key}`);
    if (first.screen) lines.push(`      on: ${first.screen}${first.game ? ` (${first.game})` : ''}`);
    if (first.build) lines.push(`   build: ${first.build}`);
    if (first.stack) lines.push(`   ${first.stack.slice(0, 400)}`);
    lines.push('');
  }
  if (ordered.length > LIST_MAX) lines.push(`...and ${ordered.length - LIST_MAX} other distinct faults not listed.`);
  lines.push('');
  lines.push('Nothing else will be sent for the next half hour, however many more arrive.');
  return lines.join('\n');
}

/**
 * @param {object} deps
 * @param {(url, headers, payload) => Promise<void>} [deps.post] injected by tests
 * @param {() => number} [deps.now] injected by tests
 * @param {(msg: string) => void} [deps.log]
 * @param {object} [deps.env]
 */
function createAlerter(deps = {}) {
  const env = deps.env || process.env;
  const log = deps.log || console.error;
  const now = deps.now || Date.now;
  const to = String(env.BLOB_ALERT_EMAIL || '').trim();
  const key = String(env.BLOB_ALERT_KEY || '').trim();
  const from = String(env.BLOB_ALERT_FROM || '').trim() || DEFAULT_FROM;
  const post = deps.post || ((url, headers, payload) => postJson(url, headers, payload, log));

  const on = Boolean(to && key);
  let buffer = [];
  let timer = null;
  let quietUntil = 0;
  let suppressed = 0;

  async function flush() {
    timer = null;
    const batch = buffer;
    const missed = suppressed;
    buffer = [];
    suppressed = 0;
    if (!batch.length) return;

    // The quiet period starts whether or not the send works. A mail service
    // having a bad afternoon must not turn into a retry loop that hammers it.
    quietUntil = now() + COOLDOWN_MS;
    const subject = `Blob: ${batch.length} error${batch.length === 1 ? '' : 's'} reported`;
    let text = summarise(batch);
    if (missed) text += `\n\n(${missed} further reports arrived while this was being gathered and were counted but not kept.)`;

    // Swallowed HERE rather than at each call site, because every path into this
    // function is fire-and-forget and one of them is a timer with nobody to
    // catch for it. There is nothing useful to do about a failed alert on a
    // server with no queue, and the log still has every report.
    try {
      await post(RESEND_URL, { Authorization: `Bearer ${key}` }, { from, to: [to], subject, text });
    } catch (err) {
      log(`[blob] could not send the alert email: ${err && err.message}`);
    }
  }

  return {
    enabled: on,

    /** Note one report. Returns immediately; sending happens later. */
    record(report) {
      if (!on) return;
      // In the quiet period nothing is gathered and nothing is sent. The log
      // still has every one of them, which is the point of having both.
      if (now() < quietUntil) return;
      if (buffer.length >= BUFFER_MAX) {
        suppressed += 1;
        return;
      }
      buffer.push(report);
      if (timer) return;
      timer = setTimeout(() => {
        flush().catch(() => {});
      }, GATHER_MS);
      if (timer.unref) timer.unref();
    },

    /** For tests and for shutdown. */
    async flushNow() {
      if (timer) clearTimeout(timer);
      await flush();
    },

    stop() {
      if (timer) clearTimeout(timer);
      timer = null;
    },
  };
}

module.exports = { createAlerter, summarise, GATHER_MS, COOLDOWN_MS };
