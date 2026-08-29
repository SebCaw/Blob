'use strict';

const { resolveBallot } = require('../election');
const { uniqueName } = require('../ids');
const {
  BOOKS_IN_DECK,
  MAX_PLAYERS,
  MIN_PLAYERS,
  OF_EACH,
  RANKS,
  deal,
  rankOf,
  sortHand,
} = require('./deck');
const { BOT_LEVELS, BOT_NAMES } = require('./bot');
const { cardsOfRank, canAsk, completeBooks, countByRank } = require('./rules');
const { handToBot } = require('../handover');
const { reclaimMaster } = require('../master');

/**
 * The authoritative Go Fish state and its reducer.
 *
 * Pure, like the rest of `lib/`: `applyCommand(state, command, ctx)` returns a
 * new state or a refusal, and `now`, `newId` and every scrap of randomness
 * arrive through `ctx`.
 *
 *   lobby -> playing -> complete
 *
 * **Two things here are new to this app.**
 *
 * A TURN THAT TWO PEOPLE TAKE PART IN. Everywhere else a turn belongs to one
 * seat and finishes when that seat acts. Here you ask, and then the table waits
 * on somebody else to answer — so an ask sits open on the state, and the person
 * holding it up is not the person whose turn it is. Everything that watches for
 * a missing player has to know that, `stallWatch` most of all.
 *
 * A FORCED MOVE THAT IS STILL A TAP. The answer is not a decision: you hold the
 * rank or you do not, and the app builds the button from the truth. It is a tap
 * anyway, because the whole game is the second between the question and the
 * answer, and resolving it on the server the instant it is asked deletes that
 * second. Seb chose this deliberately, and it is the same call Chase the Ace got
 * wrong in the other direction by binning pairs automatically.
 *
 * **What is secret here is almost nothing:** the cards in each hand, and the
 * pool. Every question, every answer, every book and every count is public, and
 * `lib/gofish/view.js` sends the lot. See GO-FISH.md.
 */

const PHASES = ['lobby', 'playing', 'complete'];

/**
 * How much of the table's talk is kept.
 *
 * Longer than Cheat's sixty, because in that game the log is flavour and here it
 * is the entire memory the game is played out of — the top bot reads every line
 * of it back to the deal. A hundred and sixty is a measured number rather than
 * a round one: a four-handed game runs to about a hundred and twenty entries and
 * six-handed a little past that, so this holds a whole game and the top bot
 * really does get to remember all of it.
 *
 * It is not free. At this length the log is around nine kilobytes and it goes to
 * every phone on every broadcast, which is why log entries carry no clock - the
 * order IS the chronology, and thirteen digits times a hundred and sixty is a
 * kilobyte of nothing. `lastEvent` keeps its `at`, because the screen needs it
 * as an IDENTITY for deciding when to animate.
 *
 * If a game ever runs past this, the earliest asks are what get forgotten. That
 * is the right way round: nobody at a real table remembers the first question
 * either.
 */
const LOG_MAX = 160;

/**
 * How many full turns of the table may go by with nothing happening.
 *
 * The barren backstop, and the only thing in this reducer that exists because a
 * position can be legal and pointless at the same time. The pool is empty, two
 * or more people are still holding cards, and every ask misses: no card moves,
 * nothing is drawn, and the table goes round again. Three sevens in one hand and
 * three eights in another will do it.
 *
 * It should be rare — with an empty pool and nobody out holding cards, all four
 * of every unbooked rank are in somebody's hand, so a correct ask always exists.
 * Finding it is the game. Nothing forces anybody to find it, though, so after
 * this many consecutive turns of nothing at all the game stops and the books
 * that are down are the books that count.
 *
 * MEASURE THIS rather than believing it. See `test/gofish.test.js`.
 */
const BARREN_TURNS = 3;

// -- Errors -------------------------------------------------------------------

/** @param {string} message @param {string} [code] */
function fail(message, code = 'rejected') {
  return { error: { code, message } };
}

// -- Creation -----------------------------------------------------------------

/**
 * @param {{hostName:string, code:string}} args
 * @param {{now:number, newId:(prefix:string)=>string}} ctx
 */
