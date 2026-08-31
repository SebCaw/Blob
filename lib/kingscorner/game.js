'use strict';

const { resolveBallot } = require('../election');
const { uniqueName } = require('../ids');
const { deal, sortHand, valueOf, wants, takes } = require('./deck');
const { BOT_LEVELS, BOT_NAMES } = require('./bot');
const {
  CROSS,
  SLOTS,
  emptyBoard,
  canPlace,
  canMovePile,
  slotsFor,
  pileMoves,
  place,
  movePile,
} = require('./rules');
const { handToBot } = require('../handover');
const { reclaimMaster } = require('../master');

/**
 * The authoritative Kings Corner state and its reducer.
 *
 * Pure, like every other engine here: `applyCommand(state, command, ctx)`
 * returns a new state or a refusal, and `now`, `newId` and every scrap of
 * randomness arrive through `ctx`.
 *
 *   lobby -> playing -> complete
 *
 * Two things about this game shape the code more than they look.
 *
 * **A turn is a chain, not a move.** Everywhere else in this app a turn is one
 * card and the seat moves on. Here you make as many moves as you like, in any
 * order, and then say you are done — so the reducer carries per-turn bookkeeping
 * (`turnPlayed`, `turnMoves`) that is reset by the turn advancing rather than by
 * a command. `play/endTurn` is the only thing that moves the seat.
 *
 * **One of the moves has no card in it.** `play/movePile` touches nobody's hand:
 * it lifts a whole pile off one slot and lands it on another, and the slot it
 * came off is the only way a bare slot is ever made. It is the most important
 * move in the game and it is the one that has no precedent in this repo.
 *
 * A property worth knowing before you go looking for a livelock: **a pile move
 * always reduces the number of occupied slots by exactly one**, because a pile
 * may only land on another pile and never in an empty slot. So the piles cannot
 * be shuffled back and forth, and a turn is bounded by the size of the hand —
 * refilling a slot is the only way to make another move available, and that
 * costs a card. `MAX_TURN_MOVES` is a backstop under an argument, not a fix for
 * a case anybody has seen.
 */

const PHASES = ['lobby', 'playing', 'complete'];

/** Two is a real game here, unlike most of the shelf. */
const MIN_PLAYERS = 2;

/**
 * Six hands of seven plus the four turned into the cross is forty-six cards, so
 * one deck covers it — but the stock left over is six, which empties in a round
 * or two and never comes back. Playable, and four is the game.
 */
const MAX_PLAYERS = 6;

/**
 * How many moves one turn may contain.
 *
 * Unreachable by the argument at the top of this file — a hand of seven cannot
 * produce forty. It is here so that a bug in a bot or a future rule change fails
 * as a refusal in a test rather than as a table that never moves in a pub.
 */
const MAX_TURN_MOVES = 40;

/**
 * The dead-board backstop, in turns of the whole table.
 *
 * Two rather than one because playing is optional: everybody choosing to pass
 * once is a legal position, not a stuck one.
 */
const IDLE_ROUNDS = 2;

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
    game: 'kingscorner',
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
    /** slot -> cards, head first. See `./rules.js`. */
    board: null,
    /** Face down in the middle. Secret; the view sends a count. */
    stock: null,
    turnId: null,
    /** Has a card left the current player's hand this turn? Decides the draw. */
    turnPlayed: false,
    /** How many moves this turn has contained, against `MAX_TURN_MOVES`. */
    turnMoves: 0,
    /**
     * Consecutive turns in which nothing left a hand, no pile moved and nothing
     * was drawn. A turn that draws is progress, so this can only climb once the
     * stock is out — which is why the backstop needs no rule about the stock.
     */
    idleTurns: 0,
    /**
     * What just happened, for the screen to animate from.
     *
     * Everything here is something the whole room watched — a card going face up
     * on a slot, a pile being lifted across, somebody drawing. The one thing it
     * never carries is WHICH card was drawn: that came off a face-down stock into
     * a hand and is nobody else's business.
     */
    lastEvent: null,
    /** playerId -> true while the Master is having their turns played for them. */
    autoPlay: {},
    /** Who won. More than one only when the board died level. */
    winnerIds: [],
    /** 'went-out' | 'dead-board' | 'last-standing' | 'ended-early' */
    endReason: null,
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
  if (!handler) return fail('That action is not something Kings Corner knows how to do.', 'unknown-command');

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

/**
 * Everybody still holding cards.
 *
 * There is no "out" list in this game and there does not need to be: the first
 * player to empty their hand has won and the game stops in the same breath, so
 * nobody is ever out while play continues.
 */
