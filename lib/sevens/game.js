'use strict';

const { resolveBallot } = require('../election');
const { uniqueName } = require('../ids');
const { OPENING_CARD, deal, sortHand, suitOf, valueOf } = require('./deck');
const { BOT_LEVELS, BOT_NAMES } = require('./bot');
const { emptyTable, isPlayable, place, isComplete, totalDown } = require('./rules');
const { handToBot } = require('../handover');
const { reclaimMaster } = require('../master');

/**
 * The authoritative Sevens state and its reducer.
 *
 * Pure, exactly like the other two: `applyCommand(state, command, ctx)` returns
 * a new state or a refusal, and `now`, `newId` and every scrap of randomness
 * arrive through `ctx`.
 *
 *   lobby -> playing -> complete
 *
 * Three phases, which is the fewest any game here has. There is no bidding, no
 * sort, no rounds and no score: the whole deck goes out, the sevens open their
 * suits, and the runs grow outward until somebody is left holding the last
 * cards.
 *
 * Two things about this game shape the code more than they look:
 *
 * **Nothing is hidden except hands.** The table is entirely public — no
 * face-down cards, no claims, no bluffs. `view.js` is correspondingly the
 * simplest privacy boundary in the repo, and that is a property to keep rather
 * than an accident to build over.
 *
 * **You must play if you can.** Passing is not a choice, it is what is left when
 * there is nothing legal, and the reducer enforces that rather than trusting the
 * screen — `play/pass` is refused outright if you are holding a card you could
 * put down. Everything the table can accept lives in `./rules.js`, and nothing
 * in here decides what is legal.
 */

const PHASES = ['lobby', 'playing', 'complete'];

/** Two works mechanically and is a poor game. */
const MIN_PLAYERS = 3;

/** Fifty-two cards between nine people is five each, which is over in a minute. */
const MAX_PLAYERS = 8;

// ── Errors ────────────────────────────────────────────────────────────────────
// Shown to a player as-is, so they are written the way you would say them.

/** @param {string} message @param {string} [code] */
function fail(message, code = 'rejected') {
  return { error: { code, message } };
}

// ── Creation ─────────────────────────────────────────────────────────────────

/**
 * A brand new game with its creator as the first player and Master.
 *
 * @param {{hostName:string, code:string}} args
 * @param {{now:number, newId:(prefix:string)=>string}} ctx
 * @returns {{state:object, player:object}}
 */
function createGame({ hostName, code }, ctx) {
  const host = makePlayer({ id: ctx.newId('p'), name: (hostName || '').trim() || 'Player', now: ctx.now });
  const state = {
    id: ctx.newId('g'),
    code,
    /** Which game this room is running. The server picks its engine from this. */
    game: 'sevens',
    createdAt: ctx.now,
    updatedAt: ctx.now,
    version: 1,
    phase: 'lobby',
    masterId: host.id,
    players: [host],
    /** Set at the deal. Kept so a game can be dealt again exactly. */
    seed: null,
    /** playerId -> the cards in their hand, in the order they are held. */
    hands: null,
    /** suit -> {low, high} or null. See `./rules.js`. */
    table: null,
    turnId: null,
    /** Player ids in the order they went out. The first is the winner. */
    finished: [],
    /** playerId -> how many turns they have had nothing to play. */
    passes: {},
    /**
     * What just happened, for the screen to animate from.
     *
     * Every one of these is something the whole room watched: a card going face
     * up, somebody passing, somebody laying their last card down. Nothing here
     * is a secret, which is why it can sit in the state rather than being worked
     * out per viewer.
     */
    lastEvent: null,
    /** playerId -> true while the Master is having their turns played for them. */
    autoPlay: {},
    /** Whoever is left holding cards at the end. */
    loserId: null,
    election: null,
    completedAt: null,
    endedEarly: false,
    rematchGameId: null,
    rematchCode: null,
  };
  return { state, player: host };
}

