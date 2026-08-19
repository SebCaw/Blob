'use strict';

const game = require('../lib/game');
const { viewFor, historyRecord } = require('../lib/view');
const { makeId, makeToken, tokensMatch } = require('../lib/ids');

/**
 * One game, in memory, with the machinery that keeps it honest:
 *
 *  - a SERIALIZED command queue, so two phones submitting at the same instant
 *    are applied one after the other and bidding locks exactly once;
 *  - an applied-command ring, so a double-tapped button is a no-op;
 *  - grace timers, so a dropped phone gets a chance to come back before the
 *    Master is allowed to cover them or an election starts;
 *  - subscriber fan-out, where every phone gets the state IT is allowed to see.
 */

/** How long a phone has to come back before the game works around it. */
const GRACE_MS = 45_000;
/**
 * How long a phone can go without answering a heartbeat before it counts as
 * gone. A closed socket is the fast signal, but a phone that drives into a
 * tunnel leaves the connection half-open: the server's writes keep succeeding
 * into a kernel buffer for minutes, so nothing would ever notice on its own.
 */
const PRESENCE_TIMEOUT_MS = 25_000;
/** How long a Master election waits for stragglers before tallying what it has. */
const ELECTION_TIMEOUT_MS = 60_000;
/** How many command ids to remember for duplicate suppression. */
const SEEN_LIMIT = 300;

class Room {
  /**
   * @param {object} state authoritative game state
   * @param {{store:object, sessions?:Record<string,string>, graceMs?:number, electionMs?:number}} deps
   */
  constructor(
    state,
    {
      store,
      sessions = {},
      graceMs = GRACE_MS,
      electionMs = ELECTION_TIMEOUT_MS,
      presenceMs = PRESENCE_TIMEOUT_MS,
    }
  ) {
    this.state = state;
    this.store = store;
    this.graceMs = graceMs;
    this.electionMs = electionMs;
    this.presenceMs = presenceMs;
    /** playerId -> when we last heard from that phone */
    this.lastSeen = new Map();

    /** playerId -> session token. Never leaves the server in a view. */
    this.sessions = { ...sessions };
    /** connId -> { playerId, send, close } */
    this.subs = new Map();
    /** playerId -> timer counting down their reconnection window */
    this.graceTimers = new Map();
    this.electionTimer = null;

    /** cmdId -> outcome, so a retry returns the first answer instead of re-running */
    this.seen = new Map();
    /** the serialization point: every command joins the back of this chain */
    this.chain = Promise.resolve();
    this.lastActivity = Date.now();

    /**
     * Set once a rematch is created FROM this room: old playerId -> the new
     * game's {gameId, code, playerId, token}. Deliberately outside `state` —
     * a token is a bearer credential and `state` is what gets broadcast to
     * everyone in the room, so it can never go anywhere near it. A player
     * fetches their OWN entry by proving who they are with their OLD session,
     * the same way every other authenticated action here works.
     */
    this.rematchSessions = null;
  }

  // ── Sessions ───────────────────────────────────────────────────────────────

  /** Mint a session for a player and hand back the token (once). */
  issueSession(playerId) {
    const token = makeToken();
    this.sessions[playerId] = token;
    return token;
  }

  /** Note that we have just heard from a phone: a stream, a command or a pong. */
  touch(playerId) {
    this.lastSeen.set(playerId, Date.now());
  }

  /**
   * Mark anyone who has stopped answering as disconnected.
   *
   * This is the backstop behind `detach`. A socket closing cleanly is caught
   * immediately; a phone that simply stops existing is caught here, and without
   * it the Master would never be offered a dropped player's bid and a vanished
   * Master would never trigger an election.
   *
   * @param {number} [now]
   * @returns {string[]} players newly marked as gone
   */
  sweepPresence(now = Date.now()) {
    const gone = [];
    for (const player of this.state.players) {
      if (player.isOffline || !player.connected) continue;
      const seen = this.lastSeen.get(player.id) || 0;
      if (now - seen <= this.presenceMs) continue;

      // Drop the zombie connection along with them, or the next broadcast will
      // keep writing into a socket nobody is reading.
      for (const [connId, sub] of this.subs) {
        if (sub.playerId === player.id) this.subs.delete(connId);
      }
      this.dispatch({ type: 'conn/set', playerId: player.id, connected: false }, { actorId: null });
      this._armGrace(player.id);
      gone.push(player.id);
    }
    return gone;
  }