function createGame({ hostName, code }, ctx) {
  const host = makePlayer({ id: ctx.newId('p'), name: (hostName || '').trim() || 'Player', now: ctx.now });
  const state = {
    id: ctx.newId('g'),
    code,
    game: 'gofish',
    createdAt: ctx.now,
    updatedAt: ctx.now,
    version: 1,
    phase: 'lobby',
    /**
     * How fast the bots move: 1 or 2.
     *
     * Only ever offered when there is no human left to wait for, which is the
     * one situation where the pauses stop being pace and start being a wait.
     */
    speed: 1,
    masterId: host.id,
    players: [host],
    seed: null,
    /** playerId -> their cards, sorted. Order is presentation here, not game. */
    hands: null,
    /**
     * The pool in the middle, face down. Drawn from the front.
     *
     * Hidden from every viewer there is, the same as Cheat's pile — but for a
     * gentler reason. Nobody is bluffing about it; it is simply face down on the
     * table, and a payload carrying it would let anybody read the next four
     * draws.
     */
    pool: [],
    /**
     * playerId -> the ranks they have laid down, in the order they laid them.
     *
     * Ranks, not cards. A book is all four of its rank by definition, so the
     * cards are fully determined and sending them would be four card ids doing
     * the work of one letter.
     */
    books: {},
    /** Whose turn it is to ask. */
    turnId: null,
    /**
     * The question on the table, waiting to be answered.
     *
     * Entirely public the instant it is made — that is what asking IS. The one
     * thing not in here is the answer, which nobody but the target may know
     * until the target says it.
     */
    ask: null,
    /**
     * How many questions have been asked all game.
     *
     * A counter rather than a derived length, and it is load-bearing: with an
     * empty pool a failed ask changes NOTHING else about the position, so
     * without this the bot key would not move and the table would sit there.
     * Deliberately not `log.length`, which is capped — the trap Cheat wrote down.
     */
    asks: 0,
    /** Consecutive turns in which no card moved and nothing was drawn. */
    barren: 0,
    /** Player ids in the order their hands emptied. */
    finished: [],
    /** What just happened, for the screens to animate. */
    lastEvent: null,
    /**
     * Every question and answer since the deal, oldest first and capped.
     *
     * Public in full. This is not colour: it is the whole of what anybody knows
     * about anybody else's hand, and it is the entire bot ladder. Never a card
     * id — a rank and a count is exactly what the room heard.
     */
    log: [],
    autoPlay: {},
    /** Most books. More than one when they finished level. */
    winnerIds: null,
    election: null,
    completedAt: null,
    endedEarly: false,
    rematchGameId: null,
    rematchCode: null,
  };
  return { state, player: host };
}

/**
 * Write down something the room watched.
 *
 * The single place an event is recorded, so `lastEvent` and `log` can never
 * disagree. `reveal` is the one exception and it is the cards physically
 * crossing the table on a handover: they belong on the screen for a beat so it
 * can animate them honestly, and they do NOT belong in the log, which outlives
 * the moment and would then be a running list of everybody's cards.
 */
