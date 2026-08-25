'use strict';

const { resolveBallot } = require('../election');
const { uniqueName } = require('../ids');
const { seedFrom, makeRandom } = require('../deck');
const { THE_ACE, DECK_SIZE, deal, minimumDecks, isTheAce, rankOf } = require('./deck');
const { BOT_LEVELS, BOT_NAMES } = require('./bot');
const { extractPairs, hasPair, pairIndexes, moveCard, insertAt, shuffleHand } = require('./rules');

/**
 * The authoritative Chase the Ace state and its reducer.
 *
 * Pure, like the rest of `lib/`: `applyCommand(state, command, ctx)` returns a
 * new state or a refusal, and `now`, `newId` and every scrap of randomness
 * arrive through `ctx`.
 *
 *   lobby -> playing -> complete
 *
 * Three phases. There is no separate discard phase even though the game opens
 * with everybody binning pairs, because with rank-only pairs there is never a
 * choice about which cards go — so it happens on the deal and the screen
 * animates it rather than making anybody tap through it.
 *
 * **Two things here are new to this app and both need care.**
 *
 * The ORDER of a hand is authoritative game state, not presentation. Everywhere
 * else a hand is sorted on the way out for tidiness and nothing depends on it;
 * here the order is what every opponent is trying to read, so it is stored,
 * commanded and defended. A dealt hand is deliberately NOT sorted — sorting it
 * would hand the table a free read on where the ace probably sits.
 *
 * And a command acts on somebody ELSE'S hand. `draw/take` is the only command in
 * this repo that reaches across a seat, so its guards are the ones to read
 * twice: whose turn, whose hand, which slot, and is that slot still there when
 * the command finally runs.
 */

const PHASES = ['lobby', 'playing', 'complete'];

/**
 * Four, both variants.
 *
 * One rule rather than one per deck count, which is worth more than the
 * three-player game it costs. It also keeps well clear of two-player Old Maid,
 * which stops being a game of nerve once the hands are small enough to deduce.
 */
const MIN_PLAYERS = 4;

/** What each variant seats. One deck is 49 cards, so nine people is five each. */
const MAX_PLAYERS = { 1: 8, 2: 12 };

// ── Errors ────────────────────────────────────────────────────────────────────

/** @param {string} message @param {string} [code] */
function fail(message, code = 'rejected') {
  return { error: { code, message } };
}

// ── Creation ─────────────────────────────────────────────────────────────────

/**
 * @param {{hostName:string, code:string, decks?:number}} args
 * @param {{now:number, newId:(prefix:string)=>string}} ctx
 */
function createGame({ hostName, code, decks = 1 }, ctx) {
  const host = makePlayer({ id: ctx.newId('p'), name: (hostName || '').trim() || 'Player', now: ctx.now });
  const state = {
    id: ctx.newId('g'),
    code,
    game: 'chase',
    createdAt: ctx.now,
    updatedAt: ctx.now,
    version: 1,
    phase: 'lobby',
    /** One deck or two. The Master's choice, and it sets the ceiling on seats. */
    decks: decks === 2 ? 2 : 1,
    masterId: host.id,
    players: [host],
    seed: null,
    /**
     * playerId -> their cards, IN THE ORDER THEY ARE HELD.
     *
     * The order is the game. Nothing may quietly re-sort this.
     */
    hands: null,
    /** Every pair anybody has put in the middle, oldest first. Entirely public. */
    discarded: [],
    /** Whose turn it is to draw. They draw from the player on their right. */
    turnId: null,
    /** Player ids in the order they emptied their hand. All of them are safe. */
    finished: [],
    /**
     * What just happened, for the screens to animate.
     *
     * Deliberately shaped so that what is public and what is not falls out of
     * the data rather than out of the screen's manners. A move carries indices
     * and no card. A shuffle carries nothing but who did it — the permutation is
     * never sent, because an animated card-by-card mapping is followable frame
     * by frame and would undo the only thing the shuffle button exists for.
     */
    lastEvent: null,
    /**
     * What the room has watched, oldest first and capped.
     *
     * Every entry here is something everybody saw happen at the table, so
     * remembering it is memory rather than X-ray vision — the same reasoning
     * Silly Head uses for the cards it watched somebody pick up. It exists
     * because in THIS game the watching IS the skill: a person tracks who
     * fidgeted with which slot, so a bot is allowed to as well, and neither can
     * see a single card doing it.
     */
    log: [],
    /**
     * playerId -> they have arranged since their hand last changed.
     *
     * Only the bots read it, and it is what stops one shuffling forever: a
     * rearrange does not change which cards you hold, so without a marker a bot
     * that wants a tidy hand would want one again the moment it finished.
     */
    tidied: {},
    autoPlay: {},
    /** Whoever is left holding the ace. */
    loserId: null,
    election: null,
    completedAt: null,
    endedEarly: false,
    rematchGameId: null,
    rematchCode: null,
  };
  return { state, player: host };
}