/** The first name in the pool nobody at this table is using. */
function nextBotName(state) {
  const taken = new Set(state.players.map((p) => p.name.toLowerCase()));
  return BOT_NAMES.find((n) => !taken.has(n.toLowerCase())) || BOT_NAMES[0];
}

/** @param {{id:string,name:string,now:number}} args */
function makePlayer({ id, name, now }) {
  return {
    id,
    name,
    connected: true,
    joinedAt: now,
    disconnectedAt: null,
    awaitingTakeover: false,
    left: false,
  };
}

// ── Reducer ──────────────────────────────────────────────────────────────────

/**
 * Apply one command to the state.
 *
 * @param {object} state
 * @param {{type:string, [k:string]:any}} command
 * @param {{now:number, newId:(prefix:string)=>string, actorId?:string|null}} ctx
 * @returns {{state:object, result:object|null}|{error:{code:string,message:string}}}
 */
function applyCommand(state, command, ctx) {
  const handler = HANDLERS[command.type];
  if (!handler) return fail('That action is not something Sevens knows how to do.', 'unknown-command');

  const next = clone(state);
  const result = handler(next, command, ctx);
  if (result && result.error) return result;

  next.version = state.version + 1;
  next.updatedAt = ctx.now;
  return { state: next, result: (result && result.result) || null };
}

/** Structured clone keeps the reducer honest — callers cannot mutate the input. */
function clone(state) {
  return JSON.parse(JSON.stringify(state));
}

// ── Reading the state ────────────────────────────────────────────────────────

/** @param {object} state @param {string|null|undefined} id */
function findPlayer(state, id) {
  if (!id) return null;
  return state.players.find((p) => p.id === id) || null;
}

function isMaster(state, id) {
  return Boolean(id) && state.masterId === id;
}

/** Player ids longest-standing first — the tiebreak for a Master election. */
function seniority(state) {
  return state.players
    .filter((p) => !p.left)
    .slice()
    .sort((a, b) => a.joinedAt - b.joinedAt || a.id.localeCompare(b.id))
    .map((p) => p.id);
}

/** The longest-standing player with a phone. Never a bot. */
function nextMaster(state) {
  return (
    seniority(state).find((id) => {
      const p = findPlayer(state, id);
      return p && !p.left && !p.isBot;
    }) || seniority(state)[0]
  );
}

/** Everybody still in the game — nobody who walked out. */
function activePlayers(state) {
  return state.players.filter((p) => !p.left);
}

/** Has this player laid all their cards down? */
function isOut(state, id) {
  return state.finished.includes(id);
}

/** Everybody still holding cards. */
function stillIn(state) {
  return activePlayers(state).filter((p) => !isOut(state, p.id));
}

/** Who may stand in a Master election: a seat with a phone behind it. */
function eligibleForMaster(state) {
  return activePlayers(state).filter((p) => !p.isBot && p.connected);
}

/**
 * The cards this player could legally put down right now.
 *
 * The client shows this rather than working it out, and the reducer enforces it.
 * Empty when it is not your turn, which is what makes it safe for the screen to
 * key its whole "can I do anything" state off one array.
 *
 * @returns {string[]}
 */
function playableCards(state, id) {
  if (state.phase !== 'playing' || state.turnId !== id) return [];
  if (!state.hands || !state.table) return [];
  return (state.hands[id] || []).filter((card) => isPlayable(card, state.table));
}

/** Whose turn is it after this one? Skips anybody out or gone. */
function nextTurnId(state, fromId) {
  const order = activePlayers(state).map((p) => p.id);
  if (!order.length) return null;
  const start = order.indexOf(fromId);
  for (let step = 1; step <= order.length; step++) {
    const id = order[(start + step) % order.length];
    if (!isOut(state, id)) return id;
  }
  return null;
}

/**
 * Who leads: whoever was dealt the seven of diamonds.
 *
 * Not random, and not the host. It is the one opening rule the whole table can
 * check without being told — the person holding it simply says so and puts it
 * down, exactly as they would round a kitchen table.
 */
function openingLeader(state, ids) {
  return ids.find((id) => (state.hands[id] || []).includes(OPENING_CARD)) || ids[0];
}