  /** @returns {boolean} */
  authenticate(playerId, token) {
    const known = this.sessions[playerId];
    return Boolean(known) && tokensMatch(known, token) && Boolean(game.findPlayer(this.state, playerId));
  }

  // ── Commands ───────────────────────────────────────────────────────────────

  /**
   * Queue a command. Resolves once it has been applied (or refused).
   *
   * @param {{type:string,[k:string]:any}} command
   * @param {{actorId?:string|null, cmdId?:string|null}} [meta]
   * @returns {Promise<{ok:true, result:any}|{ok:false, error:{code:string,message:string}}>}
   */
  dispatch(command, meta = {}) {
    const run = () => this._apply(command, meta);
    // Errors are captured into the result, so one bad command can never break
    // the chain for everyone else at the table.
    this.chain = this.chain.then(run, run);
    return this.chain;
  }

  async _apply(command, meta) {
    const { actorId = null, cmdId = null } = meta;
    if (actorId) this.touch(actorId);
    if (cmdId && this.seen.has(cmdId)) return this.seen.get(cmdId);

    const ctx = { now: Date.now(), newId: makeId, actorId };
    let outcome;
    try {
      const out = game.applyCommand(this.state, command, ctx);
      if (out.error) {
        outcome = { ok: false, error: out.error };
      } else {
        const before = this.state;
        this.state = out.state;
        outcome = { ok: true, result: out.result };
        this._afterChange(before);
      }
    } catch (err) {
      console.error('[blob] command blew up', command.type, err);
      outcome = { ok: false, error: { code: 'server', message: 'Something went wrong. Nothing was changed.' } };
    }

    if (cmdId) this._remember(cmdId, outcome);
    this.lastActivity = Date.now();
    return outcome;
  }

  _remember(cmdId, outcome) {
    this.seen.set(cmdId, outcome);
    while (this.seen.size > SEEN_LIMIT) this.seen.delete(this.seen.keys().next().value);
  }

  /** Side effects that follow a state change: persist, broadcast, arm timers. */
  _afterChange(previous) {
    this.broadcast();
    this.store.saveLiveDebounced(this.state.id, () => this.snapshot());

    // An election that has just opened gets a deadline, so a player who never
    // votes cannot leave the table without a Master indefinitely.
    const election = this.state.election;
    if (election && !election.resolvedAt && !this.electionTimer) {
      this.electionTimer = setTimeout(() => {
        this.electionTimer = null;
        this.dispatch({ type: 'election/resolve' }, { actorId: null });
      }, this.electionMs);
      if (this.electionTimer.unref) this.electionTimer.unref();
    }
    if ((!election || election.resolvedAt) && this.electionTimer) {
      clearTimeout(this.electionTimer);
      this.electionTimer = null;
    }

    // Re-saved on a correction too: the record is written once on completion,
    // so without this a score fixed after the final round would be right on
    // screen and wrong in the history for good.
    const justFinished = previous.phase !== 'complete';
    const correctedSinceFinishing = this.state.amendedAt !== previous.amendedAt;
    if (this.state.phase === 'complete' && (justFinished || correctedSinceFinishing)) {
      this.store.saveHistory(historyRecord(this.state)).catch((err) => {
        console.error('[blob] could not save history', err.message);
      });
    }
  }

  // ── Subscribers ────────────────────────────────────────────────────────────

