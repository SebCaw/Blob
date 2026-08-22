'use strict';

const { roundSequence, deckCheck, MIN_HAND_SIZE } = require('./rounds');
const { scoreRound } = require('./scoring');
const { resolveBallot } = require('./election');
const { uniqueName } = require('./ids');
const { deal, suitOf, legalPlays, lowestPlay, trickWinner, maxOnlineHandSize } = require('./deck');

/**
 * The authoritative Blob game state and its reducer.
 *
 * Everything in here is PURE: `applyCommand(state, command, ctx)` returns a new
 * state (or an error) and never touches the clock, the network or the disk —
 * `ctx` supplies `now` and `newId`. That is what makes the rules testable, and
 * it is what let the digital-cards mode below reuse the scoring engine unchanged.
 *
 * Two modes, one game:
 *
 *   table   lobby -> bidding -> reveal -> summary -> (bidding | complete)
 *   online  lobby -> bidding -> playing -> summary -> (bidding | complete)
 *
 * `reveal` is where the Master types in the tricks everyone won. Online there is
 * nothing to type: the cards are played in `playing` and the round scores itself.
 * The two phases sit in the same slot and never both apply.
 *
 * A Master election is deliberately NOT a phase. It is a parallel `election`
 * object, because the Master can vanish at any point — including after results
 * are entered but before the round advances — and the round underneath must
 * survive intact.
 */

const PHASES = ['lobby', 'bidding', 'reveal', 'playing', 'summary', 'complete'];

/** How a group is playing. `table` is the original game and stays the default. */
const MODES = ['table', 'online'];
const DEFAULT_HAND_SIZE = 7;
const MIN_PLAYERS = 2;

// ── Errors ────────────────────────────────────────────────────────────────────
// Every message here is shown to a player as-is, so they are written in plain
// language. No stack traces, no state-machine jargon.

/** @param {string} message @param {string} [code] */
function fail(message, code = 'rejected') {
  return { error: { code, message } };
}

// ── Creation ─────────────────────────────────────────────────────────────────

/**
 * Create a brand new game with its creator as the first player and Master.
 *
 * @param {{hostName:string, code:string, startHandSize?:number, mode?:'table'|'online'}} args
 * @param {{now:number, newId:(prefix:string)=>string}} ctx
 * @returns {{state:object, player:object}}
 */
function createGame({ hostName, code, startHandSize = DEFAULT_HAND_SIZE, mode = 'table' }, ctx) {
  const host = makePlayer({ id: ctx.newId('p'), name: (hostName || '').trim() || 'Player', now: ctx.now });
  const state = {
    id: ctx.newId('g'),
    code,
    createdAt: ctx.now,
    updatedAt: ctx.now,
    version: 1,
    phase: 'lobby',
    mode: MODES.includes(mode) ? mode : 'table',
    startHandSize: clampHandSize(startHandSize),
    sequence: [],
    roundIndex: -1,
    masterId: host.id,
    players: [host],
    rounds: [],
    election: null,
    deckWarningAcknowledged: false,
    completedAt: null,
    /** Set once the Master starts a rematch — see 'game/rematchStarted' below. */
    rematchGameId: null,
    rematchCode: null,
  };
  return { state, player: host };
}

/** @param {{id:string,name:string,now:number,isOffline?:boolean}} args */
function makePlayer({ id, name, now, isOffline = false }) {
  return {
    id,
    name,
    isOffline,
    connected: !isOffline,
    joinedAt: now,
    disconnectedAt: null,
    /** Set when a disconnected player's grace period expires: the Master may
     *  then bid on their behalf. Never set for offline players. */
    awaitingTakeover: false,
    /** Set for a player who joined mid-game: the first round they are dealt into. */
    joinsAtRound: null,
    total: 0,
  };
}

function clampHandSize(n) {
  const value = Number(n);
  if (!Number.isInteger(value) || value < MIN_HAND_SIZE) return MIN_HAND_SIZE;
  return value;
}

// ── Reducer ──────────────────────────────────────────────────────────────────

/**
 * Apply one command to the state.
 *
 * @param {object} state
 * @param {{type:string, [k:string]:any}} command
 * @param {{now:number, newId:(prefix:string)=>string, actorId?:string|null}} ctx
 * @returns {{state:object}|{error:{code:string,message:string}}}
 */
function applyCommand(state, command, ctx) {
  const handler = HANDLERS[command.type];
  if (!handler) return fail('That action is not something Blob knows how to do.', 'unknown-command');

  const next = clone(state);
  const result = handler(next, command, ctx);
  if (result && result.error) return result;

  next.version = state.version + 1;
  next.updatedAt = ctx.now;
  return { state: next, result: (result && result.result) || null };
}

/** Structured clone keeps the reducer honest — callers can't mutate the input. */
function clone(state) {
  return JSON.parse(JSON.stringify(state));
}