// ── Handlers ─────────────────────────────────────────────────────────────────

const HANDLERS = {
  /** A player joins from their own phone. Lobby only — the whole deck is dealt. */
  'player/join'(state, cmd, ctx) {
    if (state.phase === 'complete') return fail('This game has finished.', 'game-over');
    if (state.phase !== 'lobby') {
      return fail('This game has already started. Ask the group to start a new one.', 'already-started');
    }
    if (state.players.length >= MAX_PLAYERS) {
      return fail(`Sevens seats ${MAX_PLAYERS} players at most. This game is full.`, 'game-full');
    }
    const name = uniqueName(String(cmd.name || '').trim() || 'Player', state.players.map((p) => p.name));
    const player = makePlayer({ id: ctx.newId('p'), name, now: ctx.now });
    state.players.push(player);
    return { result: { player } };
  },

  /**
   * The Master sits a bot down.
   *
   * A bot is a player, not a special case: it is dealt from the same deck, it
   * can hold the opening seven and lead, and it can be left holding the last
   * cards. What it is NOT is a candidate for Master, something `conn/set` can
   * mark away, or something the stall machinery fires for — it has no phone to
   * lose.
   */
  'player/addBot'(state, cmd, ctx) {
    if (!isMaster(state, ctx.actorId)) return fail('Only the Master can add a bot.', 'not-master');
    if (state.phase !== 'lobby') return fail('Bots can only be added before the game starts.');
    if (state.players.length >= MAX_PLAYERS) {
      return fail(`Sevens seats ${MAX_PLAYERS} players at most. This game is full.`, 'game-full');
    }

    const level = BOT_LEVELS.includes(cmd.level) ? cmd.level : 'medium';
    const wanted = String(cmd.name || '').trim() || nextBotName(state);
    const name = uniqueName(wanted, state.players.map((p) => p.name));
    const player = makePlayer({ id: ctx.newId('p'), name, now: ctx.now });
    player.isBot = true;
    player.botLevel = level;
    /** Private. How this one plays, and it never appears in a view. */
    player.botSeed = ctx.newId('bot');
    state.players.push(player);
    return { result: { player } };
  },

  /**
   * Somebody leaves, or the Master lets a vanished phone go.
   *
   * Their cards leave with them rather than going on the table. Nobody has seen
   * them, and a handful of cards appearing at both ends of three suits at once
   * would rewrite the game for everybody still playing.
   */
  'player/remove'(state, cmd, ctx) {
    const target = findPlayer(state, cmd.playerId);
    if (!target || target.left) return fail('That player has already left.');
    if (!isMaster(state, ctx.actorId) && ctx.actorId !== target.id) {
      return fail('Only the Master can remove other players.', 'not-master');
    }

    if (state.phase === 'lobby') {
      state.players = state.players.filter((p) => p.id !== target.id);
      if (!state.players.length) return fail('A game needs at least one player.', 'empty-game');
      if (state.masterId === target.id) state.masterId = nextMaster(state);
      return;
    }
    if (state.phase === 'complete') return fail('The game is already over.');
    if (target.isBot) return fail('A bot can only be removed before the game starts.', 'bot-in-play');
    if (target.connected && ctx.actorId !== target.id) return fail(`${target.name} is still with us.`, 'still-here');

    // A bot takes the seat, cards and all. Deleting the hand instead used to
    // strand three of the six games for ever - see `lib/handover.js`.
    handToBot(state, target, ctx);
    if (state.masterId === target.id) state.masterId = nextMaster(state) || target.id;
    settleGame(state, ctx);
  },

  /** Deal the whole deck and find the seven of diamonds. */
  'game/start'(state, cmd, ctx) {
    if (!isMaster(state, ctx.actorId)) return fail('Only the Master can start the game.', 'not-master');
    if (state.phase !== 'lobby') return fail('The game has already started.');
    const players = activePlayers(state);
    if (players.length < MIN_PLAYERS) return fail(`You need at least ${MIN_PLAYERS} players.`, 'too-few');

    const ids = players.map((p) => p.id);
    // The seed is an id made with crypto, so the shuffle is genuinely random —
    // and writing it down is what makes a deal checkable afterwards.
    const seed = ctx.newId('deal');

    state.seed = seed;
    state.hands = deal(seed, ids);
    state.table = emptyTable();
    state.finished = [];
    state.passes = Object.fromEntries(ids.map((id) => [id, 0]));
    state.lastEvent = null;
    state.turnId = openingLeader(state, ids);
    state.phase = 'playing';
  },

  /**
   * Put a card down.
   *
   * The reducer checks it is yours and that the table will take it. It does not
   * ask the screen, and it does not trust a client that says a card is playable.
   */
  'play/card'(state, cmd, ctx) {
    const guard = onTurn(state, ctx.actorId);
    if (guard) return guard;

    const id = state.turnId;
    const hand = state.hands[id] || [];
    const card = String(cmd.cardId || '');
    if (!hand.includes(card)) return fail('That card is not in your hand.', 'not-yours');
    if (!isPlayable(card, state.table)) {
      return fail('That card will not go down yet.', 'not-playable');
    }

    const landed = place(card, state.table);
    state.table = landed.table;
    state.hands[id] = hand.filter((c) => c !== card);

    state.lastEvent = {
      kind: 'play',
      playerId: id,
      card,
      suit: landed.suit,
      end: landed.end,
      // Whether that card finished its suit, so the screen knows to mark it
      // without having to compare two renders of the table.
      completed: isComplete(state.table[landed.suit]),
      at: ctx.now,
    };

    if (!state.hands[id].length) {
      state.finished.push(id);
      state.lastEvent.wentOut = true;
    }

    if (settleGame(state, ctx)) return;
    state.turnId = nextTurnId(state, id);
    advanceAutoPlays(state, ctx);
  },

  /**
   * Nothing to play.
   *
   * Refused if you are holding something legal. That is the must-play rule, and
   * putting it here rather than on the screen is what stops a modified client
   * from sitting on a card to block somebody — which is a different game, and
   * not the one this house plays.
   */
  'play/pass'(state, cmd, ctx) {
    const guard = onTurn(state, ctx.actorId);
    if (guard) return guard;

    const id = state.turnId;
    if (playableCards(state, id).length) {
      return fail('You have a card you can play.', 'must-play');
    }

    state.passes[id] = (state.passes[id] || 0) + 1;
    state.lastEvent = { kind: 'pass', playerId: id, at: ctx.now };
    state.turnId = nextTurnId(state, id);
    advanceAutoPlays(state, ctx);
  },

  /** A missing player is holding the table up. Offer the Master a way past. */
  'play/stalled'(state, cmd, ctx) {
    if (state.phase !== 'playing') return;
    const player = findPlayer(state, state.turnId);
    if (!player || player.connected || player.left) return;
    player.awaitingTakeover = true;
  },

  /**
   * The Master gives up waiting. From here the missing player's turns are played
   * for them — the lowest legal card they hold, or a pass — until they come
   * back. Never a choice worth making, and never shown to anybody: being absent
   * should cost you the game, not be quietly played well on your behalf.
   */
  'play/skipTurns'(state, cmd, ctx) {
    if (!isMaster(state, ctx.actorId)) return fail('Only the Master can do that.', 'not-master');
    if (state.phase !== 'playing') return fail('The game is not being played.');
    const player = findPlayer(state, cmd.playerId);
    if (!player || player.left) return fail('We could not find that player.');
    if (player.connected) return fail(`${player.name} is still with us.`, 'still-here');
    state.autoPlay[player.id] = true;
    player.awaitingTakeover = false;
    advanceAutoPlays(state, ctx);
  },

  /** The Master calls it a day. */
  'game/end'(state, cmd, ctx) {
    if (!isMaster(state, ctx.actorId)) return fail('Only the Master can end the game.', 'not-master');
    if (state.phase === 'lobby') return fail('The game has not started yet.');
    if (state.phase === 'complete') return;
    state.phase = 'complete';
    state.completedAt = ctx.now;
    state.endedEarly = true;
  },

  /** Idempotent: a double-tapped "Play again" reports the same rematch back. */
  'game/rematchStarted'(state, cmd, ctx) {
    if (!isMaster(state, ctx.actorId)) return fail('Only the Master can start a rematch.', 'not-master');
    if (state.phase !== 'complete') return fail('The game is not over yet.');
    if (state.rematchGameId) return;
    if (!cmd.gameId || !cmd.code) return fail('That rematch is missing its details.');
    state.rematchGameId = cmd.gameId;
    state.rematchCode = cmd.code;
  },

  /** Connection bookkeeping, driven by the server, never by a client claim. */
  'conn/set'(state, cmd, ctx) {
    const player = findPlayer(state, cmd.playerId);
    if (!player) return fail('We could not find that player.');
    // A bot lives on the server. It has no phone to drop, and marking one away
    // would offer the Master a skip for a player who is right there.
    if (player.isBot) return;
    player.connected = Boolean(cmd.connected);
    if (player.connected) {
      player.disconnectedAt = null;
      reclaimMaster(state, player);
      player.awaitingTakeover = false;
      // Back before the game ended: stop playing their cards for them.
      delete state.autoPlay[player.id];
      return;
    }
    player.disconnectedAt = ctx.now;
  },

  'conn/takeover'(state, cmd) {
    const player = findPlayer(state, cmd.playerId);
    if (!player) return fail('We could not find that player.');
    if (player.isBot) return fail('That player is a bot.', 'is-bot');
    if (player.connected) return fail('That player is still with us.');
    player.awaitingTakeover = true;
  },

  'election/start'(state, cmd, ctx) {
    if (state.election && !state.election.resolvedAt) return fail('A vote is already running.', 'election-open');
    if (state.phase === 'complete') return fail('The game is already over.');
    const master = findPlayer(state, state.masterId);
    if (master && master.connected) return fail('The Master is still connected.', 'master-present');

    const candidates = eligibleForMaster(state).map((p) => p.id);
    if (!candidates.length) return fail('There is nobody available to take over yet.', 'no-candidates');

    if (candidates.length === 1) {
      state.masterId = candidates[0];
      state.election = {
        id: ctx.newId('e'),
        forPlayerId: master ? master.id : null,
        startedAt: ctx.now,
        ballot: 1,
        candidates,
        previousCandidates: null,
        eligible: candidates,
        votes: {},
        counts: { [candidates[0]]: 0 },
        resolvedAt: ctx.now,
        winnerId: candidates[0],
        reason: 'only-candidate',
      };
      return;
    }

    state.election = {
      id: ctx.newId('e'),
      forPlayerId: master ? master.id : null,
      startedAt: ctx.now,
      ballot: 1,
      candidates,
      previousCandidates: null,
      eligible: candidates,
      votes: {},
      counts: null,
      resolvedAt: null,
      winnerId: null,
      reason: null,
    };
  },

  'election/vote'(state, cmd, ctx) {
    const election = state.election;
    if (!election || election.resolvedAt) return fail('That vote has already finished.', 'no-election');
    if (!election.eligible.includes(ctx.actorId)) return fail('You are not part of this vote.', 'not-eligible');
    if (election.votes[ctx.actorId]) return fail('Your vote is already in.', 'already-voted');
    if (cmd.candidateId === ctx.actorId) return fail('You cannot vote for yourself.', 'self-vote');
    if (!election.candidates.includes(cmd.candidateId)) return fail('That player is not standing.');
    election.votes[ctx.actorId] = cmd.candidateId;
    settleElection(state, ctx, false);
  },

  'election/resolve'(state, cmd, ctx) {
    if (!state.election || state.election.resolvedAt) return fail('That vote has already finished.', 'no-election');
    settleElection(state, ctx, true);
  },
};

