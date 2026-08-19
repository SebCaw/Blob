'use strict';

const { roundSequence, deckCheck, MIN_HAND_SIZE } = require('./rounds');
const { scoreRound } = require('./scoring');
const { resolveBallot } = require('./election');
const { uniqueName } = require('./ids');

/**
 * The authoritative Blob game state and its reducer.
 *
 * Everything in here is PURE: `applyCommand(state, command, ctx)` returns a new
 * state (or an error) and never touches the clock, the network or the disk —
 * `ctx` supplies `now` and `newId`. That is what makes the rules testable, and
 * what would let a future digital-cards mode reuse this file unchanged.
 *
 * Phases: lobby -> bidding -> reveal -> results-entry is part of `reveal`
 *         -> summary -> (bidding | complete)
 *
 * A Master election is deliberately NOT a phase. It is a parallel `election`
 * object, because the Master can vanish at any point — including after results
 * are entered but before the round advances — and the round underneath must
 * survive intact.
 */

const PHASES = ['lobby', 'bidding', 'reveal', 'summary', 'complete'];
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
 * @param {{hostName:string, code:string, startHandSize?:number}} args
 * @param {{now:number, newId:(prefix:string)=>string}} ctx
 * @returns {{state:object, player:object}}
 */
function createGame({ hostName, code, startHandSize = DEFAULT_HAND_SIZE }, ctx) {
  const host = makePlayer({ id: ctx.newId('p'), name: (hostName || '').trim() || 'Player', now: ctx.now });
  const state = {
    id: ctx.newId('g'),
    code,
    createdAt: ctx.now,
    updatedAt: ctx.now,
    version: 1,
    phase: 'lobby',
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

/** Players who can be Master: they need a device of their own. */
const eligibleForMaster = (state) =>
  state.players.filter((p) => !p.isOffline && p.connected && p.id !== state.masterId);

/** Seniority order for deterministic tiebreaks: longest-standing player first. */
const seniority = (state) => [...state.players].sort((a, b) => a.joinedAt - b.joinedAt).map((p) => p.id);

/** Has every player in the game got a bid down for this round? */
function everyoneHasBid(state) {
  const round = currentRound(state);
  if (!round) return false;
  return state.players.every((p) => round.bids[p.id]);
}

// ── Command handlers ─────────────────────────────────────────────────────────

const HANDLERS = {
  /** A player joins the lobby from their own phone. */
  'player/join'(state, cmd, ctx) {
    if (state.phase !== 'lobby') {
      return fail('This game has already started. Ask the group to start a new one.', 'already-started');
    }
    const name = uniqueName(String(cmd.name || '').trim() || 'Player', state.players.map((p) => p.name));
    const player = makePlayer({ id: ctx.newId('p'), name, now: ctx.now });
    state.players.push(player);
    return { result: { player } };
  },

  /** The Master adds someone with no working phone. They bid on the Master's phone. */
  'player/addOffline'(state, cmd, ctx) {
    if (!isMaster(state, ctx.actorId)) return fail('Only the Master can add players.', 'not-master');
    if (state.phase !== 'lobby') return fail('Offline players can only be added before the game starts.');
    const name = uniqueName(String(cmd.name || '').trim() || 'Player', state.players.map((p) => p.name));
    const player = makePlayer({ id: ctx.newId('p'), name, now: ctx.now, isOffline: true });
    state.players.push(player);
    return { result: { player } };
  },

  /** Remove a player from the lobby. The Master may remove anyone; you may remove yourself. */
  'player/remove'(state, cmd, ctx) {
    if (state.phase !== 'lobby') return fail('Players can only be removed before the game starts.');
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
    state.sequence = roundSequence(state.startHandSize);
    state.roundIndex = 0;
    state.rounds = [newRound(0, state.sequence[0])];
    state.phase = 'bidding';
    state.startedAt = ctx.now;
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
      state.phase = 'reveal';
    }
  },

  /** The Master types in how many tricks each player actually won. */
  'results/submit'(state, cmd, ctx) {
    if (!isMaster(state, ctx.actorId)) return fail('Only the Master can enter the results.', 'not-master');
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
    state.rounds.push(newRound(nextIndex, state.sequence[nextIndex]));
    state.phase = 'bidding';
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

// ── Derived reads (no mutation) ──────────────────────────────────────────────

/** The deck warning for the current line-up. Never blocks anything. */
function gameDeckCheck(state) {
  return deckCheck(state.players.length, state.startHandSize);
}

module.exports = {
  PHASES,
  DEFAULT_HAND_SIZE,
  MIN_PLAYERS,
  createGame,
  applyCommand,
  currentRound,
  findPlayer,
  eligibleForMaster,
  seniority,
  everyoneHasBid,
  gameDeckCheck,
};