/** How much of the table's memory is kept. Long enough to cover a hand. */
const LOG_MAX = 60;

/**
 * Write down something the room watched.
 *
 * The single place an event is recorded, so `lastEvent` and `log` can never
 * disagree about what happened.
 */
function note(state, event) {
  state.lastEvent = event;
  state.log.push(event);
  if (state.log.length > LOG_MAX) state.log = state.log.slice(-LOG_MAX);
}

function nextBotName(state) {
  const taken = new Set(state.players.map((p) => p.name.toLowerCase()));
  return BOT_NAMES.find((n) => !taken.has(n.toLowerCase())) || BOT_NAMES[0];
}

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

function applyCommand(state, command, ctx) {
  const handler = HANDLERS[command.type];
  if (!handler) return fail('That action is not something Chase the Ace knows how to do.', 'unknown-command');

  const next = clone(state);
  const result = handler(next, command, ctx);
  if (result && result.error) return result;

  next.version = state.version + 1;
  next.updatedAt = ctx.now;
  return { state: next, result: (result && result.result) || null };
}

function clone(state) {
  return JSON.parse(JSON.stringify(state));
}

// ── Reading the state ────────────────────────────────────────────────────────

function findPlayer(state, id) {
  if (!id) return null;
  return state.players.find((p) => p.id === id) || null;
}

function isMaster(state, id) {
  return Boolean(id) && state.masterId === id;
}

function seniority(state) {
  return state.players
    .filter((p) => !p.left)
    .slice()
    .sort((a, b) => a.joinedAt - b.joinedAt || a.id.localeCompare(b.id))
    .map((p) => p.id);
}

function nextMaster(state) {
  return (
    seniority(state).find((id) => {
      const p = findPlayer(state, id);
      return p && !p.left && !p.isBot;
    }) || seniority(state)[0]
  );
}

function activePlayers(state) {
  return state.players.filter((p) => !p.left);
}

function eligibleForMaster(state) {
  return activePlayers(state).filter((p) => !p.isBot && p.connected);
}

/** Emptied their hand, and therefore safe. */
function isOut(state, id) {
  return state.finished.includes(id);
}

/** Everybody still holding cards. */
function stillIn(state) {
  return activePlayers(state).filter((p) => !isOut(state, p.id));
}

/** The seats, in order round the table. */
function seating(state) {
  return activePlayers(state).map((p) => p.id);
}

/**
 * Who this player draws FROM.
 *
 * Play passes to the left, so you take from the player on your right — the
 * previous seat round the table. Anybody who has gone out is skipped, which is
 * what keeps the ring closing up as the game shrinks rather than leaving holes
 * in it.
 *
 * @returns {string|null}
 */
function sourceFor(state, drawerId) {
  const order = seating(state);
  const start = order.indexOf(drawerId);
  if (start === -1) return null;
  for (let step = 1; step <= order.length; step++) {
    const id = order[(start - step + order.length * order.length) % order.length];
    if (id === drawerId) continue;
    if (isOut(state, id)) continue;
    if (!(state.hands[id] || []).length) continue;
    return id;
  }
  return null;
}

