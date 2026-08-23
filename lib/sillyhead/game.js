'use strict';

const { resolveBallot } = require('../election');
const { uniqueName } = require('../ids');
const { seedFrom, makeRandom } = require('../deck');
const { decksFor, deal, rankOf, valueOf, HAND_COUNT, MAX_QUICK_PLAYERS, CARDS_EACH } = require('./deck');
const { BOT_LEVELS, BOT_NAMES } = require('./bot');
const {
  RESET_RANK,
  SACK_RANK,
  checkPlay,
  isPlayableRank,
  maxPlayable,
  resolvePlay,
  topRank,
} = require('./rules');

/**
 * The authoritative Silly Head state and its reducer.
 *
 * Pure, exactly like Blob's: `applyCommand(state, command, ctx)` returns a new
 * state or a refusal, and `now`, `newId` and every scrap of randomness arrive
 * through `ctx`. The shuffle is seeded from an id made with `crypto`, so every
 * game is genuinely random and every deal is still replayable from its seed.
 *
 * Silly Head has NO ROUNDS. One shuffle, one deal, play until one person is
 * left holding cards — which is why this is its own reducer rather than a third
 * mode of Blob, whose whole shape is a sequence of scored rounds.
 *
 *   lobby -> sort -> playing -> complete
 *
 * `sort` is the house rule that makes this game itself: everybody arranges
 * their table at the same time, binning 3s and stacking pairs to fish more
 * cards out of a shared stock. It is the only phase where more than one player
 * acts at once, and the command queue is what keeps that honest — two people
 * can never take the same card, because their commands are serialised.
 *
 * The rules of the pile itself live in `./rules.js`. Nothing in here decides
 * what beats what.
 */

const PHASES = ['lobby', 'sort', 'playing', 'complete'];
const MIN_PLAYERS = 2;

/** Four families of four. Past this the ring stops being a table. */
const MAX_PLAYERS = 16;

/** The rank you bin during the sort, and only during the sort. */
const BIN_RANK = '3';

/** How many piles you keep in front of you. */
const PILE_COUNT = 3;

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
 * @param {{hostName:string, code:string, quick?:boolean}} args
 * @param {{now:number, newId:(prefix:string)=>string}} ctx
 * @returns {{state:object, player:object}}
 */