function stillIn(state) {
  return activePlayers(state).filter((p) => (state.hands && state.hands[p.id] ? state.hands[p.id].length : 0) > 0);
}

/** Who may stand in a Master election: a seat with a phone behind it. */
function eligibleForMaster(state) {
  return activePlayers(state).filter((p) => !p.isBot && p.connected);
}

/**
 * Every move this player could make right now.
 *
 * The client shows this rather than working it out, and the reducer enforces it
 * anyway. Empty when it is not your turn, which is what lets the screen key its
 * whole "can I do anything" state off one object.
 *
 * `wants` rides along so an unplayable card can say what it is waiting for. That
 * is presentation, but the rank order behind it is a rule of this game — see
 * `wants` in `./deck.js` for why it comes from here rather than from the phone.
 *
 * @returns {{cards:Record<string,string[]>, piles:Record<string,string[]>, wants:Record<string,object>}}
 */
function playableMoves(state, id) {
  const empty = { cards: {}, piles: {}, wants: {} };
  if (state.phase !== 'playing' || state.turnId !== id) return empty;
  if (!state.hands || !state.board) return empty;

  /** @type {Record<string,string[]>} */
  const cards = {};
  /** @type {Record<string,object>} */
  const waiting = {};
  for (const card of state.hands[id] || []) {
    const slots = slotsFor(card, state.board);
    if (slots.length) cards[card] = slots;
    else {
      const want = wants(card);
      if (want) waiting[card] = want;
    }
  }
  return { cards, piles: pileMoves(state.board), wants: waiting };
}

/** Whose turn is it after this one? Skips anybody who has gone. */
function nextTurnId(state, fromId) {
  const order = activePlayers(state).map((p) => p.id);
  if (!order.length) return null;
  const start = order.indexOf(fromId);
  for (let step = 1; step <= order.length; step++) {
    const id = order[(start + step) % order.length];
    if (id) return id;
  }
  return null;
}

// ── Handlers ─────────────────────────────────────────────────────────────────