  /**
   * Attach a live connection for a player.
   * @param {string} playerId
   * @param {(event:string, data:any)=>void} send
   * @returns {string} connection id, for detach
   */
  attach(playerId, send) {
    const connId = makeId('c');
    this.subs.set(connId, { playerId, send });
    this.lastActivity = Date.now();
    this.touch(playerId);

    const timer = this.graceTimers.get(playerId);
    if (timer) {
      clearTimeout(timer);
      this.graceTimers.delete(playerId);
    }

    const player = game.findPlayer(this.state, playerId);
    if (player && !player.connected) {
      this.dispatch({ type: 'conn/set', playerId, connected: true }, { actorId: null });
    } else {
      send('state', this.viewFor(playerId));
    }
    return connId;
  }

  /** Drop a connection. The player only counts as gone when their last one goes. */
  detach(connId) {
    const sub = this.subs.get(connId);
    if (!sub) return;
    this.subs.delete(connId);
    this.lastActivity = Date.now();

    const stillHere = [...this.subs.values()].some((s) => s.playerId === sub.playerId);
    if (stillHere) return;

    this.dispatch({ type: 'conn/set', playerId: sub.playerId, connected: false }, { actorId: null });
    this._armGrace(sub.playerId);
  }

  /**
   * Start the reconnection window. When it lapses the game moves on without
   * them: the Master may cover their bid, or — if they were the Master — the
   * remaining players elect a new one.
   */
  _armGrace(playerId) {
    const existing = this.graceTimers.get(playerId);
    if (existing) clearTimeout(existing);

    const timer = setTimeout(async () => {
      this.graceTimers.delete(playerId);
      const player = game.findPlayer(this.state, playerId);
      if (!player || player.connected) return;

      if (this.state.masterId === playerId) {
        await this.dispatch({ type: 'election/start' }, { actorId: null });
      } else {
        await this.dispatch({ type: 'conn/takeover', playerId }, { actorId: null });
      }
    }, this.graceMs);
    if (timer.unref) timer.unref();
    this.graceTimers.set(playerId, timer);
  }

  /** Push the current state to every connection, redacted per viewer. */
  broadcast() {
    /** @type {Map<string, object>} */
    const cache = new Map();
    for (const sub of this.subs.values()) {
      if (!cache.has(sub.playerId)) cache.set(sub.playerId, this.viewFor(sub.playerId));
      try {
        sub.send('state', cache.get(sub.playerId));
      } catch {
        // A dead socket is not an error worth surfacing — the close handler
        // will tidy up and the grace window will do its job.
      }
    }
  }

  /** @param {string|null} playerId */
  viewFor(playerId) {
    return viewFor(this.state, playerId);
  }

  /** How many live connections a player has. */
  connectionsFor(playerId) {
    return [...this.subs.values()].filter((s) => s.playerId === playerId).length;
  }

  /**
   * Who can be carried straight into a rematch, in the order they joined.
   *
   * Only players SOMETHING can actually reach: a phone currently connected
   * (they will get redirected automatically), or a no-phone player (the
   * Master is managing them anyway, so they travel with the Master). A player
   * who disconnected and never came back cannot be migrated — nothing is
   * listening on their behalf — so they are left off; the game's public
   * `rematchCode` is their way back in if they return.
   */
  rematchRoster() {
    return this.state.players.filter((p) => p.isOffline || p.connected);
  }

  /** Everything needed to bring this room back after a restart. */
  snapshot() {
    return { state: this.state, sessions: this.sessions, savedAt: Date.now() };
  }

  /** Stop every timer — called when the room is evicted. */
  dispose() {
    this.graceTimers.forEach(clearTimeout);
    this.graceTimers.clear();
    if (this.electionTimer) clearTimeout(this.electionTimer);
    this.electionTimer = null;
    for (const sub of this.subs.values()) {
      if (sub.close) {
        try {
          sub.close();
        } catch {
          /* already gone */
        }
      }
    }
    this.subs.clear();
  }
}

module.exports = { Room, GRACE_MS, ELECTION_TIMEOUT_MS, PRESENCE_TIMEOUT_MS };