function createGame({ hostName, code, quick = false }, ctx) {
  const host = makePlayer({ id: ctx.newId('p'), name: (hostName || '').trim() || 'Player', now: ctx.now });
  const state = {
    id: ctx.newId('g'),
    code,
    /** Which game this room is running. The server picks its engine from this. */
    game: 'sillyhead',
    createdAt: ctx.now,
    updatedAt: ctx.now,
    version: 1,
    phase: 'lobby',
    /** The quick game: one deck, four players at the very most. */
    quick: Boolean(quick),
    masterId: host.id,
    players: [host],
    /** Set at the deal. Kept so a game can be dealt again exactly. */
    seed: null,
    decks: null,
    /** playerId -> three face-down cards, by pile. A played one becomes null. */
    down: null,
    /** playerId -> three stacks of face-up cards, by pile. Stacks only during the sort. */
    up: null,
    /** playerId -> the cards in their hand. */
    hands: null,
    /** The stock everybody draws from, top first. */
    stock: null,
    /** The pile in the middle, oldest first. */
    pile: [],
    /** How many cards have been sacked. Nobody sees them again. */
    sacked: 0,
    /**
     * WHICH cards were sacked, and which cards each player is publicly known to
     * be holding.
     *
     * Both are things everybody at the table watched happen: a card played goes
     * face up in front of the room, and the pile somebody picks up was face up
     * before they took it. Remembering all that is what a sharp player does, so
     * the app is allowed to remember it too — it is memory, not X-ray vision.
     *
     * A card drawn from the deck is NOT public and never appears in
     * `publicHand`, which is why the two are kept separately: `cardsHeld` says
     * how many somebody has, `publicHand` says only the ones everyone saw
     * arrive.
     */
    sackedCards: [],
    publicHand: {},
    /** 3s binned during the sort. They become the opening pile. */
    binned: [],
    /** playerId -> true once they have finished sorting. */
    sortDone: {},
    turnId: null,
    /** Player ids in the order they went out. The first is the winner. */
    finished: [],
    /** The last face-down card turned over, so every phone can see what it was. */
    lastFlip: null,
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
  if (!handler) return fail('That action is not something Silly Head knows how to do.', 'unknown-command');

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

/** Has this player gone out? */
function isOut(state, id) {
  return state.finished.includes(id);
}

/** Everybody still holding cards. */
function stillIn(state) {
  return activePlayers(state).filter((p) => !isOut(state, p.id));
}

/**
 * Which of your three sets of cards you are playing from.
 *
 * The order never varies: your hand, then the three face-up on the table, then
 * the three face-down under them. Your hand can only empty once the stock has,
 * because you draw back up to three after every turn while there are cards to
 * draw — so the table is untouchable until the deck is gone, which is the rule.
 *
 * @returns {'hand'|'up'|'down'|'out'}
 */
function zoneOf(state, id) {
  if (!state.hands) return 'out';
  if ((state.hands[id] || []).length) return 'hand';
  if ((state.up[id] || []).some((stack) => stack.length)) return 'up';
  if ((state.down[id] || []).some(Boolean)) return 'down';
  return 'out';
}

/** The cards this player could choose from right now, ignoring the pile. */
function availableCards(state, id) {
  const zone = zoneOf(state, id);
  if (zone === 'hand') return state.hands[id].slice();
  if (zone === 'up') return state.up[id].filter((stack) => stack.length).map((stack) => stack[stack.length - 1]);
  return [];
}

/**
 * The cards that would actually be legal on the pile as it stands.
 *
 * The client shows this rather than working it out, and the reducer enforces it.
 * A face-down card is never in here — the whole point of it is that nobody knows.
 *
 * @returns {string[]}
 */
function playableCards(state, id) {
  if (state.phase !== 'playing' || state.turnId !== id) return [];
  return availableCards(state, id).filter((card) => isPlayableRank(rankOf(card), state.pile));
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

// ── Handlers ─────────────────────────────────────────────────────────────────

const HANDLERS = {
  /**
   * A player joins from their own phone.
   *
   * Lobby only. Silly Head deals nine cards to everybody at once and there are
   * no rounds to join between, so there is no honest way in once it has started.
   */
  'player/join'(state, cmd, ctx) {
    if (state.phase === 'complete') return fail('This game has finished.', 'game-over');
    if (state.phase !== 'lobby') {
      return fail('This game has already started. Ask the group to start a new one.', 'already-started');
    }
    if (state.players.length >= MAX_PLAYERS) {
      return fail(`Silly Head seats ${MAX_PLAYERS} players at most. This game is full.`, 'game-full');
    }
    if (state.quick && state.players.length >= MAX_QUICK_PLAYERS) {
      return fail(
        `A quick game is one deck, so it seats ${MAX_QUICK_PLAYERS}. Switch to a standard game for more.`,
        'game-full'
      );
    }
    const name = uniqueName(String(cmd.name || '').trim() || 'Player', state.players.map((p) => p.name));
    const player = makePlayer({ id: ctx.newId('p'), name, now: ctx.now });
    state.players.push(player);
    return { result: { player } };
  },

  /**
   * The Master sits a bot down.
   *
   * A bot is a player, not a special case: it gets nine cards like everybody
   * else, it sorts its own table, it can be the Silly Head. What it is NOT is a
   * candidate for Master, something `conn/set` can mark away, or something the
   * stall machinery ever fires for — it has no phone to lose.
   */
  'player/addBot'(state, cmd, ctx) {
    if (!isMaster(state, ctx.actorId)) return fail('Only the Master can add a bot.', 'not-master');
    if (state.phase !== 'lobby') return fail('Bots can only be added before the game starts.');
    if (state.players.length >= MAX_PLAYERS) {
      return fail(`Silly Head seats ${MAX_PLAYERS} players at most. This game is full.`, 'game-full');
    }
    if (state.quick && state.players.length >= MAX_QUICK_PLAYERS) {
      return fail(`A quick game is one deck, so it seats ${MAX_QUICK_PLAYERS}.`, 'game-full');
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
   * Their cards leave with them rather than going on the pile: they were never
   * seen, and dumping nine unknown cards into the middle would change the game
   * for everyone still playing.
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

    target.left = true;
    target.leftAt = ctx.now;
    target.awaitingTakeover = false;
    delete state.autoPlay[target.id];
    if (state.hands) {
      delete state.hands[target.id];
      delete state.up[target.id];
      delete state.down[target.id];
      delete state.sortDone[target.id];
      if (state.publicHand) delete state.publicHand[target.id];
    }
    if (state.masterId === target.id) state.masterId = nextMaster(state) || target.id;
    if (state.turnId === target.id) state.turnId = nextTurnId(state, target.id);
    if (state.phase === 'sort') maybeStartPlaying(state, ctx);
    else settleGame(state, ctx);
  },

  /** One deck or several. Lobby only — the deal depends on it. */
  'game/setQuick'(state, cmd, ctx) {
    if (!isMaster(state, ctx.actorId)) return fail('Only the Master can change that.', 'not-master');
    if (state.phase !== 'lobby') return fail('The game has already started.');
    const quick = Boolean(cmd.quick);
    if (quick && state.players.length > MAX_QUICK_PLAYERS) {
      return fail(
        `A quick game is one deck, so it seats ${MAX_QUICK_PLAYERS}. There are ${state.players.length} of you.`,
        'too-many'
      );
    }
    state.quick = quick;
  },

  /** Deal, and everybody starts sorting. */
  'game/start'(state, cmd, ctx) {
    if (!isMaster(state, ctx.actorId)) return fail('Only the Master can start the game.', 'not-master');
    if (state.phase !== 'lobby') return fail('The game has already started.');
    const players = activePlayers(state);
    if (players.length < MIN_PLAYERS) return fail('You need at least two players.', 'too-few');
    if (state.quick && players.length > MAX_QUICK_PLAYERS) {
      return fail(`A quick game is one deck, so it seats ${MAX_QUICK_PLAYERS}.`, 'too-many');
    }

    const ids = players.map((p) => p.id);
    const copies = decksFor(ids.length, state.quick);
    // The seed is an id made with crypto, so the shuffle is genuinely random —
    // and writing it down is what makes a deal checkable afterwards.
    const seed = ctx.newId('deal');
    const dealt = deal(seed, ids, copies);

    state.seed = seed;
    state.decks = copies;
    state.down = dealt.down;
    state.up = Object.fromEntries(ids.map((id) => [id, dealt.up[id].map((card) => [card])]));
    state.hands = dealt.hands;
    state.stock = dealt.stock;
    state.pile = [];
    state.sacked = 0;
    state.binned = [];
    state.sackedCards = [];
    state.publicHand = {};
    state.sortDone = {};
    state.finished = [];
    state.lastFlip = null;
    state.lastEvent = null;
    state.turnId = null;
    state.phase = 'sort';
  },

  // ── The sort ───────────────────────────────────────────────────────────────
  // Everybody at once. Every action here refills your hand to three from the
  // stock afterwards, which is both the rule and the throttle: stacking a pair
  // is worth doing precisely because it earns you one more card.

  /** Bin a 3. Only during the sort, and it goes to the middle rather than away. */
  'sort/bin'(state, cmd, ctx) {
    const check = sorter(state, ctx);
    if (check.error) return check;
    const { id } = check;
    if (rankOf(cmd.cardId || '') !== BIN_RANK) return fail('Only 3s can go in the middle.');
    if (!takeVisibleCard(state, id, cmd.cardId)) return fail('You do not have that card.');
    state.binned.push(cmd.cardId);
    refillHand(state, id);
  },

  /** Stack a card on a matching pile. Temporary, and the reason you get to draw. */
  'sort/stack'(state, cmd, ctx) {
    const check = sorter(state, ctx);
    if (check.error) return check;
    const { id } = check;
    const index = Number(cmd.pileIndex);
    if (!Number.isInteger(index) || index < 0 || index >= PILE_COUNT) return fail('That is not one of your piles.');
    const stack = state.up[id][index];
    if (!stack.length) return fail('That pile is empty — put a card on it instead.');
    const top = stack[stack.length - 1];
    if (top === cmd.cardId) return fail('That card is already on that pile.');
    if (rankOf(cmd.cardId || '') !== rankOf(top)) return fail('You can only stack cards of the same number.');
    if (!takeVisibleCard(state, id, cmd.cardId)) return fail('You do not have that card.');
    stack.push(cmd.cardId);
    refillHand(state, id);
  },

  /** Put a card from your hand onto an empty pile. You always keep three piles. */
  'sort/place'(state, cmd, ctx) {
    const check = sorter(state, ctx);
    if (check.error) return check;
    const { id } = check;
    const index = Number(cmd.pileIndex);
    if (!Number.isInteger(index) || index < 0 || index >= PILE_COUNT) return fail('That is not one of your piles.');
    if (state.up[id][index].length) return fail('There is already a card on that pile.');
    const at = state.hands[id].indexOf(cmd.cardId);
    if (at === -1) return fail('That card is not in your hand.');
    state.hands[id].splice(at, 1);
    state.up[id][index].push(cmd.cardId);
    refillHand(state, id);
  },

  /**
   * Trade a card in your hand for the one showing on a pile.
   *
   * One command rather than a take and a place, because it is one act. Between
   * the two halves the player would be a card short and looking at an empty
   * pile — the state the screen nags about — and a second request that never
   * arrived would leave them there for good.
   *
   * It is card-neutral, so, alone among the sort commands, it does not refill
   * your hand. Stacking a pair is what earns you a draw; a swap that paid one
   * too would make the fishing free.
   */
  'sort/swap'(state, cmd, ctx) {
    const check = sorter(state, ctx);
    if (check.error) return check;
    const { id } = check;
    const index = Number(cmd.pileIndex);
    if (!Number.isInteger(index) || index < 0 || index >= PILE_COUNT) return fail('That is not one of your piles.');
    const stack = state.up[id][index];
    if (!stack.length) return fail('That pile is empty — put a card on it instead.', 'pile-empty');
    // A stacked pile is mid-fish. Swapping the top of one would leave two cards
    // of different numbers piled up, which is not a stack at all.
    if (stack.length > 1) return fail('Take the spare cards back before you swap that one.', 'pile-stacked');
    const at = state.hands[id].indexOf(cmd.cardId);
    if (at === -1) return fail('That card is not in your hand.');
    state.hands[id][at] = stack[0];
    stack[0] = cmd.cardId;
  },

  /** Take the top card of one of your piles back into your hand. */
  'sort/take'(state, cmd, ctx) {
    const check = sorter(state, ctx);
    if (check.error) return check;
    const { id } = check;
    const index = Number(cmd.pileIndex);
    if (!Number.isInteger(index) || index < 0 || index >= PILE_COUNT) return fail('That is not one of your piles.');
    const stack = state.up[id][index];
    if (!stack.length) return fail('There is nothing on that pile.');
    state.hands[id].push(stack.pop());
  },

  /**
   * Finished sorting.
   *
   * You must finish with exactly three single face-up cards. They do not have
   * to be different numbers — two 10s and a king is a fine finish — but nothing
   * may still be stacked.
   *
   * This used to quietly pull the pairs off for you, and that was wrong: the
   * whole point of the stack is that it was temporary, and which card you leave
   * showing is the decision the sort exists to make. Taking it out of your hands
   * meant the app chose your three best cards, badly, without telling you.
   */
  'sort/done'(state, cmd, ctx) {
    const check = sorter(state, ctx);
    if (check.error) return check;
    const { id } = check;
    if (state.up[id].some((stack) => stack.length > 1)) {
      return fail(
        'You cannot leave cards piled up. Take the spare ones back and put your three best down.',
        'piles-stacked'
      );
    }
    const short = state.up[id].some((stack) => !stack.length);
    if (short && state.hands[id].length) {
      return fail('You need a card on all three piles before you start.', 'piles-short');
    }
    state.sortDone[id] = true;
    maybeStartPlaying(state, ctx);
  },

  // ── Playing ────────────────────────────────────────────────────────────────

  /**
   * Put one or more cards of the same number down.
   *
   * Three ways to source them, and only three: all from your hand, all from your
   * face-up cards, or — the one crossover in the game — your genuinely LAST hand
   * card together with matching face-up cards. Holding a 5 and a 6 you cannot;
   * play the 6 first and the 5 may go down with three matching 5s, which is four
   * of a number, which sacks the pile and gives you another go.
   */
  'play/cards'(state, cmd, ctx) {
    const turn = onTurn(state, ctx.actorId);
    if (turn.error) return turn;
    const id = turn.id;
    const cards = Array.isArray(cmd.cardIds) ? cmd.cardIds.slice() : [];
    if (!cards.length) return fail('Pick a card first.');
    if (new Set(cards).size !== cards.length) return fail('That card is only there once.');

    const source = sourceFor(state, id, cards);
    if (source.error) return source;
    const legal = checkPlay(cards, state.pile);
    if (!legal.ok) return fail(legal.reason, 'illegal-play');

    for (const card of cards) removeCard(state, id, card);
    landCards(state, id, cards, ctx);
  },

  /**
   * Take the pile.
   *
   * Two different acts wearing one command: being stuck, and choosing to. The
   * server can tell them apart because it knows what was legal, which is why
   * losing a face-up card — the penalty for being stuck on the table — cannot be
   * dodged by claiming you meant to.
   */
  'play/takePile'(state, cmd, ctx) {
    const turn = onTurn(state, ctx.actorId);
    if (turn.error) return turn;
    const id = turn.id;
    if (!state.pile.length) return fail('There is nothing in the middle to take.');
    const zone = zoneOf(state, id);
    if (zone === 'down') return fail('Turn one of your face-down cards over.', 'must-flip');

    const stuck = playableCards(state, id).length === 0;
    // Everybody watched these cards go down, and everybody is watching them be
    // picked up, so where they went is not a secret from anyone.
    rememberPublic(state, id, state.pile);
    noteEvent(state, { type: 'pickup', playerId: id, count: state.pile.length });
    state.hands[id].push(...state.pile);
    state.pile = [];

    if (zone === 'up' && stuck) {
      const index = pickUpPenaltyIndex(state, id, cmd.upIndex);
      if (index === -1) return fail('You have no face-up cards left.');
      rememberPublic(state, id, state.up[id][index]);
      state.hands[id].push(...state.up[id][index]);
      state.up[id][index] = [];
    }

    state.lastFlip = null;
    state.turnId = nextTurnId(state, id);
    settleGame(state, ctx);
  },

  /**
   * Turn over one of your face-down cards.
   *
   * You do not get to choose it in any meaningful sense — that is the point of
   * the last three cards — but you do choose which pile, the way you would reach
   * for one at a table. If it beats the pile it is played. If it does not, you
   * take it and the pile.
   */
  'play/flip'(state, cmd, ctx) {
    const turn = onTurn(state, ctx.actorId);
    if (turn.error) return turn;
    const id = turn.id;
    if (zoneOf(state, id) !== 'down') return fail('You still have cards to play first.', 'not-down-yet');
    const index = Number(cmd.pileIndex);
    if (!Number.isInteger(index) || index < 0 || index >= PILE_COUNT) return fail('That is not one of your piles.');
    const card = state.down[id][index];
    if (!card) return fail('There is nothing left on that pile.');

    state.down[id][index] = null;
    if (checkPlay([card], state.pile).ok) {
      state.lastFlip = { playerId: id, cardId: card, played: true };
      landCards(state, id, [card], ctx);
      return;
    }
    state.lastFlip = { playerId: id, cardId: card, played: false };
    // It was turned face up in front of everyone before it went into their hand.
    rememberPublic(state, id, [card, ...state.pile]);
    noteEvent(state, { type: 'pickup', playerId: id, count: state.pile.length + 1 });
    state.hands[id].push(card, ...state.pile);
    state.pile = [];
    state.turnId = nextTurnId(state, id);
    settleGame(state, ctx);
  },

  /**
   * A phone has gone quiet and the table is stuck behind it. The server notices
   * and dispatches this; all it does is put the choice on the Master's screen.
   */
  'play/stalled'(state, cmd, ctx) {
    if (state.phase !== 'playing') return;
    const player = findPlayer(state, state.turnId);
    if (!player || player.connected || player.left) return;
    player.awaitingTakeover = true;
  },

  /**
   * The Master gives up waiting. From here the missing player's turns are played
   * for them — the lowest legal card they hold, or taking the pile — until they
   * come back. Never their choice of card, and never shown to anybody: being
   * absent should cost you the game, not be quietly played well on your behalf.
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

/** The common checks every sort command starts with. */
function sorter(state, ctx) {
  if (state.phase !== 'sort') return fail('The sort is over.', 'not-sorting');
  const player = findPlayer(state, ctx.actorId);
  if (!player || player.left) return fail('We could not find you at this table.');
  if (state.sortDone[player.id]) return fail('You have already finished sorting.', 'already-done');
  return { id: player.id };
}

/** The common checks every play command starts with. */
function onTurn(state, actorId) {
  if (state.phase !== 'playing') return fail('The game is not being played.', 'not-playing');
  const player = findPlayer(state, actorId);
  if (!player || player.left) return fail('We could not find you at this table.');
  if (state.turnId !== player.id) return fail('It is not your turn.', 'not-your-turn');
  return { id: player.id };
}

/**
 * Where a set of cards is coming from, and whether that is allowed.
 *
 * @returns {{from:'hand'|'up'|'last'}|{error:object}}
 */
function sourceFor(state, id, cards) {
  const zone = zoneOf(state, id);
  const hand = state.hands[id];
  const tops = state.up[id].filter((stack) => stack.length).map((stack) => stack[stack.length - 1]);
  const fromHand = cards.filter((c) => hand.includes(c));
  const fromUp = cards.filter((c) => tops.includes(c));
  if (fromHand.length + fromUp.length !== cards.length) return fail('You do not have those cards.');

  if (fromUp.length === 0) {
    if (zone !== 'hand') return fail('Those cards are not in your hand.');
    return { from: 'hand' };
  }
  if (fromHand.length === 0) {
    if (zone !== 'up') return fail('Play the cards in your hand first.', 'hand-first');
    return { from: 'up' };
  }
  // The one crossover: your last hand card, with matching face-up cards.
  if (fromHand.length !== 1 || hand.length !== 1) {
    return fail('Only your very last hand card can go down with your face-up cards.', 'not-last-card');
  }
  return { from: 'last' };
}

/**
 * Who could be Master: anybody still at the table with a phone.
 *
 * Never a bot. The Master starts the game, lets people go and can skip a
 * missing player's turns — none of which anything on the server should be
 * deciding on the table's behalf.
 */
function eligibleForMaster(state) {
  return state.players.filter((p) => !p.left && p.connected && !p.isBot && p.id !== state.masterId);
}

// ── Moving cards about ───────────────────────────────────────────────────────

/**
 * Note that the room saw these cards go into somebody's hand.
 *
 * Written defensively because a game saved to disk BEFORE this existed comes
 * back without it. `lib/` never assumes a field is there: a deploy in the
 * middle of somebody's game must not crash the room it restores.
 */
function rememberPublic(state, id, cards) {
  if (!cards || !cards.length) return;
  state.publicHand = state.publicHand || {};
  const known = (state.publicHand[id] = state.publicHand[id] || []);
  for (const card of cards) if (!known.includes(card)) known.push(card);
}

/**
 * Note what just happened in the middle of the table.
 *
 * Only so the screens can show it happening: a card flying out of a seat onto
 * the pile, a pile flying to whoever took it, a pile sweeping off to the sack.
 * Without this every one of those is a blink, and you cannot tell who played.
 *
 * Nothing here is a secret. Every card named went face up in front of the room
 * before it landed here, and who took a pile is watched by everybody at the
 * table — which is the same reasoning that lets `pile.cards` be public.
 *
 * The sequence number is what tells the client "this is new" from "the screen
 * repainted", because every pushed state rebuilds the whole screen.
 */
function noteEvent(state, event) {
  const seq = ((state.lastEvent && state.lastEvent.seq) || 0) + 1;
  state.lastEvent = { seq, ...event };
}

/** They have played them, so the room no longer knows them to be holding them. */
function forgetPublic(state, id, cards) {
  const known = state.publicHand && state.publicHand[id];
  if (!known) return;
  state.publicHand[id] = known.filter((card) => !cards.includes(card));
}

/** Draw back up to three while the stock lasts. More than three is fine. */
function refillHand(state, id) {
  const hand = state.hands[id];
  while (hand.length < HAND_COUNT && state.stock.length) hand.push(state.stock.shift());
}

/** Take a card from a hand or the top of a face-up pile. @returns {boolean} */
function takeVisibleCard(state, id, cardId) {
  const at = state.hands[id].indexOf(cardId);
  if (at !== -1) {
    state.hands[id].splice(at, 1);
    return true;
  }
  for (const stack of state.up[id]) {
    if (stack.length && stack[stack.length - 1] === cardId) {
      stack.pop();
      return true;
    }
  }
  return false;
}

/** Remove a card the player has already been checked to hold. */
function removeCard(state, id, cardId) {
  takeVisibleCard(state, id, cardId);
}

/** Which face-up card you lose for being stuck. Your choice, or the first one. */
function pickUpPenaltyIndex(state, id, wanted) {
  const index = Number(wanted);
  if (Number.isInteger(index) && index >= 0 && index < PILE_COUNT && state.up[id][index].length) return index;
  return state.up[id].findIndex((stack) => stack.length);
}

/**
 * Put the cards down, sack the pile if they sack it, and move the game on.
 *
 * The pile rules are `resolvePlay`'s; everything here is about the player — the
 * draw, going out, and whether the turn moves.
 */
function landCards(state, id, cards, ctx) {
  // Playing a card is public, so anything the room knew this player was holding
  // is no longer in their hand.
  forgetPublic(state, id, cards);
  const outcome = resolvePlay(state.pile, cards);
  state.pile = outcome.pile;
  state.sacked += outcome.sacked;
  if (outcome.sackedCards.length) {
    state.sackedCards = (state.sackedCards || []).concat(outcome.sackedCards);
  }
  noteEvent(state, { type: 'play', playerId: id, cards: cards.slice(), sacked: outcome.sacked });
  refillHand(state, id);

  if (zoneOf(state, id) === 'out' && !isOut(state, id)) state.finished.push(id);

  // Sacking the pile earns you another go on a clean slate — unless that was
  // your last card, in which case there is nobody left in you to have it.
  const again = outcome.playAgain && !isOut(state, id);
  if (!again) state.turnId = nextTurnId(state, id);
  settleGame(state, ctx);
}

/**
 * Is the game over?
 *
 * One person left holding cards and that is that: they are the Silly Head. The
 * first person out already won, and everybody in between has their place in
 * `finished`.
 */
function settleGame(state, ctx) {
  if (state.phase !== 'playing') return;
  const left = stillIn(state);
  if (left.length > 1) {
    advanceAutoPlays(state, ctx);
    return;
  }
  state.loserId = left.length === 1 ? left[0].id : null;
  state.turnId = null;
  state.phase = 'complete';
  state.completedAt = ctx.now;
}

/**
 * Keep playing for anybody the Master has given up waiting on.
 *
 * Deliberately the same path a tapped card takes — there is no second, quieter
 * route through the rules — and deliberately bad: the lowest legal card it can
 * find, and taking the pile when there is nothing.
 */
function advanceAutoPlays(state, ctx) {
  let guard = 0;
  while (state.phase === 'playing' && state.turnId && state.autoPlay[state.turnId]) {
    if (guard++ > 500) return;
    const id = state.turnId;
    if (zoneOf(state, id) === 'down') {
      const index = state.down[id].findIndex(Boolean);
      const outcome = HANDLERS['play/flip'](state, { pileIndex: index }, { ...ctx, actorId: id });
      if (outcome && outcome.error) return;
      continue;
    }
    const card = worstPlayable(state, id);
    if (!card) {
      const outcome = HANDLERS['play/takePile'](state, {}, { ...ctx, actorId: id });
      if (outcome && outcome.error) return;
      continue;
    }
    const outcome = HANDLERS['play/cards'](state, { cardIds: [card] }, { ...ctx, actorId: id });
    if (outcome && outcome.error) return;
  }
}

/**
 * The card somebody absent should be made to play: the lowest thing that is
 * legal, and a special only if there is nothing else. Being skipped should not
 * play the hand better than being present would.
 */
function worstPlayable(state, id) {
  const playable = playableCards(state, id);
  if (!playable.length) return null;
  const plain = playable.filter((card) => {
    const rank = rankOf(card);
    return rank !== RESET_RANK && rank !== SACK_RANK;
  });
  const pool = plain.length ? plain : playable;
  return pool.slice().sort((a, b) => valueOf(a) - valueOf(b))[0];
}

// ── The sort finishing ───────────────────────────────────────────────────────

/**
 * Once everybody has finished sorting, deal with the binned 3s and start.
 *
 * The 3s are laid one at a time through the ordinary rules rather than dropped
 * in as a lump, so four of them sack the pile exactly the way four of anything
 * else does — and a fifth then starts a fresh pile, which is what would happen
 * at a table.
 */
function maybeStartPlaying(state, ctx) {
  if (state.phase !== 'sort') return;
  const players = activePlayers(state);
  if (players.length < MIN_PLAYERS) return;
  if (!players.every((p) => state.sortDone[p.id])) return;

  state.pile = [];
  for (const card of state.binned) {
    const outcome = resolvePlay(state.pile, [card]);
    state.pile = outcome.pile;
    state.sacked += outcome.sacked;
    if (outcome.sackedCards.length) {
      state.sackedCards = (state.sackedCards || []).concat(outcome.sackedCards);
    }
  }
  state.turnId = firstLeader(state, players);
  state.phase = 'playing';
}

/**
 * Who leads. Random, from the game's own seed, so it is neither the host every
 * time nor something anybody can lean on.
 */
function firstLeader(state, players) {
  const random = makeRandom(seedFrom(`${state.seed}:lead`));
  return players[Math.floor(random() * players.length)].id;
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
  PILE_COUNT,
  BIN_RANK,
  CARDS_EACH,
  createGame,
  applyCommand,
  findPlayer,
  isMaster,
  seniority,
  activePlayers,
  stillIn,
  isOut,
  zoneOf,
  availableCards,
  playableCards,
  nextTurnId,
  eligibleForMaster,
  nextMaster,
  topRank,
  maxPlayable,
  decksFor,
};
