'use strict';

const { Room } = require('./room');
const game = require('../lib/game');
const { makeGameCode, makeId } = require('../lib/ids');

/** Finished games stay reachable for a while, so nobody loses the final screen. */
const FINISHED_TTL_MS = 6 * 60 * 60 * 1000;
/** An abandoned lobby is cleared out eventually. */
const IDLE_TTL_MS = 12 * 60 * 60 * 1000;

/**
 * The registry of live games. Owns creation, code lookup, restart recovery and
 * tidying up rooms nobody is using any more.
 */
class Rooms {
  /** @param {{store:object, graceMs?:number, electionMs?:number}} deps */
  constructor({ store, graceMs, electionMs, presenceMs }) {
    this.store = store;
    this.graceMs = graceMs;
    this.electionMs = electionMs;
    this.presenceMs = presenceMs;
    /** @type {Map<string, Room>} */
    this.byId = new Map();
    /** @type {Map<string, string>} game code -> game id */
    this.byCode = new Map();
  }

  /**
   * Bring back every game that was in progress when the server stopped.
   *
   * Nobody is connected after a restart, so everyone is marked disconnected and
   * given a generous window to come back — a deploy must not cost a table its
   * Master 45 seconds later.
   */
  async restore() {
    const saved = await this.store.loadAllLive();
    const now = Date.now();
    let restored = 0;
    for (const entry of saved) {
      if (!entry || !entry.state || !entry.state.id) continue;
      const state = entry.state;
      const age = now - (state.updatedAt || 0);
      if (state.phase === 'complete' ? age > FINISHED_TTL_MS : age > IDLE_TTL_MS) {
        await this.store.dropLive(state.id);
        continue;
      }
      state.players.forEach((p) => {
        if (!p.isOffline) p.connected = false;
      });
      const room = new Room(state, {
        store: this.store,
        sessions: entry.sessions || {},
        graceMs: this.graceMs ? this.graceMs * 4 : undefined,
        electionMs: this.electionMs,
        presenceMs: this.presenceMs,
      });
      this._register(room);
      restored += 1;
    }
    return restored;
  }

  /**
   * Create a game with its host as Master.
   * @param {{hostName:string, startHandSize?:number, mode?:'table'|'online'}} args
   * @returns {{room:Room, player:object, token:string}}
   */
  create({ hostName, startHandSize, mode }) {
    const code = this._freeCode();
    const { state, player } = game.createGame(
      { hostName, code, startHandSize, mode },
      { now: Date.now(), newId: makeId }
    );
    const room = new Room(state, {
      store: this.store,
      graceMs: this.graceMs,
      electionMs: this.electionMs,
      presenceMs: this.presenceMs,
    });
    const token = room.issueSession(player.id);
    this._register(room);
    this.store.saveLiveDebounced(state.id, () => room.snapshot());
    return { room, player, token };
  }

  /**
   * Start a rematch of a finished game: a fresh lobby, same starting hand
   * size, with everyone reachable carried straight in — nobody but the
   * Master has to touch a game code.
   *
   * Idempotent against a double-tapped "Play again" two ways: an in-flight or
   * already-succeeded call is memoized on the room for as long as this process
   * runs, and the outcome is also recorded in `state.rematchGameId` (a real
   * reducer command, persisted and broadcast) so a much later duplicate call —
   * say, after a server restart — hands back the existing rematch rather than
   * spawning a second one nobody asked for.
   *
   * @param {Room} oldRoom the finished game
   * @param {string} actorId whoever is asking — must be its Master
   * @returns {Promise<{error:{code:string,message:string}}|{room:Room, player:object, token:string}>}
   */
  async rematch(oldRoom, actorId) {
    if (oldRoom._rematchPromise) return oldRoom._rematchPromise;
    const promise = this._doRematch(oldRoom, actorId);
    oldRoom._rematchPromise = promise;
    const outcome = await promise;
    // A real failure (not connected, wrong phase) is worth letting a retry
    // attempt again later — the state that caused it may no longer hold.
    if (outcome.error) oldRoom._rematchPromise = null;
    return outcome;
  }