// ── Helpers over state ───────────────────────────────────────────────────────

const findPlayer = (state, id) => state.players.find((p) => p.id === id) || null;
const isMaster = (state, actorId) => Boolean(actorId) && state.masterId === actorId;
const currentRound = (state) => (state.roundIndex >= 0 ? state.rounds[state.roundIndex] : null);

/** Is Blob dealing the cards? */
const isOnline = (state) => state.mode === 'online';

/**
 * The biggest starting hand this line-up can be dealt.
 *
 * Round a table this is only ever a warning, because a group can shuffle two
 * decks together. Online it is a hard limit — a duplicate card would make
 * "which of these two aces of spades won?" unanswerable — so the lobby caps
 * the stepper rather than letting the Master pick something that cannot be dealt.
 */
function handSizeCeiling(state) {
  return isOnline(state) ? maxOnlineHandSize(state.players.length) : Infinity;
}

/**
 * The most players Blob can deal to: everyone needs the smallest legal hand and
 * a card still has to be left over to turn for trumps. Round a table there is no
 * such limit — bring as many decks as you like.
 */
const MAX_ONLINE_PLAYERS = 17;

/** Players who can be Master: they need a device of their own. */
const eligibleForMaster = (state) =>
  state.players.filter((p) => !p.isOffline && p.connected && p.id !== state.masterId);

/** Seniority order for deterministic tiebreaks: longest-standing player first. */
const seniority = (state) => [...state.players].sort((a, b) => a.joinedAt - b.joinedAt).map((p) => p.id);

/**
 * Who is actually in a given round.
 *
 * Someone who joins mid-game cannot be dealt into a hand that is already being
 * played, so a round remembers the seats it was dealt to and the newcomer sits
 * the rest of it out. A round with no roster recorded — every table round, and
 * every round dealt before anyone joined late — is simply everybody, so nothing
 * about the original game changes shape.
 */
function roundPlayers(state, round) {
  if (!round || !round.playerIds) return state.players;
  return state.players.filter((p) => round.playerIds.includes(p.id));
}

/** Is this player dealt into this round, or are they waiting for the next one? */
const inRound = (state, round, playerId) => roundPlayers(state, round).some((p) => p.id === playerId);

/** Everyone who will be dealt into round `index`, in seating order. */
function playersForRound(state, index) {
  return state.players.filter((p) => !p.left && (p.joinsAtRound == null || p.joinsAtRound <= index));
}

/**
 * Who leads the first trick of round `index`.
 *
 * The lead moves round the table a seat per round, the way the deal does with
 * real cards, so the same person is not always first to commit. Worked out from
 * the round number rather than stored, so the screen can say who leads the NEXT
 * hand before that hand has been dealt.
 */
function leadIdForRound(state, index) {
  const ids = playersForRound(state, index).map((p) => p.id);
  return ids.length ? ids[index % ids.length] : null;
}

/** Has every player in this round got a bid down? */
function everyoneHasBid(state) {
  const round = currentRound(state);
  if (!round) return false;
  return roundPlayers(state, round).every((p) => round.bids[p.id]);
}

// ── Command handlers ─────────────────────────────────────────────────────────