// ── Guards ───────────────────────────────────────────────────────────────────

/**
 * The checks every play starts with.
 *
 * An auto-played turn has no actor — the server is moving for somebody who is
 * not there — so a missing `actorId` is allowed through only when that seat is
 * actually being auto-played.
 */
function onTurn(state, actorId) {
  if (state.phase !== 'playing') return fail('The game is not being played.', 'wrong-phase');
  if (!state.turnId) return fail('It is nobody’s turn.', 'no-turn');
  const auto = Boolean(state.autoPlay[state.turnId]);
  if (actorId && actorId !== state.turnId) return fail('It is not your turn.', 'not-your-turn');
  if (!actorId && !auto) return fail('It is not your turn.', 'not-your-turn');
  return null;
}

// ── Settling ─────────────────────────────────────────────────────────────────

/**
 * Is the game over, and if so who is left holding the cards?
 *
 * It ends when everybody but one has gone out. The last player is not made to
 * play their remaining cards out — there is nobody to play against and the
 * result is already decided, so making them tap through eight more turns to
 * reach a conclusion the table can already see would be padding.
 *
 * @returns {boolean} true if the game has just ended
 */
function settleGame(state, ctx) {
  if (state.phase !== 'playing') return false;
  const left = stillIn(state);
  if (left.length > 1) return false;

  state.phase = 'complete';
  state.completedAt = ctx.now;
  state.loserId = left.length === 1 ? left[0].id : null;
  state.turnId = null;
  return true;
}