  async _doRematch(oldRoom, actorId) {
    if (oldRoom.state.masterId !== actorId) {
      return { error: { code: 'not-master', message: 'Only the Master can start a rematch.' } };
    }
    if (oldRoom.state.phase !== 'complete') {
      return { error: { code: 'not-finished', message: 'The game is not over yet.' } };
    }

    if (oldRoom.state.rematchGameId) {
      const mine = oldRoom.rematchSessions && oldRoom.rematchSessions.get(actorId);
      const existing = mine && this.get(mine.gameId);
      const player = existing && game.findPlayer(existing.state, mine.playerId);
      if (existing && player) return { room: existing, player, token: mine.token };
      return {
        error: { code: 'rematch-gone', message: 'That rematch is no longer available. Start a new game instead.' },
      };
    }

    const roster = oldRoom.rematchRoster();
    const master = roster.find((p) => p.id === actorId);
    if (!master) {
      return { error: { code: 'not-connected', message: 'You need to be connected to start a rematch.' } };
    }

    // A rematch is the same group playing the same way — carry the mode over, or
    // an online group would find themselves waiting for cards nobody has.
    const created = this.create({
      hostName: master.name,
      startHandSize: oldRoom.state.startHandSize,
      mode: oldRoom.state.mode,
    });
    /** @type {Map<string, {gameId:string, code:string, playerId:string, token:string}>} */
    const sessions = new Map();
    sessions.set(actorId, {
      gameId: created.room.state.id,
      code: created.room.state.code,
      playerId: created.player.id,
      token: created.token,
    });

    // Everyone else, in the order they originally joined — carried in with
    // the same name, so the new lobby reads like a continuation, not a
    // stranger's game. A no-phone player has no session to hand out; they
    // travel with the Master exactly as they did the first time.
    for (const p of roster) {
      if (p.id === actorId) continue;
      // An offline player is added BY the Master ('player/addOffline' checks
      // that), so it needs the new game's fresh Master id here, not null —
      // unlike 'player/join', which anyone may do unauthenticated.
      const command = p.isOffline ? { type: 'player/addOffline', name: p.name } : { type: 'player/join', name: p.name };
      const outcome = await created.room.dispatch(command, {
        actorId: p.isOffline ? created.player.id : null,
      });
      if (!outcome.ok || p.isOffline) continue;
      const newPlayer = outcome.result.player;
      sessions.set(p.id, {
        gameId: created.room.state.id,
        code: created.room.state.code,
        playerId: newPlayer.id,
        token: created.room.issueSession(newPlayer.id),
      });
    }

    oldRoom.rematchSessions = sessions;
    return { room: created.room, player: created.player, token: created.token };
  }

  /** @param {string} id */
  get(id) {
    return this.byId.get(id) || null;
  }

  /** @param {string} code */
  byGameCode(code) {
    const id = this.byCode.get(String(code || '').trim());
    return id ? this.byId.get(id) || null : null;
  }

  _register(room) {
    this.byId.set(room.state.id, room);
    this.byCode.set(room.state.code, room.state.id);
  }

  /** A code no game in progress is using. */
  _freeCode() {
    for (let attempt = 0; attempt < 200; attempt++) {
      const code = makeGameCode();
      if (!this.byCode.has(code)) return code;
    }
    // Absurdly unlikely — but a game with a longer code beats no game at all.
    return `${makeGameCode()}${Math.floor(Math.random() * 10)}`;
  }

  /** Check every live game for phones that have stopped answering. */
  sweepPresence(now = Date.now()) {
    let gone = 0;
    for (const room of this.byId.values()) gone += room.sweepPresence(now).length;
    return gone;
  }

  /** Drop rooms nobody needs any more. Returns how many went. */
  sweep(now = Date.now()) {
    let removed = 0;
    for (const [id, room] of this.byId) {
      if (room.subs.size > 0) continue;
      const idle = now - room.lastActivity;
      const ttl = room.state.phase === 'complete' ? FINISHED_TTL_MS : IDLE_TTL_MS;
      if (idle < ttl) continue;
      room.dispose();
      this.byId.delete(id);
      this.byCode.delete(room.state.code);
      this.store.dropLive(id).catch(() => {});
      removed += 1;
    }
    return removed;
  }

  disposeAll() {
    this.byId.forEach((room) => room.dispose());
  }
}

module.exports = { Rooms, FINISHED_TTL_MS, IDLE_TTL_MS };
