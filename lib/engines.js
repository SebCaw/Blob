'use strict';

const blobGame = require('./game');
const blobView = require('./view');
const bot = require('./bot');
const sillyheadGame = require('./sillyhead/game');
const sillyheadView = require('./sillyhead/view');
const sillyheadBot = require('./sillyhead/bot');
const sevensGame = require('./sevens/game');
const sevensView = require('./sevens/view');
const sevensBot = require('./sevens/bot');
const chaseGame = require('./chase/game');
const chaseView = require('./chase/view');
const chaseBot = require('./chase/bot');

/**
 * One entry per game the server knows how to run.
 *
 * `server/` owns rooms, sessions, the command queue, presence, grace windows
 * and Master elections — all of which are the same whatever is being played.
 * What differs is the rules, the redaction and what a missing player holds up,
 * and that is exactly what an engine is: the few functions the room needs and
 * cannot write itself.
 *
 * The point of this file is that the two games share ONE server. Forking
 * `server/room.js` per game would mean two command queues to keep serialized,
 * two privacy boundaries to keep honest, and a second place for a session bug
 * to live. There is one of each, and this is where they branch.
 *
 * An engine provides:
 *
 *   createGame(args, ctx)      make a fresh game with its host as Master
 *   applyCommand(state, c, x)  the pure reducer
 *   findPlayer(state, id)      seat lookup
 *   viewFor(state, id)         the privacy boundary
 *   historyRecord(state)       what gets written down when it finishes
 *   stallWatch(state)          who the table is stuck behind, if anyone
 *   bots                       null if the game has none
 */

const BLOB = {
  id: 'blob',
  name: 'Blob',
  createGame: blobGame.createGame,
  applyCommand: blobGame.applyCommand,
  findPlayer: blobGame.findPlayer,
  viewFor: blobView.viewFor,
  historyRecord: blobView.historyRecord,

  /**
   * A trick that a missing player is holding up.
   *
   * Returns null the moment there is nothing to wait for — the turn moved on,
   * they came back, they are already being skipped, or the offer is on the
   * Master's screen already.
   */
  stallWatch(state) {
    const round = blobGame.currentRound(state);
    const turnId = state.phase === 'playing' && round && round.trick ? round.trick.turnId : null;
    if (!turnId) return null;
    const player = blobGame.findPlayer(state, turnId);
    const skipping = Boolean(round.autoPlay && round.autoPlay[turnId]);
    const alreadyOffered = round.stalledPlayerId === turnId;
    if (!player || player.connected || skipping || alreadyOffered) return null;
    return { playerId: turnId, command: { type: 'trick/stalled', playerId: turnId } };
  },

  bots: {
    /**
     * The one thing a bot owes the table right now, if anything.
     *
     * One at a time on purpose: each move is a command, every command re-runs
     * this, and so three bots bid one after another rather than all at once.
     */
    owing(state) {
      if (state.mode !== 'online') return null;
      const round = blobGame.currentRound(state);
      if (!round) return null;

      if (state.phase === 'bidding' && !round.locked) {
        const owed = blobGame.roundPlayers(state, round).find((p) => p.isBot && !round.bids[p.id]);
        if (owed) return { playerId: owed.id, kind: 'bid', at: `${round.index}` };
      }
      if (state.phase === 'playing' && round.trick) {
        const turn = blobGame.findPlayer(state, round.trick.turnId);
        if (turn && turn.isBot) {
          return {
            playerId: turn.id,
            kind: 'play',
            at: `${round.index}:${round.trick.number}:${round.trick.plays.length}`,
          };
        }
      }
      return null;
    },

    thinkMs(view, secret, kind) {
      return bot.thinkMs(view, secret, kind);
    },

    /**
     * The command a bot has decided on.
     *
     * Everything is wrapped, and a brain that throws falls back to a legal card
     * (or a bid of nothing). A bot that cannot decide must never be able to
     * leave a table sat waiting — that is worse than a bad play.
     */
    move(view, secret, owed) {
      if (owed.kind === 'bid') {
        let value = 0;
        try {
          value = bot.chooseBid(view, secret);
        } catch (err) {
          console.error('[blob] bot could not bid', err.message);
        }
        const handSize = (view.round && view.round.handSize) || 0;
        if (!Number.isInteger(value) || value < 0 || value > handSize) value = 0;
        return { type: 'bid/submit', playerId: owed.playerId, value };
      }

      const playable = (view.you && view.you.playable) || [];
      let cardId = null;
      try {
        cardId = bot.chooseCard(view, secret);
      } catch (err) {
        console.error('[blob] bot could not choose a card', err.message);
      }
      // A null card is right in the forehead round, where a bot holds one card
      // it is not allowed to see and the reducer plays it unnamed. Anywhere else
      // it means the brain gave up, and any legal card beats a frozen table.
      if (!cardId && playable.length > 1) cardId = playable[0];
      return cardId ? { type: 'trick/play', cardId } : { type: 'trick/play' };
    },
  },
};