/**
 * Play for anybody the Master has given up waiting on.
 *
 * Loops, because two absent players in a row would otherwise leave the table
 * sitting on the second one. Bounded by the number of seats so a bug in here can
 * never spin.
 */
function advanceAutoPlays(state, ctx) {
  for (let guard = 0; guard <= state.players.length; guard++) {
    if (state.phase !== 'playing' || !state.turnId) return;
    if (!state.autoPlay[state.turnId]) return;

    const id = state.turnId;
    const playable = playableCards(state, id);
    if (playable.length) {
      // The lowest legal card. Not a good move, just a legal one — see the
      // comment on `play/skipTurns`.
      const card = playable.slice().sort((a, b) => valueOf(a) - valueOf(b))[0];
      const landed = place(card, state.table);
      state.table = landed.table;
      state.hands[id] = (state.hands[id] || []).filter((c) => c !== card);
      state.lastEvent = {
        kind: 'play',
        playerId: id,
        card,
        suit: landed.suit,
        end: landed.end,
        completed: isComplete(state.table[landed.suit]),
        auto: true,
        at: ctx.now,
      };
      if (!state.hands[id].length) {
        state.finished.push(id);
        state.lastEvent.wentOut = true;
      }
    } else {
      state.passes[id] = (state.passes[id] || 0) + 1;
      state.lastEvent = { kind: 'pass', playerId: id, auto: true, at: ctx.now };
    }

    if (settleGame(state, ctx)) return;
    state.turnId = nextTurnId(state, id);
  }
}

// ── Elections ────────────────────────────────────────────────────────────────

function settleElection(state, ctx, force) {
  const election = state.election;
  const outcome = resolveBallot({
    candidates: election.candidates,
    votes: election.votes,
    eligible: election.eligible,
    previousCandidates: election.previousCandidates,
    tiebreakOrder: seniority(state),
    force,
  });
  if (outcome.status === 'open') return;
  if (outcome.status === 'runoff') {
    election.previousCandidates = election.candidates;
    election.candidates = outcome.candidates;
    election.counts = outcome.counts;
    election.votes = {};
    election.ballot += 1;
    return;
  }
  election.counts = outcome.counts;
  election.resolvedAt = ctx.now;
  election.winnerId = outcome.winnerId;
  election.reason = outcome.reason;
  state.masterId = outcome.winnerId;
}

module.exports = {
  PHASES,
  MIN_PLAYERS,
  MAX_PLAYERS,
  createGame,
  applyCommand,
  findPlayer,
  activePlayers,
  eligibleForMaster,
  isOut,
  stillIn,
  playableCards,
  nextTurnId,
  sortHand,
  suitOf,
  totalDown,
};