const HANDLERS = {
  /**
   * A player joins from their own phone.
   *
   * Before the game starts this is just the lobby. Online, it also works once a
   * game is under way: someone arriving at round four is dealt in from round
   * five, starts on nothing, and plays the rest of the game as an equal. They
   * cannot be dealt into a hand that is already being played, and the hand size
   * does NOT shrink to make room — everyone already holding cards keeps them, so
   * a latecomer never shortens the game for the people who were there on time.
   *
   * Round a table this still refuses: the cards are physically dealt, so a
   * latecomer is something the group sorts out themselves.
   */
  'player/join'(state, cmd, ctx) {
    const started = state.phase !== 'lobby';
    if (started && !isOnline(state)) {
      return fail('This game has already started. Ask the group to start a new one.', 'already-started');
    }
    if (state.phase === 'complete') return fail('This game has finished.', 'game-over');
    if (isOnline(state) && state.players.length >= MAX_ONLINE_PLAYERS) {
      return fail(`Blob can deal to ${MAX_ONLINE_PLAYERS} players at most. This game is full.`, 'game-full');
    }
    if (started) {
      const remaining = state.sequence.slice(state.roundIndex + 1);
      if (!remaining.length) {
        return fail('This game is on its last hand. Start a new one and go again.', 'too-late');
      }
      // The hand size is fixed now, so the question is whether the deck still
      // stretches to one more player at the biggest hand still to come.
      const biggest = Math.max(...remaining);
      if ((state.players.length + 1) * biggest + 1 > 52) {
        return fail('There are not enough cards left in the deck for another player.', 'game-full');
      }
    }

    const name = uniqueName(String(cmd.name || '').trim() || 'Player', state.players.map((p) => p.name));
    const player = makePlayer({ id: ctx.newId('p'), name, now: ctx.now });
    // Everyone starts on nothing. A latecomer is behind, which is the honest
    // position to arrive in — no catch-up points, no averaging.
    if (started) player.joinsAtRound = state.roundIndex + 1;
    state.players.push(player);
    // Before the off, one more player means fewer cards to go round. Trimming the
    // hand size is friendlier than turning someone away at the door.
    if (isOnline(state) && !started) {
      state.startHandSize = Math.min(state.startHandSize, handSizeCeiling(state));
    }
    return { result: { player } };
  },

  /** The Master adds someone with no working phone. They bid on the Master's phone. */
  'player/addOffline'(state, cmd, ctx) {
    if (!isMaster(state, ctx.actorId)) return fail('Only the Master can add players.', 'not-master');
    if (state.phase !== 'lobby') return fail('Offline players can only be added before the game starts.');
    // A hand of cards has to live on a phone. There is nowhere to put one for a
    // player who hasn't got one, and the Master holding it would see it.
    if (isOnline(state)) {
      return fail('Everyone needs their own phone to be dealt a hand. Play round a table instead.', 'needs-phone');
    }
    const name = uniqueName(String(cmd.name || '').trim() || 'Player', state.players.map((p) => p.name));
    const player = makePlayer({ id: ctx.newId('p'), name, now: ctx.now, isOffline: true });
    state.players.push(player);
    return { result: { player } };
  },

  /**
   * Remove a player from the lobby — the Master may remove anyone, and you may
   * always remove yourself.
   *
   * Online there is a second window: between hands, the Master can let go of
   * somebody whose phone has gone for good, so the rest of the group is not
   * waiting on them every trick. They keep the points they won and their seat
   * turns into a line on the scoreboard rather than vanishing; if they come back
   * they join like anyone else — from the next hand, on nothing.
   */
  'player/remove'(state, cmd, ctx) {
    if (state.phase !== 'lobby') {
      const round = currentRound(state);
      if (!isOnline(state) || state.phase !== 'summary') {
        return fail('Players can only be removed before the game starts, or between hands.', 'not-between-hands');
      }
      if (!isMaster(state, ctx.actorId)) return fail('Only the Master can do that.', 'not-master');
      const player = findPlayer(state, cmd.playerId);
      if (!player || player.left) return fail('That player has already left.');
      if (player.connected) return fail(`${player.name} is still with us.`, 'still-here');
      const remaining = state.players.filter((p) => !p.left && p.id !== player.id);
      if (remaining.length < MIN_PLAYERS) {
        return fail('There would not be enough players left for a game.', 'too-few');
      }
      player.left = true;
      player.leftAt = ctx.now;
      player.awaitingTakeover = false;
      if (round && round.autoPlay) delete round.autoPlay[player.id];
      if (state.masterId === player.id) {
        state.masterId = seniority(state).find((id) => {
          const p = findPlayer(state, id);
          return p && !p.left && !p.isOffline;
        }) || remaining[0].id;
      }
      return;
    }

    const target = findPlayer(state, cmd.playerId);
    if (!target) return fail('That player has already left.');
    if (!isMaster(state, ctx.actorId) && ctx.actorId !== target.id) {
      return fail('Only the Master can remove other players.', 'not-master');
    }
    state.players = state.players.filter((p) => p.id !== target.id);
    if (!state.players.length) return fail('A game needs at least one player.', 'empty-game');
    if (state.masterId === target.id) {
      state.masterId = seniority(state).find((id) => {
        const p = findPlayer(state, id);
        return p && !p.isOffline;
      }) || state.players[0].id;
    }
  },

  /** The Master picks the starting hand size. Everything else follows from it. */
  'game/setHandSize'(state, cmd, ctx) {
    if (!isMaster(state, ctx.actorId)) return fail('Only the Master can change the hand size.', 'not-master');
    if (state.phase !== 'lobby') return fail('The hand size is locked once the game starts.');
    const wanted = Number(cmd.handSize);
    if (!Number.isInteger(wanted) || wanted < MIN_HAND_SIZE) {
      return fail(`The starting hand needs to be at least ${MIN_HAND_SIZE} cards.`);
    }
    const ceiling = handSizeCeiling(state);
    if (wanted > ceiling) {
      return fail(
        `With ${state.players.length} players Blob can deal ${ceiling} cards each at most — one card has to be left ` +
          'over to turn for trumps.',
        'hand-too-big'
      );
    }
    state.startHandSize = wanted;
    state.deckWarningAcknowledged = false;
  },

  /** The Master has seen the "you'll need more than one deck" warning and is happy. */
  'game/acknowledgeDeck'(state, cmd, ctx) {
    if (!isMaster(state, ctx.actorId)) return fail('Only the Master can do that.', 'not-master');
    state.deckWarningAcknowledged = true;
  },

  /** Deal the first round. */
  'game/start'(state, cmd, ctx) {
    if (!isMaster(state, ctx.actorId)) return fail('Only the Master can start the game.', 'not-master');
    if (state.phase !== 'lobby') return fail('The game is already under way.');
    if (state.players.length < MIN_PLAYERS) return fail('Blob needs at least 2 players.');
    if (isOnline(state) && state.startHandSize > handSizeCeiling(state)) {
      return fail(
        `${state.players.length} players cannot be dealt ${state.startHandSize} cards each from one deck. ` +
          `Drop the hand size to ${handSizeCeiling(state)}.`,
        'hand-too-big'
      );
    }
    state.sequence = roundSequence(state.startHandSize);
    state.roundIndex = 0;
    state.rounds = [newRound(0, state.sequence[0])];
    state.phase = 'bidding';
    state.startedAt = ctx.now;
    if (isOnline(state)) dealRound(state, state.rounds[0], ctx);
  },

  /**
   * Put a bid down. Bids are immutable once submitted — that is the whole
   * fairness guarantee, so it is enforced here rather than in the UI.
   */
  'bid/submit'(state, cmd, ctx) {
    if (state.phase !== 'bidding') return fail('Bidding is closed for this round.', 'not-bidding');
    const round = currentRound(state);
    if (!round || round.locked) return fail('Bidding is closed for this round.', 'not-bidding');

    const target = findPlayer(state, cmd.playerId);
    if (!target) return fail('We could not find that player.');
    if (!inRound(state, round, target.id)) {
      return fail('You are in from the next hand — this one was already being played.', 'not-in-round');
    }
    if (round.bids[target.id]) return fail('That bid is already in and cannot be changed.', 'bid-locked');

    const value = Number(cmd.value);
    if (!Number.isInteger(value) || value < 0 || value > round.handSize) {
      return fail(`A bid this round has to be between 0 and ${round.handSize}.`, 'bad-bid');
    }

    const enteredBy = bidAuthority(state, target, ctx.actorId);
    if (!enteredBy) return fail('You can only submit your own bid.', 'not-allowed');

    round.bids[target.id] = { value, enteredBy, at: ctx.now };

    // Lock exactly once, the moment the last bid lands. Commands are applied one
    // at a time per game, so simultaneous submissions can't both trip this.
    if (everyoneHasBid(state)) {
      round.locked = true;
      round.lockedAt = ctx.now;
      // Round a table the bids are read out and the hand is played with real
      // cards; online the first trick opens here and the round scores itself.
      state.phase = isOnline(state) ? 'playing' : 'reveal';
      if (isOnline(state)) openTrick(state, round, round.leadId, ctx);
    }
  },

  /**
   * Play a card. Online only — round a table the cards are in your hand and the
   * Master types in the result at the end.
   *
   * Everything a client could get wrong is checked here rather than in the UI:
   * whose turn it is, whether you hold the card, and whether it follows suit.
   * The lift on the playing screen is only this rule, drawn.
   */
  'trick/play'(state, cmd, ctx) {
    if (!isOnline(state)) return fail('This game is being played with real cards.', 'not-online');
    if (state.phase !== 'playing') return fail('There is no trick to play into right now.', 'not-playing');
    const round = currentRound(state);
    if (!round || !round.trick) return fail('There is no trick to play into right now.', 'not-playing');

    const trick = round.trick;
    const player = findPlayer(state, trick.turnId);
    if (!player) return fail('We could not find whose turn it is.');
    // No takeover here, deliberately: the Master covering a dropped player would
    // have to be shown their hand, and that is the one thing this mode cannot do.
    if (ctx.actorId !== trick.turnId) {
      return fail(`It is ${player.name}'s turn.`, 'not-your-turn');
    }

    const hand = round.hands[trick.turnId] || [];
    // Holding one card there is nothing to choose, so the card need not be
    // named — which is what makes the forehead round playable at all: you are
    // not allowed to know what you are about to put down.
    const cardId = !cmd.cardId && hand.length === 1 ? hand[0] : String(cmd.cardId || '');
    if (!hand.includes(cardId)) return fail('That card is not in your hand.', 'not-held');
    if (!legalPlays(hand, trick.ledSuit).includes(cardId)) {
      return fail(`You have to follow ${suitName(trick.ledSuit)} while you can.`, 'must-follow');
    }

    const outcome = playCard(state, round, trick.turnId, cardId, ctx);
    return { result: outcome };
  },

  /**
   * A player whose phone has dropped has left the trick hanging. Server-driven,
   * like `conn/takeover`: it does not act, it only puts the choice in front of
   * the Master. Idempotent, and it evaporates the moment they play or come back.
   */
  'trick/stalled'(state, cmd) {
    if (!isOnline(state) || state.phase !== 'playing') return;
    const round = currentRound(state);
    if (!round || !round.trick) return;
    if (round.trick.turnId !== cmd.playerId) return; // they have since played
    const player = findPlayer(state, cmd.playerId);
    if (!player || player.connected) return; // they are back — nothing to offer
    round.stalledPlayerId = cmd.playerId;
  },

  /**
   * The Master skips a missing player's turns for the rest of this hand.
   *
   * "Skip" cannot mean nothing: a trick needs a card from everybody, and their
   * cards have to leave their hand for the round to finish. So Blob plays their
   * worst legal card each time their turn comes round — they keep their bid and
   * will almost certainly miss it, which is the right cost for not being there.
   *
   * It lasts one round, and it stops the moment they reconnect.
   */
  'trick/skipTurns'(state, cmd, ctx) {
    if (!isMaster(state, ctx.actorId)) return fail('Only the Master can do that.', 'not-master');
    if (!isOnline(state)) return fail('This game is being played with real cards.', 'not-online');
    if (state.phase !== 'playing') return fail('There is no hand being played.', 'not-playing');
    const round = currentRound(state);
    if (!round || !round.trick) return fail('There is no hand being played.', 'not-playing');

    const target = findPlayer(state, cmd.playerId);
    if (!target) return fail('We could not find that player.');
    if (!inRound(state, round, target.id)) return fail('They are not in this hand.', 'not-in-round');
    if (target.connected) return fail(`${target.name} is still with us.`, 'still-here');
    if (round.autoPlay && round.autoPlay[target.id]) return; // already skipping — a second tap is a no-op

    round.autoPlay = round.autoPlay || {};
    round.autoPlay[target.id] = true;
    if (round.stalledPlayerId === target.id) round.stalledPlayerId = null;
    // If they are the one holding everything up, get the hand moving again.
    advanceAutoPlays(state, round, ctx);
  },

  /** The Master types in how many tricks each player actually won. */
  'results/submit'(state, cmd, ctx) {
    if (!isMaster(state, ctx.actorId)) return fail('Only the Master can enter the results.', 'not-master');
    if (isOnline(state)) return fail('Blob dealt these cards, so it already knows who won what.', 'not-table');
    if (state.phase !== 'reveal') return fail('Those results are already in.', 'results-in');
    const round = currentRound(state);
    if (!round) return fail('There is no round to score.');

    const tricks = cmd.tricks || {};
    let total = 0;
    for (const player of state.players) {
      const won = Number(tricks[player.id]);
      if (!Number.isInteger(won) || won < 0 || won > round.handSize) {
        return fail(`${player.name}'s tricks need to be between 0 and ${round.handSize}.`, 'bad-tricks');
      }
      total += won;
    }
    // A round has exactly `handSize` tricks in it. A mismatch is almost always a
    // typo, so we stop — but the Master can insist, because house rules exist.
    if (total !== round.handSize && !cmd.force) {
      return fail(
        `That adds up to ${total} tricks, but this round only has ${round.handSize}. Check the numbers.`,
        'trick-total'
      );
    }

    round.tricks = {};
    round.scores = {};
    round.totalsAfter = {};
    for (const player of state.players) {
      const won = Number(tricks[player.id]);
      const points = scoreRound(round.bids[player.id].value, won);
      round.tricks[player.id] = won;
      round.scores[player.id] = points;
      player.total += points;
      round.totalsAfter[player.id] = player.total;
    }
    round.completedAt = ctx.now;
    round.trickTotalOverridden = total !== round.handSize;
    state.phase = 'summary';
  },

  /**
   * Correct a round that has already been scored.
   *
   * Without this a mistyped trick count was permanent: results/submit refuses
   * once the phase leaves 'reveal', and nothing else could touch a scored
   * round — so an app whose whole job is settling arguments could be quietly,
   * unfixably wrong. Any completed round can be corrected, not just the last
   * one, because a mistake is often only spotted a round or two later.
   *
   * Every later round's running total is rebuilt from the corrected scores,
   * so the leaderboard cannot drift out of step with the rounds beneath it.
   */
  'results/amend'(state, cmd, ctx) {
    if (!isMaster(state, ctx.actorId)) return fail('Only the Master can correct the scores.', 'not-master');
    // Nothing was typed in, so there is nothing to have mistyped. The tricks
    // online are what was actually played.
    if (isOnline(state)) return fail('Blob counted these tricks itself, so there is nothing to correct.', 'not-table');
    const index = Number(cmd.roundIndex);
    const round = state.rounds.find((r) => r.index === index);
    if (!round || !round.completedAt) return fail('That round has not been scored yet.');

    const tricks = cmd.tricks || {};
    let total = 0;
    for (const player of state.players) {
      const won = Number(tricks[player.id]);
      if (!Number.isInteger(won) || won < 0 || won > round.handSize) {
        return fail(`${player.name}'s tricks need to be between 0 and ${round.handSize}.`, 'bad-tricks');
      }
      total += won;
    }
    // Same guard as entering them the first time, and the same escape hatch.
    if (total !== round.handSize && !cmd.force) {
      return fail(
        `That adds up to ${total} tricks, but round ${round.index + 1} only has ${round.handSize}. Check the numbers.`,
        'trick-total'
      );
    }

    round.tricks = {};
    for (const player of state.players) round.tricks[player.id] = Number(tricks[player.id]);
    round.trickTotalOverridden = total !== round.handSize;
    round.amendedAt = ctx.now;
    state.amendedAt = ctx.now;
    recomputeTotals(state);
  },

  /**
   * End the game where it stands. A game that fizzles out — people leave, the
   * pub closes — would otherwise sit unfinished until it was swept hours
   * later, and never reach the history. Idempotent, so a double tap is a no-op
   * rather than an error.
   */
  'game/end'(state, cmd, ctx) {
    if (!isMaster(state, ctx.actorId)) return fail('Only the Master can end the game.', 'not-master');
    if (state.phase === 'lobby') return fail('The game has not started yet.');
    if (state.phase === 'complete') return; // already over — nothing to do
    state.phase = 'complete';
    state.completedAt = ctx.now;
    state.endedEarly = true;
  },

  /** On to the next hand — or the end of the game. */
  'round/next'(state, cmd, ctx) {
    if (!isMaster(state, ctx.actorId)) return fail('Only the Master can move the game on.', 'not-master');
    if (state.phase !== 'summary') return fail('The round is not finished yet.');
    const nextIndex = state.roundIndex + 1;
    if (nextIndex >= state.sequence.length) {
      state.phase = 'complete';
      state.completedAt = ctx.now;
      return;
    }
    state.roundIndex = nextIndex;
    const round = newRound(nextIndex, state.sequence[nextIndex]);
    state.rounds.push(round);
    state.phase = 'bidding';
    if (isOnline(state)) dealRound(state, round, ctx);
  },

  /**
   * Record that the Master has started a rematch, once a fresh game exists for
   * it. This command does not CREATE that game — a second game is cross-room
   * orchestration (a new id, new sessions, other players' connections), which
   * is server concern, not something a pure reducer can do. This is purely the
   * announcement: everyone still looking at this finished game gets told where
   * the new one is, without a token or anything sensitive going anywhere near
   * the broadcast state.
   *
   * Idempotent on purpose — a double-tapped "Play again" must not be treated as
   * an error, since the server may have already created the rematch and simply
   * be reporting the same one back.
   */
  'game/rematchStarted'(state, cmd, ctx) {
    if (!isMaster(state, ctx.actorId)) return fail('Only the Master can start a rematch.', 'not-master');
    if (state.phase !== 'complete') return fail('The game is not over yet.');
    if (state.rematchGameId) return; // already recorded — nothing to do
    if (!cmd.gameId || !cmd.code) return fail('That rematch is missing its details.');
    state.rematchGameId = cmd.gameId;
    state.rematchCode = cmd.code;
  },

  /** Connection bookkeeping, driven by the server, never by a client claim. */
  'conn/set'(state, cmd, ctx) {
    const player = findPlayer(state, cmd.playerId);
    if (!player) return fail('We could not find that player.');
    if (player.isOffline) return; // offline players have no connection to track
    player.connected = Boolean(cmd.connected);
    if (player.connected) {
      player.disconnectedAt = null;
      player.awaitingTakeover = false;
      // Back before the hand ended: stop playing their cards for them, and take
      // the Master's skip offer away.
      const round = currentRound(state);
      if (round) {
        if (round.autoPlay) delete round.autoPlay[player.id];
        if (round.stalledPlayerId === player.id) round.stalledPlayerId = null;
      }
      // A Master who comes back before anyone has voted keeps the crown: a
      // 45-second phone blip shouldn't cost them the game. Once a vote is cast
      // the election stands, and per the rules they do not get it back.
      if (state.election && !state.election.resolvedAt && state.election.forPlayerId === player.id) {
        const votesCast = Object.keys(state.election.votes).length;
        if (votesCast === 0) state.election = null;
      }
    } else {
      player.disconnectedAt = ctx.now;
    }
  },

  /** A disconnected player's grace period ran out: the Master can now cover them. */
  'conn/takeover'(state, cmd) {
    const player = findPlayer(state, cmd.playerId);
    if (!player) return fail('We could not find that player.');
    if (player.connected || player.isOffline) return fail('That player is still with us.');
    player.awaitingTakeover = true;
  },

  /** The Master is gone for good — start the vote for a new one. */
  'election/start'(state, cmd, ctx) {
    if (state.election && !state.election.resolvedAt) return fail('A vote is already running.', 'election-open');
    if (state.phase === 'complete') return fail('The game is already over.');
    const master = findPlayer(state, state.masterId);
    if (master && master.connected) return fail('The Master is still connected.', 'master-present');

    const candidates = eligibleForMaster(state).map((p) => p.id);
    if (!candidates.length) return fail('There is nobody available to take over yet.', 'no-candidates');

    // One candidate needs no ballot — there is nobody else to choose.
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

  /** A private vote. You cannot vote for yourself, and nobody sees it until the tally. */
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

  /** Tally now, even if somebody never voted (the vote timed out). */
  'election/resolve'(state, cmd, ctx) {
    if (!state.election || state.election.resolvedAt) return fail('That vote has already finished.', 'no-election');
    settleElection(state, ctx, true);
  },
};

/** @param {number} index @param {number} handSize */
function newRound(index, handSize) {
  return {
    index,
    handSize,
    bids: {},
    locked: false,
    lockedAt: null,
    tricks: null,
    scores: null,
    totalsAfter: null,
    completedAt: null,
    trickTotalOverridden: false,
  };
}

// ── Dealing and playing (online mode only) ───────────────────────────────────
// A table-mode round never grows any of the fields below, so its state is
// exactly what it was before this mode existed.

/**
 * Deal the round: a fresh shuffle from a seed of its own, stored alongside the
 * hands. Storing the seed is what makes a deal checkable afterwards — the same
 * seed deals the same round again, so "that hand was rigged" has an answer.
 */
function dealRound(state, round, ctx) {
  // Anyone who joined after this round started waits for the next one. The roster
  // is written down rather than worked out later, so a round always knows who was
  // in it however the line-up changed afterwards.
  const playerIds = playersForRound(state, round.index).map((p) => p.id);
  const seed = ctx.newId('deal');
  const { hands, trumpCard, trumpSuit } = deal(seed, playerIds, round.handSize);

  round.playerIds = playerIds;
  round.seed = seed;
  round.hands = hands;
  round.trumpCard = trumpCard;
  round.trumpSuit = trumpSuit;
  round.tricksWon = Object.fromEntries(playerIds.map((id) => [id, 0]));
  round.tricksPlayed = [];
  round.trick = null;
  // Skipping is per hand: a phone that comes back between rounds is simply back.
  round.autoPlay = {};
  round.stalledPlayerId = null;
  round.leadId = leadIdForRound(state, round.index);
}

/**
 * Put one card on the table, settle the trick if that was the last of them, and
 * then let anyone being skipped play themselves out.
 *
 * The caller has already checked that this play is allowed. Auto-plays go
 * through here too, so a skipped player's card is settled by exactly the same
 * code as a tapped one — there is no second, quieter path through the rules.
 */
function playCard(state, round, playerId, cardId, ctx) {
  const trick = round.trick;
  round.hands[playerId] = (round.hands[playerId] || []).filter((c) => c !== cardId);
  trick.plays.push({ playerId, cardId, at: ctx.now });
  if (!trick.ledSuit) trick.ledSuit = suitOf(cardId);
  // Whatever they were waiting for has happened.
  if (round.stalledPlayerId === playerId) round.stalledPlayerId = null;

  if (trick.plays.length < roundPlayers(state, round).length) {
    trick.turnId = nextToPlay(state, round, trick.turnId);
    advanceAutoPlays(state, round, ctx);
    return { roundOver: state.phase === 'summary' };
  }

  // Everyone has played: settle it, credit the winner, and let them lead next.
  const winnerId = trickWinner(trick.plays, trick.ledSuit, round.trumpSuit);
  round.tricksWon[winnerId] += 1;
  round.tricksPlayed.push({
    number: trick.number,
    ledSuit: trick.ledSuit,
    plays: trick.plays.map(({ playerId: id, cardId: card }) => ({ playerId: id, cardId: card })),
    winnerId,
  });

  const handsEmpty = roundPlayers(state, round).every((p) => (round.hands[p.id] || []).length === 0);
  if (handsEmpty) {
    round.trick = null;
    scoreDealtRound(state, round, ctx);
    return { trickWinnerId: winnerId, roundOver: true };
  }
  openTrick(state, round, winnerId, ctx);
  advanceAutoPlays(state, round, ctx);
  return { trickWinnerId: winnerId, roundOver: state.phase === 'summary' };
}

/**
 * Play for every skipped player the turn lands on, until it reaches somebody who
 * is actually there — or the hand runs out.
 *
 * Bounded by the cards left in play, so a round of skipped players finishes
 * rather than spinning.
 */
function advanceAutoPlays(state, round, ctx) {
  let guard = roundPlayers(state, round).length * round.handSize + 1;
  while (guard-- > 0) {
    if (state.phase !== 'playing' || !round.trick) return;
    const turnId = round.trick.turnId;
    if (!round.autoPlay || !round.autoPlay[turnId]) return;
    const hand = round.hands[turnId] || [];
    const cardId = lowestPlay(hand, round.trick.ledSuit, round.trumpSuit);
    if (!cardId) return;
    playCard(state, round, turnId, cardId, ctx);
  }
}

/** Open a fresh trick for `leaderId` to lead. */
function openTrick(state, round, leaderId, ctx) {
  round.trick = {
    number: round.tricksPlayed.length + 1,
    leaderId,
    turnId: leaderId,
    ledSuit: null,
    plays: [],
    startedAt: ctx.now,
  };
}

/** The next seat round, among the players dealt into this round. */
function nextToPlay(state, round, currentId) {
  const ids = roundPlayers(state, round).map((p) => p.id);
  const at = ids.indexOf(currentId);
  return ids[(at + 1) % ids.length];
}

/**
 * The last trick has landed, so the round scores itself.
 *
 * This is the same arithmetic the Master's typed-in results go through — the
 * scoring engine does not know or care which mode fed it, and must not learn.
 */
function scoreDealtRound(state, round, ctx) {
  round.tricks = {};
  round.scores = {};
  round.totalsAfter = {};
  const playing = roundPlayers(state, round);
  for (const player of playing) {
    const won = round.tricksWon[player.id] || 0;
    const points = scoreRound(round.bids[player.id].value, won);
    round.tricks[player.id] = won;
    round.scores[player.id] = points;
    player.total += points;
    round.totalsAfter[player.id] = player.total;
  }
  // Anyone waiting to be dealt in still gets a line on the scoreboard, so the
  // running totals read straight down the column with no gaps.
  for (const player of state.players) {
    if (!playing.includes(player)) round.totalsAfter[player.id] = player.total;
  }
  round.completedAt = ctx.now;
  state.phase = 'summary';
}

/** Suit names for refusals, which are shown to a player word for word. */
const SUIT_NAMES = { S: 'spades', H: 'hearts', D: 'diamonds', C: 'clubs' };
const suitName = (suit) => SUIT_NAMES[suit] || 'the suit that was led';

/**
 * Who is allowed to put this bid down, and how it gets recorded in history.
 *
 *  - 'self'    the player, on their own phone
 *  - 'offline' the player, choosing privately on the Master's phone
 *  - 'master'  the Master covering someone whose phone has dropped out
 *
 * The Master can never touch a connected player's bid. That is the rule the
 * whole game's fairness rests on.
 *
 * @returns {'self'|'offline'|'master'|null}
 */
function bidAuthority(state, target, actorId) {
  if (actorId === target.id) return 'self';
  if (!isMaster(state, actorId)) return null;
  if (target.isOffline) return 'offline';
  if (!target.connected && target.awaitingTakeover) return 'master';
  return null;
}

/** Run the tally and either finish the election, open a runoff, or wait. */
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
    election.lastBallot = { ballot: election.ballot, counts: outcome.counts };
    election.ballot += 1;
    election.votes = {};
    // Voters stay the same, but anyone who has since dropped out can't hold it up.
    election.eligible = election.eligible.filter((id) => {
      const p = findPlayer(state, id);
      return p && p.connected && !p.isOffline;
    });
    if (!election.eligible.length) settleElection(state, ctx, true);
    return;
  }

  election.counts = outcome.counts;
  election.winnerId = outcome.winnerId;
  election.reason = outcome.reason;
  election.resolvedAt = ctx.now;
  state.masterId = outcome.winnerId;
}