const SILLYHEAD = {
  id: 'sillyhead',
  name: 'Silly Head',
  createGame: sillyheadGame.createGame,
  applyCommand: sillyheadGame.applyCommand,
  findPlayer: sillyheadGame.findPlayer,
  viewFor: sillyheadView.viewFor,
  historyRecord: sillyheadView.historyRecord,

  stallWatch(state) {
    if (state.phase !== 'playing' || !state.turnId) return null;
    const player = sillyheadGame.findPlayer(state, state.turnId);
    const skipping = Boolean(state.autoPlay && state.autoPlay[state.turnId]);
    if (!player || player.left || player.connected || skipping || player.awaitingTakeover) return null;
    return { playerId: state.turnId, command: { type: 'play/stalled', playerId: state.turnId } };
  },

  bots: {
    /**
     * The one thing a bot owes the table right now.
     *
     * Two kinds, because Silly Head has two moments a bot has to act in. During
     * the SORT everybody moves at once, so any bot that has not finished owes a
     * step — and it takes them one at a time, through the same commands a phone
     * sends. During PLAY it is simply whoever's turn it is.
     *
     * `at` has to change whenever there is genuinely something new to do, and
     * stay the same when there is not, or the pause restarts on every
     * broadcast. Sorting keys on that bot's own cards; playing keys on the
     * position, so somebody else reconnecting does not reset the think.
     */
    owing(state) {
      if (state.phase === 'sort') {
        const owed = sillyheadGame
          .activePlayers(state)
          .find((p) => p.isBot && !state.sortDone[p.id]);
        if (!owed) return null;
        const hand = (state.hands[owed.id] || []).join(',');
        const up = (state.up[owed.id] || []).map((stack) => stack.join('|')).join(';');
        return { playerId: owed.id, kind: 'sort', at: `${hand}/${up}` };
      }
      if (state.phase !== 'playing' || !state.turnId) return null;
      const turn = sillyheadGame.findPlayer(state, state.turnId);
      if (!turn || !turn.isBot) return null;
      return { playerId: turn.id, kind: 'play', at: `${state.pile.length}:${state.sacked}:${state.stock.length}` };
    },

    thinkMs(view, secret, kind) {
      return sillyheadBot.thinkMs(view, secret, kind);
    },

    /**
     * The command a bot has decided on, or null when it has nothing left to do.
     *
     * A sort that returns nothing is a bot that is happy with its table, so the
     * move becomes "I am ready" — otherwise it would sit there and the game
     * would never start.
     */
    move(view, secret, owed) {
      if (owed.kind === 'sort') {
        try {
          return sillyheadBot.nextSortMove(view, secret) || { type: 'sort/done' };
        } catch (err) {
          console.error('[blob] a bot could not sort', err.message);
          return { type: 'sort/done' };
        }
      }
      try {
        return sillyheadBot.chooseMove(view, secret);
      } catch (err) {
        console.error('[blob] a bot could not choose a card', err.message);
        // Any legal move beats a frozen table.
        const playable = (view.you && view.you.playable) || [];
        if (playable.length) return { type: 'play/cards', cardIds: [playable[0]] };
        if (view.you && view.you.zone === 'down') return { type: 'play/flip', pileIndex: 0 };
        return { type: 'play/takePile' };
      }
    },
  },
};

const SEVENS = {
  id: 'sevens',
  name: 'Sevens',
  createGame: sevensGame.createGame,
  applyCommand: sevensGame.applyCommand,
  findPlayer: sevensGame.findPlayer,
  viewFor: sevensView.viewFor,
  historyRecord: sevensView.historyRecord,
  historySummary: sevensView.historySummary,

  stallWatch(state) {
    if (state.phase !== 'playing' || !state.turnId) return null;
    const player = sevensGame.findPlayer(state, state.turnId);
    const skipping = Boolean(state.autoPlay && state.autoPlay[state.turnId]);
    if (!player || player.left || player.connected || skipping || player.awaitingTakeover) return null;
    return { playerId: state.turnId, command: { type: 'play/stalled', playerId: state.turnId } };
  },

  bots: {
    /**
     * The one thing a bot owes the table right now.
     *
     * Simpler than either of the other two, because Sevens has exactly one
     * moment a bot acts in: its own turn. There is no phase where everybody
     * moves at once, so there is nothing to key on but the position.
     *
     * `at` is that position — how many cards are down, and whose turn it is.
     * Both change on a real move and neither changes when somebody reconnects
     * or a name is edited, which is what stops the think timer restarting on
     * every broadcast.
     */
    owing(state) {
      if (state.phase !== 'playing' || !state.turnId) return null;
      const turn = sevensGame.findPlayer(state, state.turnId);
      if (!turn || !turn.isBot) return null;
      return {
        playerId: turn.id,
        kind: 'play',
        at: `${state.turnId}:${sevensGame.totalDown(state.table || {})}`,
      };
    },

    thinkMs(view, secret, kind) {
      return sevensBot.thinkMs(view, secret, kind);
    },

    /**
     * The command a bot has decided on.
     *
     * A brain that throws falls back to a legal move read straight off
     * `view.you` — the first playable card, or a pass when there is nothing.
     * Both are always accepted by the reducer in this position, and any legal
     * move beats a frozen table.
     */
    move(view, secret) {
      try {
        return sevensBot.chooseMove(view, secret);
      } catch (err) {
        console.error('[blob] a bot could not choose a card', err.message);
        const playable = (view.you && view.you.playable) || [];
        if (playable.length) return { type: 'play/card', cardId: playable[0] };
        return { type: 'play/pass' };
      }
    },
  },
};

