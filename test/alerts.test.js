'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { createAlerter, summarise } = require('../server/alerts');

/**
 * The email alerter, and mostly the batching.
 *
 * The batching is the part worth testing hardest, because getting it wrong is
 * not a small bug: the failure most worth being told about - a render loop, a
 * bad deploy - is the one that throws hundreds of times a minute, and an alerter
 * that sent one email each would turn the most important signal this app has
 * into the thing Seb sets up a filter to delete. An alert you have started
 * ignoring is worse than no alert, because you believe you are covered.
 *
 * Time and the network are both injected, so none of this waits on either.
 */

function harness({ env, at = 0 } = {}) {
  const sent = [];
  let clock = at;
  const alerter = createAlerter({
    env: env || { BLOB_ALERT_EMAIL: 'seb@example.com', BLOB_ALERT_KEY: 'test-key' },
    now: () => clock,
    log: () => {},
    post: async (url, headers, payload) => {
      sent.push({ url, headers, payload });
    },
  });
  return {
    alerter,
    sent,
    advance(ms) {
      clock += ms;
    },
  };
}

test('with nothing configured it does nothing at all', async () => {
  // The app must run for anybody who clones it without an email account, and a
  // missing key is not a fault.
  const { alerter, sent } = harness({ env: {} });
  assert.equal(alerter.enabled, false);
  alerter.record({ message: 'boom', where: 'window' });
  await alerter.flushNow();
  assert.equal(sent.length, 0);
});

test('a half-configured setup is treated as no setup', async () => {
  // An address with no key would fail on every send and log a failure each time.
  const { alerter } = harness({ env: { BLOB_ALERT_EMAIL: 'seb@example.com' } });
  assert.equal(alerter.enabled, false);
});

test('errors are gathered into one email, not one each', async () => {
  const { alerter, sent } = harness();
  for (let i = 0; i < 25; i += 1) alerter.record({ message: 'the same fault', where: 'window' });
  await alerter.flushNow();

  assert.equal(sent.length, 1, 'more than one email for one batch');
  assert.match(sent[0].payload.subject, /25 errors/);
  assert.match(sent[0].payload.text, /25 x {2}the same fault/);
});

test('after one email it stays quiet, however much arrives', async () => {
  // The important one. A page in a render loop must not be able to send a
  // second, third and hundredth email.
  const h = harness();
  h.alerter.record({ message: 'first', where: 'window' });
  await h.alerter.flushNow();
  assert.equal(h.sent.length, 1);

  h.advance(60 * 1000);
  for (let i = 0; i < 500; i += 1) h.alerter.record({ message: `flood ${i}`, where: 'window' });
  await h.alerter.flushNow();
  assert.equal(h.sent.length, 1, 'it sent again during the quiet period');
});

test('once the quiet period is over it will send again', async () => {
  // The other half: quiet must not mean permanently deaf.
  const h = harness();
  h.alerter.record({ message: 'first', where: 'window' });
  await h.alerter.flushNow();

  h.advance(31 * 60 * 1000);
  h.alerter.record({ message: 'later, and different', where: 'window' });
  await h.alerter.flushNow();

  assert.equal(h.sent.length, 2);
  assert.match(h.sent[1].payload.text, /later, and different/);
});

test('a flood cannot grow the heap without limit', async () => {
  const h = harness();
  for (let i = 0; i < 5000; i += 1) h.alerter.record({ message: `fault ${i}`, where: 'window' });
  await h.alerter.flushNow();

  const line = h.sent[0].payload.text;
  assert.match(line, /counted but not kept/, 'it never says it dropped anything');
});

test('the email says where and which build, and nothing private', async () => {
  const h = harness();
  h.alerter.record({
    message: 'kitchen table exploded',
    where: 'window',
    screen: 'lobby',
    game: 'cheat',
    build: 'blob-shell-v56',
    stack: 'Error: kitchen table exploded\n  at somewhere',
  });
  await h.alerter.flushNow();

  const text = h.sent[0].payload.text;
  assert.match(text, /kitchen table exploded/);
  assert.match(text, /on: lobby/);
  assert.match(text, /blob-shell-v56/);
  // The report never carries these, and this is the assertion that keeps it so.
  assert.ok(!/\bcode\b.*\d{4}/.test(text), 'a game code got into the email');
});

test('the most common fault is listed first', () => {
  // A summary that buried the thing happening fifty times under the thing that
  // happened once would be worse than the raw log.
  const text = summarise([
    { message: 'rare', where: 'window' },
    ...Array.from({ length: 12 }, () => ({ message: 'constant', where: 'promise' })),
  ]);
  assert.ok(text.indexOf('constant') < text.indexOf('rare'), 'the common fault was not first');
});

test('a mail service that fails does not throw', async () => {
  // There is nothing useful to do about a failed alert on a server with no
  // queue, and turning it into an exception would take the request with it.
  const alerter = createAlerter({
    env: { BLOB_ALERT_EMAIL: 'seb@example.com', BLOB_ALERT_KEY: 'k' },
    now: () => 0,
    log: () => {},
    post: async () => {
      throw new Error('the mail service is down');
    },
  });
  alerter.record({ message: 'boom', where: 'window' });
  await assert.doesNotReject(() => alerter.flushNow());
});