/**
 * Rebuild every scored round's points and running totals from its bids and
 * tricks. Correcting round 3 changes what rounds 4 and 5 were standing on, so
 * the totals are recomputed from the bottom rather than patched in place.
 */
function recomputeTotals(state) {
  for (const player of state.players) player.total = 0;
  for (const round of state.rounds) {
    if (!round.completedAt) continue;
    round.scores = {};
    round.totalsAfter = {};
    for (const player of state.players) {
      const bid = round.bids[player.id];
      const won = round.tricks ? round.tricks[player.id] : null;
      if (bid && Number.isInteger(won)) {
        const points = scoreRound(bid.value, won);
        round.scores[player.id] = points;
        player.total += points;
      }
      round.totalsAfter[player.id] = player.total;
    }
  }
}

// ── Derived reads (no mutation) ──────────────────────────────────────────────

/** The deck warning for the current line-up. Never blocks anything. */
function gameDeckCheck(state) {
  return deckCheck(state.players.length, state.startHandSize);
}

module.exports = {
  PHASES,
  MODES,
  DEFAULT_HAND_SIZE,
  MIN_PLAYERS,
  MAX_ONLINE_PLAYERS,
  createGame,
  applyCommand,
  currentRound,
  findPlayer,
  eligibleForMaster,
  seniority,
  everyoneHasBid,
  gameDeckCheck,
  isOnline,
  handSizeCeiling,
  roundPlayers,
  inRound,
  leadIdForRound,
};