const CHASE = {
  id: 'chase',
  name: 'Chase the Ace',
  createGame: chaseGame.createGame,
  applyCommand: chaseGame.applyCommand,
  findPlayer: chaseGame.findPlayer,
  viewFor: chaseView.viewFor,
  historyRecord: chaseView.historyRecord,
  historySummary: chaseView.historySummary,

  stallWatch(state) {
    if (state.phase !== 'playing' || !state.turnId) return null;
    const player = chaseGame.findPlayer(state, state.turnId);
    const skipping = Boolean(state.autoPlay && state.autoPlay[state.turnId]);
    if (!player || player.left || player.connected || skipping || player.awaitingTakeover) return null;
    return { playerId: state.turnId, command: { type: 'play/stalled', playerId: state.turnId } };
  },

  bots: {
    /**
     * The one thing a bot owes the table right now.
     *
     * Two kinds, because this game gives a bot something to do when it is NOT
     * its turn: tidying its own fan, which is half the game. Drawing comes
     * first, so a bot never sits fiddling while the table waits on it.
     *
     * The two `at` keys are built on different things for a reason. Drawing
     * keys on the position — whose turn and how much has been discarded — both
     * of which move on a real turn and neither of which moves when somebody
     * reconnects. Arranging keys on the bot's OWN cards as a set, deliberately
     * ignoring their order: a rearrange changes the order and nothing else, so
     * a key that noticed order would change the instant the bot acted and it
     * would arrange forever. `state.tidied` is the other half of that guard.
     */
    owing(state) {
      if (state.phase !== 'playing') return null;

      if (state.turnId) {
        const turn = chaseGame.findPlayer(state, state.turnId);
        if (turn && turn.isBot && chaseGame.sourceFor(state, turn.id)) {
          return {
            playerId: turn.id,
            kind: 'draw',
            at: `${state.turnId}:${(state.discarded || []).length}`,
          };
        }
      }

      const locked = chaseGame.lockedHandId(state);
      const fidget = chaseGame
        .activePlayers(state)
        .find(
          (p) =>
            p.isBot &&
            !chaseGame.isOut(state, p.id) &&
            p.id !== locked &&
            p.id !== state.turnId &&
            !(state.tidied || {})[p.id] &&
            (state.hands[p.id] || []).length >= 2
        );
      if (!fidget) return null;
      return {
        playerId: fidget.id,
        kind: 'arrange',
        at: `${fidget.id}:${(state.hands[fidget.id] || []).slice().sort().join(',')}`,
      };
    },

    thinkMs(view, secret, kind) {
      return chaseBot.thinkMs(view, secret, kind);
    },

    /**
     * The command a bot has decided on, or null when it has thought about
     * tidying its hand and decided not to bother.
     *
     * A brain that throws falls back to taking the first slot, which is always
     * legal on a bot's own turn. Any legal move beats a frozen table.
     */
    move(view, secret, owed) {
      try {
        return chaseBot.chooseMove(view, secret, owed);
      } catch (err) {
        console.error('[blob] a bot could not choose a card', err.message);
        // A shuffle is always legal for a bot that was owed an arrange — `owing`
        // only offers one to a seat holding two cards or more. Never null: that
        // leaves the same thing owed and the timer re-arming forever.
        return owed && owed.kind === 'arrange'
          ? { type: 'hand/shuffle' }
          : { type: 'draw/take', index: 0 };
      }
    },
  },
};

const ENGINES = { blob: BLOB, sillyhead: SILLYHEAD, sevens: SEVENS, chase: CHASE };

/** The default, and what a state saved before there was more than one game is. */
const DEFAULT_ENGINE = 'blob';

/** @param {object} state @returns {typeof BLOB} */
function engineFor(state) {
  return ENGINES[(state && state.game) || DEFAULT_ENGINE] || BLOB;
}

/** @param {string} id @returns {typeof BLOB} */
function engineById(id) {
  return ENGINES[id] || BLOB;
}

/** Is this the id of a game we can actually run? */
function knownEngine(id) {
  return Object.prototype.hasOwnProperty.call(ENGINES, id);
}

module.exports = { ENGINES, DEFAULT_ENGINE, engineFor, engineById, knownEngine };