const HANDLERS = {
  /** A player joins from their own phone. Lobby only — everybody is dealt at once. */
  'player/join'(state, cmd, ctx) {
    if (state.phase === 'complete') return fail('This game has finished.', 'game-over');
    if (state.phase !== 'lobby') {
      return fail('This game has already started. Ask the group to start a new one.', 'already-started');
    }
    if (state.players.length >= MAX_PLAYERS) {
      return fail(`Kings Corner seats ${MAX_PLAYERS} players at most. This game is full.`, 'game-full');
    }
    const name = uniqueName(String(cmd.name || '').trim() || 'Player', state.players.map((p) => p.name));
    const player = makePlayer({ id: ctx.newId('p'), name, now: ctx.now });
    state.players.push(player);
    return { result: { player } };
  },

  /**
   * The Master sits a bot down.
   *
   * A bot is a player, not a special case: same deal, same turn, same chance of
   * going out first. What it is NOT is a candidate for Master, something
   * `conn/set` can mark away, or something the stall machinery fires for.
   */
  'player/addBot'(state, cmd, ctx) {
    if (!isMaster(state, ctx.actorId)) return fail('Only the Master can add a bot.', 'not-master');
    if (state.phase !== 'lobby') return fail('Bots can only be added before the game starts.');
    if (state.players.length >= MAX_PLAYERS) {
      return fail(`Kings Corner seats ${MAX_PLAYERS} players at most. This game is full.`, 'game-full');
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
   * Mid-game the seat is handed to a bot rather than deleted. Their cards would
   * otherwise vanish from a game where the count of what everybody holds is the
   * only public measure of who is winning.
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

    handToBot(state, target, ctx);
    if (state.masterId === target.id) state.masterId = nextMaster(state) || target.id;
    settleGame(state, ctx);
  },

  /** Seven each, four turned into the cross, the rest face down. */
  'game/start'(state, cmd, ctx) {
    if (!isMaster(state, ctx.actorId)) return fail('Only the Master can start the game.', 'not-master');
    if (state.phase !== 'lobby') return fail('The game has already started.');
    const players = activePlayers(state);
    if (players.length < MIN_PLAYERS) return fail(`You need at least ${MIN_PLAYERS} players.`, 'too-few');

    const ids = players.map((p) => p.id);
    const seed = ctx.newId('deal');
    const dealt = deal(seed, ids);

    state.seed = seed;
    state.hands = dealt.hands;
    state.board = emptyBoard();
    CROSS.forEach((slot, i) => {
      state.board[slot] = [dealt.cross[i]];
    });
    state.stock = dealt.stock;
    state.turnId = ids[0];
    state.turnPlayed = false;
    state.turnMoves = 0;
    state.idleTurns = 0;
    state.lastEvent = null;
    state.winnerIds = [];
    state.endReason = null;
    state.phase = 'playing';
  },

  /**
   * Put a card from your hand into a slot.
   *
   * The reducer checks it is yours and that the slot will take it. It does not
   * ask the screen and it does not trust a client that says a card is playable.
   */
  'play/card'(state, cmd, ctx) {
    const guard = onTurn(state, ctx.actorId);
    if (guard) return guard;

    const id = state.turnId;
    const hand = state.hands[id] || [];
    const card = String(cmd.cardId || '');
    const slot = String(cmd.slot || '');
    if (!hand.includes(card)) return fail('That card is not in your hand.', 'not-yours');
    if (!SLOTS.includes(slot)) return fail('There is no pile there.', 'no-slot');
    if (!canPlace(card, slot, state.board)) {
      return fail(slotRefusal(state, card, slot), 'not-playable');
    }
    if (state.turnMoves >= MAX_TURN_MOVES) return fail('That is enough for one turn.', 'turn-too-long');

    const openedCorner = !state.board[slot].length;
    state.board = place(card, slot, state.board);
    state.hands[id] = hand.filter((c) => c !== card);
    state.turnPlayed = true;
    state.turnMoves += 1;

    state.lastEvent = { kind: 'play', playerId: id, card, slot, opened: openedCorner, at: ctx.now };

    if (!state.hands[id].length) {
      state.phase = 'complete';
      state.completedAt = ctx.now;
      state.winnerIds = [id];
      state.endReason = 'went-out';
      state.turnId = null;
      state.lastEvent.wentOut = true;
    }
  },

  /**
   * Lift a whole pile onto another one.
   *
   * No card leaves anybody's hand, which is why it does not set `turnPlayed` and
   * why a turn spent doing only this still ends in a draw.
   */
  'play/movePile'(state, cmd, ctx) {
    const guard = onTurn(state, ctx.actorId);
    if (guard) return guard;

    const from = String(cmd.from || '');
    const to = String(cmd.to || '');
    if (!SLOTS.includes(from) || !SLOTS.includes(to)) return fail('There is no pile there.', 'no-slot');
    if (from === to) return fail('That pile is already there.', 'same-slot');
    if (!state.board[from].length) return fail('There is nothing on that slot to move.', 'empty-pile');
    if (!state.board[to].length) return fail('A pile can only go onto another pile.', 'empty-target');
    if (!canMovePile(from, to, state.board)) return fail('That pile will not go there.', 'not-playable');
    if (state.turnMoves >= MAX_TURN_MOVES) return fail('That is enough for one turn.', 'turn-too-long');

    const moved = state.board[from].slice();
    state.board = movePile(from, to, state.board);
    state.turnMoves += 1;

    state.lastEvent = { kind: 'move', playerId: state.turnId, from, to, cards: moved, at: ctx.now };
  },

  /**
   * Say you are done.
   *
   * The one command that moves the seat, and the one that decides the draw: if
   * no card left your hand this turn you take one off the stock and your turn is
   * over instantly — you do not get to play it, however well it fits.
   */
  'play/endTurn'(state, cmd, ctx) {
    const guard = onTurn(state, ctx.actorId);
    if (guard) return guard;
    finishTurn(state, ctx, false);
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
   * for them — one legal card, or a draw — until they come back. Deliberately
   * poor: it never moves a pile, because which pile to free is the judgement the
   * game is made of, and being absent should cost you the game rather than be
   * quietly played well on your behalf.
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
    state.endReason = 'ended-early';
    state.turnId = null;
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
    if (player.isBot) return;
    player.connected = Boolean(cmd.connected);
    if (player.connected) {
      player.disconnectedAt = null;
      reclaimMaster(state, player);
      player.awaitingTakeover = false;
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
 * The checks every move starts with.
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

/**
 * Why a card will not go there, in the words you would use at a table.
 *
 * A refusal is shown to a player as-is, and "that is not playable" tells nobody
 * anything they did not already know.
 */
function slotRefusal(state, card, slot) {
  const pile = state.board[slot] || [];
  if (!pile.length) return 'Only a king can open a corner.';
  const want = takes(pile[pile.length - 1]);
  if (!want) return 'That pile has run down to an ace. Nothing goes under it.';
  return `That pile wants a ${want.red ? 'red' : 'black'} ${want.rank}.`;
}

// ── Turns ────────────────────────────────────────────────────────────────────

/**
 * End the turn in front of us and move the seat on.
 *
 * Three things happen here in order and the order matters: the draw, the idle
 * count, and the handover. The draw has to come first because whether anything
 * was drawn is what decides whether the turn counted as idle.
 *
 * @param {boolean} auto whether the server is playing this seat for somebody
 */
function finishTurn(state, ctx, auto) {
  const id = state.turnId;
  const moved = state.turnMoves > 0;
  let drew = false;

  if (!state.turnPlayed && state.stock.length) {
    const card = state.stock.shift();
    state.hands[id] = sortHand([...(state.hands[id] || []), card]);
    drew = true;
  }

  state.lastEvent = {
    kind: 'turn',
    playerId: id,
    // Whether they drew, never WHAT they drew. That card came off a face-down
    // stock into a hand and is nobody else's business.
    drew,
    played: state.turnPlayed,
    moved,
    auto: auto || undefined,
    at: ctx.now,
  };

  if (state.turnPlayed || moved || drew) state.idleTurns = 0;
  else state.idleTurns += 1;

  state.turnId = nextTurnId(state, id);
  state.turnPlayed = false;
  state.turnMoves = 0;

  if (settleGame(state, ctx)) return;
  advanceAutoPlays(state, ctx);
}

// ── Settling ─────────────────────────────────────────────────────────────────

/**
 * Has the game finished, and if so who won?
 *
 * Going out is handled where it happens, inside `play/card`, because it ends the
 * game in the same breath as the card landing. This covers the other two ways it
 * can stop.
 *
 * @returns {boolean} true if the game has just ended
 */
function settleGame(state, ctx) {
  if (state.phase !== 'playing') return false;

  const left = stillIn(state);
  if (left.length < 2) {
    state.phase = 'complete';
    state.completedAt = ctx.now;
    state.winnerIds = left.length === 1 ? [left[0].id] : [];
    state.endReason = 'last-standing';
    state.turnId = null;
    return true;
  }

  // The dead board. Every pile headed by a card nothing goes under, the stock
  // out, and nobody able to do a thing about it — reachable because a pile built
  // down to an ace can never be built on again. Fewest cards wins, shared if it
  // is level, because nobody went out and pretending somebody did would be worse
  // than an honest draw.
  if (state.idleTurns >= left.length * IDLE_ROUNDS) {
    const counts = left.map((p) => ({ id: p.id, held: state.hands[p.id].length }));
    const fewest = Math.min(...counts.map((c) => c.held));
    state.phase = 'complete';
    state.completedAt = ctx.now;
    state.winnerIds = counts.filter((c) => c.held === fewest).map((c) => c.id);
    state.endReason = 'dead-board';
    state.turnId = null;
    return true;
  }

  return false;
}

/**
 * Play for anybody the Master has given up waiting on.
 *
 * One legal card if there is one, then end the turn. Never a pile move: see the
 * comment on `play/skipTurns`. Loops, because two absent players in a row would
 * otherwise leave the table sitting on the second one, and is bounded by the
 * number of seats so a bug in here can never spin.
 */
function advanceAutoPlays(state, ctx) {
  for (let guard = 0; guard <= state.players.length; guard++) {
    if (state.phase !== 'playing' || !state.turnId) return;
    if (!state.autoPlay[state.turnId]) return;

    const id = state.turnId;
    const moves = playableMoves(state, id);
    const cards = Object.keys(moves.cards);
    if (cards.length) {
      // The lowest legal card into the first slot that will take it. Not a good
      // move, just a legal one.
      const card = cards.slice().sort((a, b) => valueOf(a) - valueOf(b))[0];
      const slot = moves.cards[card][0];
      state.board = place(card, slot, state.board);
      state.hands[id] = (state.hands[id] || []).filter((c) => c !== card);
      state.turnPlayed = true;
      state.turnMoves += 1;
      state.lastEvent = { kind: 'play', playerId: id, card, slot, auto: true, at: ctx.now };

      if (!state.hands[id].length) {
        state.phase = 'complete';
        state.completedAt = ctx.now;
        state.winnerIds = [id];
        state.endReason = 'went-out';
        state.turnId = null;
        state.lastEvent.wentOut = true;
        return;
      }
    }

    finishTurn(state, ctx, true);
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
  MAX_TURN_MOVES,
  IDLE_ROUNDS,
  createGame,
  applyCommand,
  findPlayer,
  activePlayers,
  eligibleForMaster,
  stillIn,
  playableMoves,
  nextTurnId,
  sortHand,
};