function note(state, event, ctx, reveal) {
  state.log.push(event);
  if (state.log.length > LOG_MAX) state.log = state.log.slice(-LOG_MAX);
  state.lastEvent = { ...event, at: ctx.now, ...(reveal ? { cards: reveal.slice() } : {}) };
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

// -- Reducer ------------------------------------------------------------------

function applyCommand(state, command, ctx) {
  const handler = HANDLERS[command.type];
  if (!handler) return fail('That action is not something Go Fish knows how to do.', 'unknown-command');

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

// -- Reading the state --------------------------------------------------------

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

/** Their hand is empty, so they are out — books kept. */
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

/** Whose turn is it after this one? Skips anybody out or gone. */
function nextTurnId(state, fromId) {
  const order = seating(state);
  if (!order.length) return null;
  const start = order.indexOf(fromId);
  for (let step = 1; step <= order.length; step += 1) {
    const id = order[(start + step) % order.length];
    if (!isOut(state, id)) return id;
  }
  return null;
}

/** How many books are down, all told. Thirteen ends the game. */
function booksMade(state) {
  return Object.values(state.books || {}).reduce((sum, ranks) => sum + ranks.length, 0);
}

/** Who this player may ask. Everybody else still holding cards. */
function askable(state, playerId) {
  return stillIn(state).filter((p) => p.id !== playerId);
}

/**
 * Everybody still in is a bot.
 *
 * The condition on the speed control, and deliberately about who is still
 * HOLDING CARDS rather than who is at the table. Once you are out you are
 * watching, and watching four bots think at a person's pace is a wait.
 */
function onlyBotsLeft(state) {
  const left = stillIn(state);
  if (!left.length) return false;
  return left.every((p) => p.isBot || state.autoPlay[p.id]);
}

// -- Handlers -----------------------------------------------------------------

const HANDLERS = {
  'player/join'(state, cmd, ctx) {
    if (state.phase === 'complete') return fail('This game has finished.', 'game-over');
    if (state.phase !== 'lobby') {
      return fail('This game has already started. Ask the group to start a new one.', 'already-started');
    }
    if (state.players.length >= MAX_PLAYERS) {
      return fail(`Go Fish seats ${MAX_PLAYERS} players. This game is full.`, 'game-full');
    }
    const name = uniqueName(String(cmd.name || '').trim() || 'Player', state.players.map((p) => p.name));
    const player = makePlayer({ id: ctx.newId('p'), name, now: ctx.now });
    state.players.push(player);
    return { result: { player } };
  },

  'player/addBot'(state, cmd, ctx) {
    if (!isMaster(state, ctx.actorId)) return fail('Only the Master can add a bot.', 'not-master');
    if (state.phase !== 'lobby') return fail('Bots can only be added before the game starts.');
    if (state.players.length >= MAX_PLAYERS) return fail(`This table seats ${MAX_PLAYERS}.`, 'game-full');

    const level = BOT_LEVELS.includes(cmd.level) ? cmd.level : 'medium';
    const wanted = String(cmd.name || '').trim() || nextBotName(state);
    const name = uniqueName(wanted, state.players.map((p) => p.name));
    const player = makePlayer({ id: ctx.newId('p'), name, now: ctx.now });
    player.isBot = true;
    player.botLevel = level;
    /** Private. How much of the table's talk this one remembers. Never in a view. */
    player.botSeed = ctx.newId('bot');
    state.players.push(player);
    return { result: { player } };
  },

  /**
   * Somebody leaves, or the Master lets a vanished phone go.
   *
   * Their cards go back into the pool rather than out of the game, and their
   * books stay on the table as a matter of record. The deck has to stay whole:
   * a book is four of a rank, and quietly deleting nine cards would leave books
   * that can never be made without anybody being told why.
   *
   * They go on the BACK of the pool, so they come out last. There is no shuffle
   * available here — `lib/` is pure and randomness arrives through `ctx` at the
   * deal — and the alternative, dropping them on the front, would hand the next
   * few draws straight to whoever fishes next.
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

    // A question they were part of never gets an answer. If they were being
    // asked, the asker keeps their turn and may ask again; if they were the one
    // asking, the turn moves on.
    if (state.ask && (state.ask.targetId === target.id || state.ask.askerId === target.id)) {
      const asker = state.ask.askerId;
      note(state, { kind: 'cancel', askerId: asker, targetId: state.ask.targetId, rank: state.ask.rank }, ctx);
      state.ask = null;
      if (asker === target.id) state.turnId = nextTurnId(state, target.id);
      else state.turnId = asker;
    }

    // A bot takes the seat, cards and all. Deleting the hand instead used to
    // strand three of the six games for ever - see `lib/handover.js`.
    handToBot(state, target, ctx);
    if (state.masterId === target.id) state.masterId = nextMaster(state) || target.id;
    if (settleGame(state, ctx)) return;
    advanceAutoPlays(state, ctx);
  },

  /**
   * How fast the bots move.
   *
   * Only allowed when there is nobody left to wait for — every player still
   * holding cards is a bot.
   */
  'game/setSpeed'(state, cmd, ctx) {
    if (!isMaster(state, ctx.actorId)) return fail('Only the Master can change the speed.', 'not-master');
    const speed = cmd.speed === 2 ? 2 : 1;
    if (speed === 2 && !onlyBotsLeft(state)) return fail('There are still people playing.', 'people-playing');
    state.speed = speed;
  },

  'game/start'(state, cmd, ctx) {
    if (!isMaster(state, ctx.actorId)) return fail('Only the Master can start the game.', 'not-master');
    if (state.phase !== 'lobby') return fail('The game has already started.');
    const players = activePlayers(state);
    if (players.length < MIN_PLAYERS) return fail(`You need at least ${MIN_PLAYERS} players.`, 'too-few');
    if (players.length > MAX_PLAYERS) return fail(`Go Fish seats ${MAX_PLAYERS}.`, 'too-many');

    const ids = players.map((p) => p.id);
    const seed = ctx.newId('deal');
    const dealt = deal(seed, ids);
    state.seed = seed;
    state.hands = dealt.hands;
    state.pool = dealt.pool;
    state.books = Object.fromEntries(ids.map((id) => [id, []]));
    state.finished = [];
    state.log = [];
    state.ask = null;
    state.asks = 0;
    state.barren = 0;
    note(state, { kind: 'deal', each: dealt.hands[ids[0]].length, pool: dealt.pool.length }, ctx);
    state.phase = 'playing';
    // Who asks first, from the game's own seed rather than always the host. The
    // first question is worth a little — nobody has told the table anything yet.
    state.turnId = ids[hashPick(`${seed}:first`, ids.length)];
    advanceAutoPlays(state, ctx);
  },

  /**
   * Ask one player for one rank.
   *
   * The rule the whole game hangs off is enforced here: **you must already hold
   * the rank you are asking for.** Refused rather than corrected, because a
   * client that could ask for a rank it does not hold would be a client that
   * could go fishing for information for free.
   *
   * Nothing is resolved. The question goes up and the table waits on an answer,
   * which is the one beat this game is made of.
   */
  'play/ask'(state, cmd, ctx) {
    if (state.phase !== 'playing') return fail('The game is not being played.', 'wrong-phase');
    if (state.ask) return fail('There is a question on the table already.', 'ask-open');
    if (!state.turnId) return fail('It is nobody’s turn.', 'no-turn');
    const auto = Boolean(state.autoPlay[state.turnId]);
    if (ctx.actorId && ctx.actorId !== state.turnId) return fail('It is not your turn.', 'not-your-turn');
    if (!ctx.actorId && !auto) return fail('It is not your turn.', 'not-your-turn');

    const askerId = state.turnId;
    const hand = state.hands[askerId] || [];
    const rank = String(cmd.rank || '');
    if (!RANKS.includes(rank)) return fail('That is not a rank.', 'bad-rank');
    if (!canAsk(hand, rank)) return fail('You can only ask for a rank you are holding.', 'not-held');

    const target = findPlayer(state, cmd.targetId);
    if (!target || target.left) return fail('We could not find that player.', 'no-target');
    if (target.id === askerId) return fail('Ask somebody else.', 'self-ask');
    if (isOut(state, target.id)) return fail(`${target.name} is out — their hand is empty.`, 'target-out');

    state.ask = { askerId, targetId: target.id, rank, askedAt: ctx.now, auto: auto || undefined };
    state.asks += 1;
    note(state, { kind: 'ask', askerId, targetId: target.id, rank, auto: auto || undefined }, ctx);
    advanceAutoPlays(state, ctx);
  },

  /**
   * Answer the question.
   *
   * There is nothing to decide — you hold the rank or you do not, and the
   * reducer already knows which. The command carries no answer for exactly that
   * reason: a client that could say what it was handing over could say the
   * wrong thing, and nobody lies in Go Fish.
   *
   * Hand something over and the asker goes again. Say go fish and they draw one
   * from the pool, if there is one, and their turn is done. **They never show
   * what they drew**, which is why a lucky draw does not buy another go — see
   * GO-FISH.md.
   */
  'play/answer'(state, cmd, ctx) {
    if (state.phase !== 'playing') return fail('The game is not being played.', 'wrong-phase');
    const ask = state.ask;
    if (!ask) return fail('Nobody has asked you anything.', 'no-ask');
    const auto = Boolean(state.autoPlay[ask.targetId]);
    if (ctx.actorId && ctx.actorId !== ask.targetId) return fail('That question is not for you.', 'not-yours');
    if (!ctx.actorId && !auto) return fail('That question is not for you.', 'not-yours');

    const { askerId, targetId, rank } = ask;
    const handing = cardsOfRank(state.hands[targetId] || [], rank);
    state.ask = null;

    if (handing.length) {
      const given = new Set(handing);
      state.hands[targetId] = (state.hands[targetId] || []).filter((card) => !given.has(card));
      state.hands[askerId] = sortHand((state.hands[askerId] || []).concat(handing));
      state.barren = 0;
      note(
        state,
        { kind: 'give', askerId, targetId, rank, count: handing.length },
        ctx,
        // The cards, for one beat, so the screen can fly them across honestly.
        // Everybody at a real table watches two sevens change hands. They are
        // deliberately NOT in the log, which outlives the moment.
        handing
      );
      // Their hand may have just emptied. The asker keeps the turn either way —
      // that is what a successful ask buys.
      goneOut(state, targetId, ctx);
      if (!isOut(state, askerId)) state.turnId = askerId;
      if (settleGame(state, ctx)) return;
      advanceAutoPlays(state, ctx);
      return;
    }

    const drew = state.pool.length > 0;
    const card = drew ? state.pool.shift() : null;
    if (card) state.hands[askerId] = sortHand((state.hands[askerId] || []).concat([card]));
    // A draw is the pool getting smaller, which is progress. An empty pool and a
    // miss is the one turn in this game where genuinely nothing happened.
    if (drew) state.barren = 0;
    else state.barren += 1;
    note(state, { kind: 'fish', askerId, targetId, rank, drew, pool: state.pool.length }, ctx);
    state.turnId = nextTurnId(state, askerId);
    if (settleGame(state, ctx)) return;
    advanceAutoPlays(state, ctx);
  },

  /**
   * Lay a book down.
   *
   * A tap rather than something the app does for you, which is Seb's call and
   * the opposite of what Chase the Ace originally did with pairs. It has a
   * cost, and the cost is the point: a book still in your hand can still be
   * asked for, and four sevens handed over is four sevens gone.
   *
   * The one refusal is booking the rank you are being asked for right now. The
   * question is already on the table; answer it.
   */
  'play/book'(state, cmd, ctx) {
    if (state.phase !== 'playing') return fail('The game is not being played.', 'wrong-phase');
    const player = findPlayer(state, ctx.actorId);
    const playerId = player ? player.id : cmd.playerId;
    if (!playerId) return fail('We could not find you at this table.', 'no-seat');
    if (ctx.actorId && (!player || player.left)) return fail('We could not find you at this table.', 'no-seat');
    if (isOut(state, playerId)) return fail('You are out.', 'out');

    const rank = String(cmd.rank || '');
    const hand = state.hands[playerId] || [];
    const four = cardsOfRank(hand, rank);
    if (four.length < OF_EACH) return fail(`You do not have four ${rank}s.`, 'no-book');
    if (state.ask && (state.ask.askerId === playerId || state.ask.targetId === playerId)) {
      return fail('There is a question on the table. Settle that first.', 'ask-open');
    }

    const gone = new Set(four.slice(0, OF_EACH));
    state.hands[playerId] = hand.filter((card) => !gone.has(card));
    state.books[playerId] = (state.books[playerId] || []).concat([rank]);
    state.barren = 0;
    note(state, { kind: 'book', playerId, rank }, ctx);
    goneOut(state, playerId, ctx);
    if (state.turnId === playerId && isOut(state, playerId)) state.turnId = nextTurnId(state, playerId);
    if (settleGame(state, ctx)) return;
    advanceAutoPlays(state, ctx);
  },

  'play/stalled'(state, cmd, ctx) {
    if (state.phase !== 'playing') return;
    const waitingOn = state.ask ? state.ask.targetId : state.turnId;
    const player = findPlayer(state, waitingOn);
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
    state.ask = null;
    state.winnerIds = topBooks(state);
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
      reclaimMaster(state, player);
      player.awaitingTakeover = false;
      delete state.autoPlay[player.id];
      // Somebody coming back is somebody to wait for again.
      if (state.speed === 2 && !onlyBotsLeft(state)) state.speed = 1;
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

// -- Going out and settling ---------------------------------------------------

/**
 * Their hand just emptied, so they are out — keeping every book already down.
 *
 * **Out is out, pool or not.** That is Seb's rule and it is not the published
 * one, which has you draw back in while the pool lasts. It has a consequence
 * worth being honest about rather than papering over: cards can be left stranded
 * in the pool and the last few books may never get made. `settleGame` is where
 * that is dealt with.
 */
function goneOut(state, playerId, ctx) {
  if (isOut(state, playerId)) return;
  if ((state.hands[playerId] || []).length) return;
  state.finished.push(playerId);
  note(state, { kind: 'out', playerId, books: (state.books[playerId] || []).length }, ctx);
}

/** The ids holding the most books, or null when nobody made one at all. */
function topBooks(state) {
  const runners = activePlayers(state);
  if (!runners.length) return null;
  const count = (p) => (state.books[p.id] || []).length;
  const best = Math.max(...runners.map(count));
  if (!best) return null;
  return runners.filter((p) => count(p) === best).map((p) => p.id);
}

/**
 * Is the game over?
 *
 * Three ways, and the first is the ordinary one.
 *
 * **All thirteen books are made.** Nothing left to play for.
 *
 * **Fewer than two people are still holding cards.** With one hand left at the
 * table there is nobody to ask, so the position cannot continue. The same shape
 * as Cheat stopping at two, and honest for the same reason.
 *
 * **The table has gone barren.** See `BARREN_TURNS`.
 *
 * @returns {boolean} true if the game has just ended
 */
function settleGame(state, ctx) {
  if (state.phase !== 'playing') return false;

  const left = stillIn(state);
  const done = booksMade(state) >= BOOKS_IN_DECK;
  const stuck = state.barren >= BARREN_TURNS * Math.max(1, left.length);
  if (!done && left.length > 1 && !stuck) return false;

  state.phase = 'complete';
  state.completedAt = ctx.now;
  state.turnId = null;
  state.ask = null;
  state.stoppedBarren = stuck && !done ? true : undefined;
  state.winnerIds = topBooks(state);
  return true;
}

/**
 * A pick from a seed, without a clock or `Math.random()`.
 *
 * Small enough not to be worth pulling in the deck's generator, and it has one
 * job: choose who asks first.
 */
function hashPick(key, size) {
  let h = 2166136261;
  for (let i = 0; i < key.length; i += 1) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return size ? Math.abs(h) % size : 0;
}

// -- Playing for the absent ---------------------------------------------------

/**
 * Play for anybody the Master has given up waiting on.
 *
 * Three things it does, in the order they hold the table up. ANSWERING first,
 * because an unanswered question stops everybody including the player whose turn
 * it is. Then laying books, which is forced and free. Then asking, and that one
 * is deliberately timid: it names the rank it holds most of and the player
 * holding the most cards, which is the obvious question rather than the good
 * one. Being absent should cost you the game, not have it quietly played well on
 * your behalf.
 *
 * The loop is bounded by the number of cards in play, because a successful ask
 * buys another go and could otherwise chain.
 */
function advanceAutoPlays(state, ctx) {
  for (let guard = 0; guard < 200; guard += 1) {
    if (state.phase !== 'playing') return;

    if (state.ask) {
      if (!state.autoPlay[state.ask.targetId]) return;
      const out = HANDLERS['play/answer'](state, { type: 'play/answer' }, { ...ctx, actorId: null });
      if (out && out.error) return;
      continue;
    }

    if (!state.turnId || !state.autoPlay[state.turnId]) return;
    const me = state.turnId;
    const book = completeBooks(state.hands[me] || [])[0];
    if (book) {
      const out = HANDLERS['play/book'](state, { type: 'play/book', rank: book, playerId: me }, { ...ctx, actorId: null });
      if (out && out.error) return;
      continue;
    }

    const move = autoAsk(state, me);
    if (!move) return;
    const out = HANDLERS['play/ask'](state, move, { ...ctx, actorId: null });
    if (out && out.error) return;
    // `play/ask` recurses into here to answer, so if the question is still open
    // it is waiting on a person and there is nothing more to do.
    if (state.ask) return;
  }
}

/** The obvious question, asked on behalf of somebody who is not here. */
function autoAsk(state, playerId) {
  const counts = countByRank(state.hands[playerId] || []);
  const rank = RANKS.filter((r) => counts[r]).sort((a, b) => counts[b] - counts[a])[0];
  if (!rank) return null;
  const target = askable(state, playerId).sort(
    (a, b) => (state.hands[b.id] || []).length - (state.hands[a.id] || []).length
  )[0];
  if (!target) return null;
  return { type: 'play/ask', rank, targetId: target.id };
}

// -- Elections ----------------------------------------------------------------

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
  LOG_MAX,
  BARREN_TURNS,
  createGame,
  applyCommand,
  findPlayer,
  activePlayers,
  eligibleForMaster,
  isOut,
  stillIn,
  seating,
  nextTurnId,
  askable,
  booksMade,
  onlyBotsLeft,
};