/**
 * Whose fan is frozen right now.
 *
 * The player currently being drawn from cannot rearrange or shuffle. Without
 * this there is a race between their reorder and the drawer's tap that the
 * command queue settles arbitrarily, and whichever way it lands somebody has
 * been robbed. Everybody else may arrange freely — it is not their turn to be
 * read.
 */
function lockedHandId(state) {
  if (state.phase !== 'playing' || !state.turnId) return null;
  return sourceFor(state, state.turnId);
}

/** Whose turn is it after this one? Skips anybody out or gone. */
function nextTurnId(state, fromId) {
  const order = seating(state);
  if (!order.length) return null;
  const start = order.indexOf(fromId);
  for (let step = 1; step <= order.length; step++) {
    const id = order[(start + step) % order.length];
    if (!isOut(state, id)) return id;
  }
  return null;
}

/** Does this player hold the one ace? Server-side only — never leaves `view.js`. */
function holdsTheAce(state, id) {
  return (state.hands[id] || []).some(isTheAce);
}

// ── Handlers ─────────────────────────────────────────────────────────────────

const HANDLERS = {
  'player/join'(state, cmd, ctx) {
    if (state.phase === 'complete') return fail('This game has finished.', 'game-over');
    if (state.phase !== 'lobby') {
      return fail('This game has already started. Ask the group to start a new one.', 'already-started');
    }
    const seats = MAX_PLAYERS[state.decks];
    if (state.players.length >= seats) {
      return fail(
        state.decks === 1
          ? `One deck seats ${seats}. Ask the Master to switch to two.`
          : `Chase the Ace seats ${seats} players at most. This game is full.`,
        'game-full'
      );
    }
    const name = uniqueName(String(cmd.name || '').trim() || 'Player', state.players.map((p) => p.name));
    const player = makePlayer({ id: ctx.newId('p'), name, now: ctx.now });
    state.players.push(player);
    return { result: { player } };
  },

  'player/addBot'(state, cmd, ctx) {
    if (!isMaster(state, ctx.actorId)) return fail('Only the Master can add a bot.', 'not-master');
    if (state.phase !== 'lobby') return fail('Bots can only be added before the game starts.');
    const seats = MAX_PLAYERS[state.decks];
    if (state.players.length >= seats) return fail(`This table seats ${seats}.`, 'game-full');

    const level = BOT_LEVELS.includes(cmd.level) ? cmd.level : 'medium';
    const wanted = String(cmd.name || '').trim() || nextBotName(state);
    const name = uniqueName(wanted, state.players.map((p) => p.name));
    const player = makePlayer({ id: ctx.newId('p'), name, now: ctx.now });
    player.isBot = true;
    player.botLevel = level;
    /** Private. How this one plays and how it reads a fan. Never in a view. */
    player.botSeed = ctx.newId('bot');
    state.players.push(player);
    return { result: { player } };
  },

  /**
   * Somebody leaves, or the Master lets a vanished phone go.
   *
   * Their cards go with them, and that includes the ace if they had it — at
   * which point nobody can lose, so the game ends there rather than carrying on
   * with a deck that no longer has an odd card in it. Better an honest "that one
   * does not count" than twenty more turns to no conclusion.
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

    const tookTheAce = state.hands ? holdsTheAce(state, target.id) : false;
    target.left = true;
    target.leftAt = ctx.now;
    target.awaitingTakeover = false;
    delete state.autoPlay[target.id];
    if (state.hands) delete state.hands[target.id];
    if (state.masterId === target.id) state.masterId = nextMaster(state) || target.id;
    if (state.turnId === target.id) state.turnId = nextTurnId(state, target.id);

    if (tookTheAce) {
      state.phase = 'complete';
      state.completedAt = ctx.now;
      state.endedEarly = true;
      state.loserId = null;
      state.turnId = null;
      return;
    }
    settleGame(state, ctx);
  },

  /** One deck or two. Lobby only — it decides how many cards exist. */
  'game/setDecks'(state, cmd, ctx) {
    if (!isMaster(state, ctx.actorId)) return fail('Only the Master can change that.', 'not-master');
    if (state.phase !== 'lobby') return fail('The game has already started.');
    const decks = cmd.decks === 2 ? 2 : 1;
    const here = activePlayers(state).length;
    if (here > MAX_PLAYERS[decks]) {
      return fail(`One deck only seats ${MAX_PLAYERS[1]}, and there are ${here} of you.`, 'too-many');
    }
    state.decks = decks;
  },

  /**
   * Deal, bin every pair, and start.
   *
   * The opening discard happens here rather than as a phase because there is
   * nothing to decide in it: rank-only pairs mean the cards that go are the same
   * whoever is looking. A player can go out on the deal alone, which is handled
   * the same way as going out later.
   */
  'game/start'(state, cmd, ctx) {
    if (!isMaster(state, ctx.actorId)) return fail('Only the Master can start the game.', 'not-master');
    if (state.phase !== 'lobby') return fail('The game has already started.');
    const players = activePlayers(state);
    if (players.length < MIN_PLAYERS) return fail(`You need at least ${MIN_PLAYERS} players.`, 'too-few');
    if (players.length > MAX_PLAYERS[state.decks]) {
      return fail(`This deck only seats ${MAX_PLAYERS[state.decks]}.`, 'too-many');
    }
    if (state.decks < minimumDecks(players.length)) {
      return fail(`There are too many of you for one deck. Switch to two.`, 'too-many');
    }

    const ids = players.map((p) => p.id);
    const seed = ctx.newId('deal');
    state.seed = seed;
    state.hands = deal(seed, ids, state.decks);
    state.discarded = [];
    state.finished = [];

    // Nobody's pairs are binned for them.
    //
    // The app used to do it on the deal, on the grounds that with rank-only
    // pairs there is no decision in it. There is no decision, but there IS an
    // ACT — finding your pairs and throwing them away is most of what playing
    // this game feels like, and doing it for people took the first minute of
    // the game away from them. So the cards arrive as dealt and everybody sorts
    // themselves out, with a nudge if they are slow to spot one.
    state.log = [];
    state.tidied = {};
    note(state, { kind: 'deal', at: ctx.now });
    state.phase = 'playing';
    // Who goes first, from the game's own seed — neither the host every time nor
    // anything anybody can lean on.
    const random = makeRandom(seedFrom(`${seed}:first`));
    const startAt = Math.floor(random() * ids.length);
    state.turnId = ids[startAt];
    if (isOut(state, state.turnId)) state.turnId = nextTurnId(state, state.turnId);
    if (settleGame(state, ctx)) return;
    advanceAutoPlays(state, ctx);
  },

  /**
   * Throw a pair away.
   *
   * Two positions, and they must hold the same rank. Positions rather than
   * cards because that is what the screen has: you tap one card and then
   * another, and if the two match they go in the middle instead of one moving.
   * The same two taps do both jobs, which is why there is no separate control.
   *
   * Allowed at ANY time, including while somebody is choosing from your hand.
   *
   * That exception matters more than it looks. Binning is compulsory — the
   * reducer refuses a draw from anybody still holding a pair — so a rule that
   * could block it can deadlock a player, and at the start of a game everybody
   * is sitting on pairs at once. The first version locked it with the
   * arranging and the very first hand could not be cleared.
   *
   * It does mean the slots can shift under somebody who is mid-choice, which is
   * why `draw/take` carries the count the screen was looking at. See there.
   */
  'hand/bin'(state, cmd, ctx) {
    const guard = arranger(state, ctx.actorId, { needsTwo: true, whileLocked: true });
    if (guard) return guard;

    const id = ctx.actorId;
    const hand = state.hands[id];
    const { a, b } = { a: cmd.a, b: cmd.b };
    if (!Number.isInteger(a) || !Number.isInteger(b) || a === b) return fail('Pick two different cards.', 'bad-slot');
    if (a < 0 || b < 0 || a >= hand.length || b >= hand.length) {
      return fail('Those cards have moved. Try again.', 'bad-slot');
    }
    if (rankOf(hand[a]) !== rankOf(hand[b])) return fail('Those two do not make a pair.', 'not-a-pair');

    const pair = [hand[a], hand[b]];
    state.hands[id] = hand.filter((_, i) => i !== a && i !== b);
    state.discarded.push(pair[0], pair[1]);
    // Their hand is a different hand now, so any arranging they had done is
    // about cards that have gone.
    delete state.tidied[id];
    note(state, { kind: 'bin', playerId: id, pair, at: ctx.now });

    if (!state.hands[id].length && !isOut(state, id)) state.finished.push(id);
    if (settleGame(state, ctx)) return;
    // Binning your way out mid-turn must not strand the turn on an empty seat.
    if (state.turnId && isOut(state, state.turnId)) state.turnId = nextTurnId(state, state.turnId);
    advanceAutoPlays(state, ctx);
  },

  /**
   * Move one of your own cards, in full view.
   *
   * The indices go out to everybody on purpose. An arrangement nobody can see is
   * not a bluff, it is just an arrangement — the bluff is moving a card knowing
   * they watched you do it. What is never sent is WHICH card moved.
   */
  'hand/move'(state, cmd, ctx) {
    const guard = arranger(state, ctx.actorId);
    if (guard) return guard;

    const id = ctx.actorId;
    const moved = moveCard(state.hands[id], cmd.from, cmd.to);
    if (!moved) return fail('That card is not where you think it is.', 'bad-slot');
    state.hands[id] = moved;
    state.tidied[id] = true;
    note(state, { kind: 'move', playerId: id, from: cmd.from, to: cmd.to, at: ctx.now });
  },

  /**
   * Scramble your own hand.
   *
   * The counterweight to `hand/move`: it costs you every read anybody had, and
   * it costs you the chance to talk them into a mistake. Randomised HERE rather
   * than on the phone that asked for it — a client-side shuffle would put the
   * permutation on exactly the device that must not be trusted with it.
   */
  'hand/shuffle'(state, cmd, ctx) {
    const guard = arranger(state, ctx.actorId);
    if (guard) return guard;

    const id = ctx.actorId;
    if (state.hands[id].length < 2) return fail('There is nothing to shuffle.', 'too-few-cards');
    const random = makeRandom(seedFrom(ctx.newId('shuffle')));
    state.hands[id] = shuffleHand(state.hands[id], random);
    state.tidied[id] = true;
    // Who, and nothing else. The permutation never leaves this function.
    note(state, { kind: 'shuffle', playerId: id, at: ctx.now });
  },

  /**
   * Take a card from the player on your right.
   *
   * The only command in this repo that reaches into somebody else's hand, so the
   * guards are deliberately exhaustive: the phase, whose turn, that a source
   * exists, and that the slot is still there. That last one is not paranoia —
   * the source's hand can have changed between the screen drawing it and the
   * command arriving.
   */
  'draw/take'(state, cmd, ctx) {
    if (state.phase !== 'playing') return fail('The game is not being played.', 'wrong-phase');
    if (!state.turnId) return fail('It is nobody’s turn.', 'no-turn');
    const auto = Boolean(state.autoPlay[state.turnId]);
    if (ctx.actorId && ctx.actorId !== state.turnId) return fail('It is not your turn.', 'not-your-turn');
    if (!ctx.actorId && !auto) return fail('It is not your turn.', 'not-your-turn');

    const drawerId = state.turnId;
    // Bin first. Not a nicety: holding a pair back is holding extra cards, and
    // extra cards is somewhere extra for the ace to hide. Left unenforced it
    // would be the strongest play in the game and the least interesting.
    if (hasPair(state.hands[drawerId] || [])) {
      return fail('Throw your pair away first.', 'bin-first');
    }
    const fromId = sourceFor(state, drawerId);
    if (!fromId) return fail('There is nobody to take a card from.', 'no-source');

    const from = state.hands[fromId];
    const index = cmd.index;
    if (!Number.isInteger(index) || index < 0 || index >= from.length) {
      return fail('That card has gone. Pick another.', 'bad-slot');
    }
    // The number of slots the chooser was looking at when they tapped.
    //
    // Their hand can change underneath a choice — they are allowed to bin a
    // pair at any moment, including this one — and without this the tap would
    // silently land on a different card than the one aimed at. Refusing is
    // honest; taking whatever slid into that position is not. Optional, so a
    // client that predates it still works.
    if (Number.isInteger(cmd.of) && cmd.of !== from.length) {
      return fail('Their hand just changed. Pick again.', 'hand-moved');
    }

    const card = from[index];
    state.hands[fromId] = from.filter((_, i) => i !== index);

    // Slotted in at random rather than put on the end: a card that always lands
    // in the same place is a card everybody knows the position of, which would
    // make a tidy-up compulsory before any arrangement meant anything again.
    const roll = makeRandom(seedFrom(ctx.newId('slot')))();
    state.hands[drawerId] = insertAt(state.hands[drawerId], card, roll);

    // Both hands have changed, so whatever either of them had arranged is about
    // a hand that no longer exists.
    delete state.tidied[fromId];
    delete state.tidied[drawerId];

    note(state, {
      kind: 'draw',
      playerId: drawerId,
      fromId,
      index,
      // Whether it made them a pair is theirs to reveal, by binning it. All the
      // room sees here is that a card changed hands.
      auto: auto || undefined,
      at: ctx.now,
    });

    // The source lost a card and the drawer may have binned two. Either can be
    // the moment somebody empties their hand, and the source's card left first.
    if (!state.hands[fromId].length && !isOut(state, fromId)) state.finished.push(fromId);
    if (!state.hands[drawerId].length && !isOut(state, drawerId)) state.finished.push(drawerId);

    if (settleGame(state, ctx)) return;
    state.turnId = nextTurnId(state, drawerId);
    advanceAutoPlays(state, ctx);
  },

  'play/stalled'(state, cmd, ctx) {
    if (state.phase !== 'playing') return;
    const player = findPlayer(state, state.turnId);
    if (!player || player.connected || player.left) return;
    player.awaitingTakeover = true;
  },

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

  'game/end'(state, cmd, ctx) {
    if (!isMaster(state, ctx.actorId)) return fail('Only the Master can end the game.', 'not-master');
    if (state.phase === 'lobby') return fail('The game has not started yet.');
    if (state.phase === 'complete') return;
    state.phase = 'complete';
    state.completedAt = ctx.now;
    state.endedEarly = true;
    state.turnId = null;
  },

  'game/rematchStarted'(state, cmd, ctx) {
    if (!isMaster(state, ctx.actorId)) return fail('Only the Master can start a rematch.', 'not-master');
    if (state.phase !== 'complete') return fail('The game is not over yet.');
    if (state.rematchGameId) return;
    if (!cmd.gameId || !cmd.code) return fail('That rematch is missing its details.');
    state.rematchGameId = cmd.gameId;
    state.rematchCode = cmd.code;
  },

  'conn/set'(state, cmd, ctx) {
    const player = findPlayer(state, cmd.playerId);
    if (!player) return fail('We could not find that player.');
    if (player.isBot) return;
    player.connected = Boolean(cmd.connected);
    if (player.connected) {
      player.disconnectedAt = null;
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

    const base = {
      id: ctx.newId('e'),
      forPlayerId: master ? master.id : null,
      startedAt: ctx.now,
      ballot: 1,
      candidates,
      previousCandidates: null,
      eligible: candidates,
      votes: {},
    };
    state.election =
      candidates.length === 1
        ? {
            ...base,
            counts: { [candidates[0]]: 0 },
            resolvedAt: ctx.now,
            winnerId: candidates[0],
            reason: 'only-candidate',
          }
        : { ...base, counts: null, resolvedAt: null, winnerId: null, reason: null };
    if (candidates.length === 1) state.masterId = candidates[0];
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
 * The checks a rearrange or a shuffle starts with.
 *
 * The interesting one is the lock: you may not touch your fan while somebody is
 * drawing from it.
 */
function arranger(state, actorId, options = {}) {
  if (state.phase !== 'playing') return fail('The game is not being played.', 'wrong-phase');
  const player = findPlayer(state, actorId);
  if (!player || player.left) return fail('We could not find you at this table.', 'no-seat');
  if (isOut(state, actorId)) return fail('You are out — your cards have all gone.', 'out');
  const held = (state.hands[actorId] || []).length;
  if (!held) return fail('You have no cards.', 'no-cards');
  if (options.needsTwo && held < 2) return fail('You only have one card left.', 'no-cards');
  // Arranging is frozen while somebody is choosing from you; binning never is.
  if (!options.whileLocked && lockedHandId(state) === actorId) {
    return fail('Too late — they are choosing from your hand.', 'hand-locked');
  }
  return null;
}

// ── Settling ─────────────────────────────────────────────────────────────────

/**
 * Is the game over, and who is holding the ace?
 *
 * It ends when everybody but one has emptied their hand. That last player has
 * the ace, by arithmetic rather than by checking: everything else pairs, so
 * whatever is left when the pairs have gone is the odd card.
 *
 * @returns {boolean} true if the game has just ended
 */
function settleGame(state, ctx) {
  if (state.phase !== 'playing') return false;
  const left = stillIn(state);
  if (left.length > 1) return false;

  // Whatever pairs the last player is still sitting on go down now.
  //
  // Everybody else is out, so there is nobody left to bluff and no decision in
  // it — they would simply be made to tap through their own pairs to reach a
  // conclusion the table can already see. What is left when the pairs have gone
  // is the ace, by arithmetic: everything else in the deck comes in twos.
  if (left.length === 1 && state.hands) {
    const { kept, pairs } = extractPairs(state.hands[left[0].id] || []);
    if (pairs.length) {
      state.hands[left[0].id] = kept;
      for (const pair of pairs) state.discarded.push(pair[0], pair[1]);
    }
  }

  state.phase = 'complete';
  state.completedAt = ctx.now;
  state.loserId = left.length === 1 ? left[0].id : null;
  state.turnId = null;
  return true;
}

/**
 * Draw for anybody the Master has given up waiting on.
 *
 * Takes the first slot every time. Not a good choice, and deliberately not one:
 * being absent should cost you the game rather than be quietly played well on
 * your behalf. An absent player never rearranges either, which is its own tell
 * and a fair one.
 *
 * Bounded by the number of seats so a bug in here can never spin.
 */
function advanceAutoPlays(state, ctx) {
  for (let guard = 0; guard <= state.players.length; guard++) {
    if (state.phase !== 'playing' || !state.turnId) return;
    if (!state.autoPlay[state.turnId]) return;
    const before = state.turnId;
    // Bin for them first, or their own turn refuses itself. The first pair
    // found, since there is nothing to choose between them.
    let safety = 0;
    while (hasPair(state.hands[before] || []) && safety++ < 30) {
      const [a, b] = pairIndexes(state.hands[before])[0];
      const binned = HANDLERS['hand/bin'](state, { a, b }, { ...ctx, actorId: before });
      if (binned && binned.error) return;
      if (state.phase !== 'playing' || state.turnId !== before) return;
    }
    const source = sourceFor(state, before);
    const outcome = HANDLERS['draw/take'](
      state,
      { index: 0, of: source ? (state.hands[source] || []).length : undefined },
      { ...ctx, actorId: null }
    );
    if (outcome && outcome.error) return;
    if (state.turnId === before) return;
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
  DECK_SIZE,
  THE_ACE,
  createGame,
  applyCommand,
  findPlayer,
  activePlayers,
  eligibleForMaster,
  isOut,
  stillIn,
  seating,
  sourceFor,
  lockedHandId,
  nextTurnId,
  holdsTheAce,
};
