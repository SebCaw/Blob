'use strict';

const { resolveBallot } = require('../election');
const { uniqueName } = require('../ids');
const {
  CYCLE,
  DECK_COUNTS,
  MAX_PLAYERS,
  deal,
  deckOptions,
  minimumDecks,
  rankOf,
  sortHand,
} = require('./deck');
const { BOT_LEVELS, BOT_NAMES } = require('./bot');
const { legalRanks, isLegalClaim, claimIsHonest, countByRank } = require('./rules');

/**
 * The authoritative Cheat state and its reducer.
 *
 * Pure, like the rest of `lib/`: `applyCommand(state, command, ctx)` returns a
 * new state or a refusal, and `now`, `newId` and every scrap of randomness
 * arrive through `ctx`.
 *
 *   lobby -> playing -> complete
 *
 * **Three things here are new to this app, and each has its own trap.**
 *
 * A FACE-DOWN PILE the server knows and nobody may see. Every other game in this
 * repo hides hands from each other; this one hides a shared object from
 * everybody at once, including the people who put cards in it. A card that
 * reaches any screen from `state.pile` ends the game outright, because the whole
 * point of a claim is that it cannot be checked.
 *
 * A WINDOW ON A CLOCK. A play is not finished when it is made — it sits open for
 * a few seconds while anybody may call it. That is the one thing this game
 * cannot copy from a real table, where calling is a shout and the loudest person
 * wins. The window is what makes it fair, and it is why this engine is the first
 * to need `deadline()`: something has to close it when nobody says anything.
 *
 * A REVEAL THAT IS RETROSPECTIVE. When a claim is called, the cards that were
 * played get turned over and become public knowledge — and then go into
 * somebody's hand, where they STAY public. That is `seen`, and it is the same
 * mechanic Silly Head calls `publicHand`: the room watched those cards, so
 * remembering them is memory rather than X-ray vision, and a bot is as entitled
 * to it as a person.
 */

const PHASES = ['lobby', 'playing', 'complete'];

/**
 * Three, and it is a compromise.
 *
 * The game ends when two players are left holding cards (see `settleGame`), so
 * at three the whole thing is over the moment somebody goes out. That is still a
 * game — first out wins, biggest hand loses — but it is a short one, and four is
 * where this starts being worth playing.
 */
const MIN_PLAYERS = 3;

/**
 * How long a claim stays open for somebody to call it.
 *
 * Three seconds is long enough to look at what was played and decide, and short
 * enough that a table of six does not spend half the evening waiting. It also
 * doubles as the beat the animations need — without it a card would land and be
 * gone before anybody registered whose it was.
 */
const CALL_MS = 3_000;

/** How much of the table's memory is kept. Long enough to cover a full round. */
const LOG_MAX = 60;

// -- Errors -------------------------------------------------------------------

/** @param {string} message @param {string} [code] */
function fail(message, code = 'rejected') {
  return { error: { code, message } };
}

// -- Creation -----------------------------------------------------------------

/**
 * @param {{hostName:string, code:string, decks?:number}} args
 * @param {{now:number, newId:(prefix:string)=>string}} ctx
 */
function createGame({ hostName, code, decks = 1 }, ctx) {
  const host = makePlayer({ id: ctx.newId('p'), name: (hostName || '').trim() || 'Player', now: ctx.now });
  const state = {
    id: ctx.newId('g'),
    code,
    game: 'cheat',
    createdAt: ctx.now,
    updatedAt: ctx.now,
    version: 1,
    phase: 'lobby',
    /** One, two or three. The Master's choice, within what the table size allows. */
    decks: DECK_COUNTS.includes(decks) ? decks : 1,
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
     * The face-down pile in the middle, oldest first.
     *
     * The single most secret object in this repo. It is not redacted per viewer
     * like a hand — it is absent from every payload there is, including the one
     * sent to the person who put the top card on it.
     */
    pile: [],
    /**
     * playerId -> cards the WHOLE ROOM watched go into that hand.
     *
     * Only ever filled by a reveal: cards turned face up in a challenge and then
     * picked up. Everybody saw them, so everybody may remember them, and they
     * are sent to everybody. Forgotten the moment such a card is played again,
     * because nobody can see which cards went face down.
     */
    seen: {},
    /** The rank claimed last, or null when the next claim may be anything. */
    lastRank: null,
    /** Whose turn it is to put cards down. */
    turnId: null,
    /**
     * The claim currently on the table, waiting to be believed.
     *
     * `cards` is the truth of it and never leaves the server. Everything else in
     * here is public the instant it is made — that is what a claim IS.
     */
    claim: null,
    /** Player ids in the order they emptied their hand. All of them are safe. */
    finished: [],
    /** What just happened, for the screens to animate. */
    lastEvent: null,
    /**
     * What the room has watched, oldest first and capped.
     *
     * Claims, calls and their outcomes — never a card id. Everything in here was
     * seen by everybody, so remembering it is fair, and it is what lets a bot
     * notice that you have claimed nines three times running.
     */
    log: [],
    autoPlay: {},
    /** Whoever was left holding the most, once it was down to two. */
    loserId: null,
    /** Both of them, when the last two ended level and there is no single loser. */
    tiedIds: null,
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
 * disagree. `reveal` is the exception that proves the rule: cards turned face up
 * in a challenge belong on the screen for one beat so it can animate them, but
 * they do NOT belong in the log — the log outlives the moment, and those same
 * cards can be face down in the pile again three turns later.
 */
function note(state, event, reveal) {
  state.log.push(event);
  if (state.log.length > LOG_MAX) state.log = state.log.slice(-LOG_MAX);
  state.lastEvent = reveal ? { ...event, cards: reveal.slice() } : event;
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
  if (!handler) return fail('That action is not something Cheat knows how to do.', 'unknown-command');

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

/**
 * How long a window stays open, at the table's current pace.
 *
 * The speed control only ever gets switched on when nobody is waiting on a
 * person, so halving the window costs nobody a chance to call.
 */
function windowMs(state) {
  return Math.round(CALL_MS / (state.speed === 2 ? 2 : 1));
}

/**
 * Everybody entitled to call the claim that is on the table.
 *
 * Still holding cards, still here, and not the person who made it. Going out
 * ends your involvement — you may have the best read at the table, but you have
 * no stake in it any more, and a table policed by people who have already won is
 * a worse game.
 */
function couldCall(state) {
  if (!state.claim) return [];
  return stillIn(state).filter((p) => p.id !== state.claim.playerId);
}

/**
 * What this player may legitimately account for, when judging a claim.
 *
 * Their own cards, plus every card the whole room watched go into somebody
 * else's hand at a reveal. Both are memory. Nothing in here is a card anybody
 * had to peek at, which is what makes it fair to hand to a bot.
 */
function knownTo(state, playerId) {
  const mine = (state.hands && state.hands[playerId]) || [];
  const watched = [];
  for (const [id, cards] of Object.entries(state.seen || {})) {
    if (id === playerId) continue;
    watched.push(...cards);
  }
  return mine.concat(watched);
}

/** Forget a card somebody has just played: nobody can see what went face down. */
function forgetSeen(state, playerId, cards) {
  const seen = state.seen[playerId];
  if (!seen || !seen.length) return;
  const gone = new Set(cards);
  const kept = seen.filter((card) => !gone.has(card));
  if (kept.length) state.seen[playerId] = kept;
  else delete state.seen[playerId];
}

// -- Handlers -----------------------------------------------------------------

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
          ? `One deck seats ${seats}. Ask the Master to add another.`
          : `Cheat seats ${seats} players at most. This game is full.`,
        'game-full'
      );
    }
    const name = uniqueName(String(cmd.name || '').trim() || 'Player', state.players.map((p) => p.name));
    const player = makePlayer({ id: ctx.newId('p'), name, now: ctx.now });
    state.players.push(player);
    // Somebody joining can make the current deck count illegal, and the lobby
    // would be a poor place to find that out at the last moment. Bumped here
    // rather than refused: the table filling up is not the new arrival's fault.
    if (state.decks < minimumDecks(activePlayers(state).length)) {
      state.decks = minimumDecks(activePlayers(state).length);
    }
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
    /** Private. How this one lies and when it calls. Never in a view. */
    player.botSeed = ctx.newId('bot');
    state.players.push(player);
    if (state.decks < minimumDecks(activePlayers(state).length)) {
      state.decks = minimumDecks(activePlayers(state).length);
    }
    return { result: { player } };
  },

  /**
   * Somebody leaves, or the Master lets a vanished phone go.
   *
   * Their cards go face down onto the pile rather than out of the game. The deck
   * has to stay whole: every count anybody has been keeping is arithmetic about
   * a known number of each rank, and quietly removing eleven cards would make
   * every one of those sums wrong without anybody being told.
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

    // A claim of theirs on the table goes down as unchallenged. Nobody gets to
    // call a player who is no longer here to be caught.
    if (state.claim && state.claim.playerId === target.id) closeWindow(state, ctx);

    target.left = true;
    target.leftAt = ctx.now;
    target.awaitingTakeover = false;
    delete state.autoPlay[target.id];
    if (state.hands && state.hands[target.id]) {
      state.pile.push(...state.hands[target.id]);
      delete state.hands[target.id];
    }
    delete state.seen[target.id];
    state.finished = state.finished.filter((id) => id !== target.id);
    if (state.masterId === target.id) state.masterId = nextMaster(state) || target.id;
    if (state.turnId === target.id) state.turnId = nextTurnId(state, target.id);
    if (settleGame(state, ctx)) return;
    maybeCloseWindow(state, ctx);
    advanceAutoPlays(state, ctx);
  },

  /** One deck, two or three. Lobby only — it decides how many cards exist. */
  'game/setDecks'(state, cmd, ctx) {
    if (!isMaster(state, ctx.actorId)) return fail('Only the Master can change that.', 'not-master');
    if (state.phase !== 'lobby') return fail('The game has already started.');
    const decks = Number(cmd.decks);
    const here = activePlayers(state).length;
    if (!deckOptions(here).includes(decks)) {
      return fail(
        here >= 8 ? `With ${here} of you it is two decks or three.` : `With ${here} of you it is one deck or two.`,
        'bad-decks'
      );
    }
    if (here > MAX_PLAYERS[decks]) return fail(`That many decks only seats ${MAX_PLAYERS[decks]}.`, 'too-many');
    state.decks = decks;
  },

  /**
   * How fast the bots move.
   *
   * Only allowed when there is nobody left to wait for — every player still
   * holding cards is a bot. Watching four bots think at a person's pace is not
   * pace, it is a wait, and this is the button for it.
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
    if (players.length > MAX_PLAYERS[state.decks]) {
      return fail(`This many decks only seats ${MAX_PLAYERS[state.decks]}.`, 'too-many');
    }
    if (state.decks < minimumDecks(players.length)) {
      return fail('There are too many of you for one deck. Add another.', 'too-few-decks');
    }

    const ids = players.map((p) => p.id);
    const seed = ctx.newId('deal');
    state.seed = seed;
    state.hands = deal(seed, ids, state.decks);
    state.pile = [];
    state.seen = {};
    state.finished = [];
    state.log = [];
    state.lastRank = null;
    state.claim = null;
    note(state, { kind: 'deal', decks: state.decks, at: ctx.now });
    state.phase = 'playing';
    // Who goes first, from the game's own seed. The first claim of a game is a
    // free choice of rank, so leading is a small advantage and should not always
    // fall to the host.
    state.turnId = ids[hashPick(`${seed}:first`, ids.length)];
    advanceAutoPlays(state, ctx);
  },

  /**
   * Put cards down and say what they are.
   *
   * The claim is public the instant it is made. The CARDS are not, and this is
   * the moment they stop being redacted-per-viewer and become secret from
   * everybody at once — including the person who just played them, whose screen
   * is told the count and the rank like everybody else's.
   *
   * Nothing moves on yet. The window opens instead.
   */
  'play/claim'(state, cmd, ctx) {
    if (state.phase !== 'playing') return fail('The game is not being played.', 'wrong-phase');
    if (state.claim) return fail('There is still a claim on the table.', 'window-open');
    if (!state.turnId) return fail('It is nobody’s turn.', 'no-turn');
    const auto = Boolean(state.autoPlay[state.turnId]);
    if (ctx.actorId && ctx.actorId !== state.turnId) return fail('It is not your turn.', 'not-your-turn');
    if (!ctx.actorId && !auto) return fail('It is not your turn.', 'not-your-turn');

    const playerId = state.turnId;
    const hand = state.hands[playerId] || [];
    const rank = String(cmd.rank || '');
    if (!CYCLE.includes(rank)) return fail('That is not a rank.', 'bad-rank');
    if (!isLegalClaim(state.lastRank, rank)) {
      return fail(`After ${state.lastRank}s you can say ${legalRanks(state.lastRank).join(', ')}.`, 'bad-rank');
    }

    const cardIds = Array.isArray(cmd.cardIds) ? cmd.cardIds.slice() : [];
    if (!cardIds.length) return fail('Put at least one card down.', 'no-cards');
    if (new Set(cardIds).size !== cardIds.length) return fail('That card is only there once.', 'bad-cards');
    const held = new Set(hand);
    if (!cardIds.every((id) => held.has(id))) return fail('Those cards are not all yours.', 'bad-cards');

    state.hands[playerId] = hand.filter((id) => !cardIds.includes(id));
    // Whatever the room remembered about these cards is gone the moment they go
    // face down. Nobody can see which ones you chose.
    forgetSeen(state, playerId, cardIds);

    state.claim = {
      playerId,
      rank,
      count: cardIds.length,
      /** The truth. Never leaves this file except through a reveal. */
      cards: cardIds,
      openedAt: ctx.now,
      closesAt: ctx.now + windowMs(state),
      /** playerId -> they have said they are letting it go. */
      declined: {},
      auto: auto || undefined,
    };
    note(state, {
      kind: 'claim',
      playerId,
      rank,
      count: cardIds.length,
      // Whether it empties their hand is public: everybody can see they have
      // nothing left, and it is the moment somebody usually calls.
      wentOut: state.hands[playerId].length === 0 || undefined,
      auto: auto || undefined,
      at: ctx.now,
    });
    maybeCloseWindow(state, ctx);
  },

  /**
   * Call it.
   *
   * The cards are turned over — only the ones just played, never the pile
   * underneath — and somebody picks the lot up. If the claim was honest that is
   * the person who called; if it was a lie it is the person who made it.
   *
   * The winner of the challenge starts the next round on a rank of their
   * choosing, which is this house's rule and a better one than the usual
   * carry-on-regardless: it makes a good call worth something beyond not having
   * to pick up.
   */
  'play/call'(state, cmd, ctx) {
    if (state.phase !== 'playing') return fail('The game is not being played.', 'wrong-phase');
    const claim = state.claim;
    if (!claim) return fail('There is nothing on the table to call.', 'no-claim');
    const caller = findPlayer(state, ctx.actorId);
    if (!caller || caller.left) return fail('We could not find you at this table.', 'no-seat');
    if (caller.id === claim.playerId) return fail('You cannot call your own bluff.', 'own-claim');
    if (isOut(state, caller.id)) return fail('You are out — it is not yours to call.', 'out');

    const honest = claimIsHonest(claim.cards, claim.rank);
    const loserId = honest ? caller.id : claim.playerId;
    const winnerId = honest ? claim.playerId : caller.id;
    const revealed = claim.cards.slice();

    // Everything on the table goes to whoever lost the argument: the pile they
    // could not see, and the cards they could.
    const picked = state.pile.concat(revealed);
    state.hands[loserId] = sortHand((state.hands[loserId] || []).concat(picked));
    state.pile = [];
    // The revealed cards stay public knowledge for as long as they sit in that
    // hand. The pile does not — nobody but the person picking it up ever sees a
    // single card of it.
    state.seen[loserId] = (state.seen[loserId] || []).concat(revealed);

    state.claim = null;
    // A free choice of rank for whoever won it.
    state.lastRank = null;
    state.turnId = winnerId;

    note(
      state,
      {
        kind: 'call',
        callerId: caller.id,
        claimerId: claim.playerId,
        rank: claim.rank,
        count: claim.count,
        honest,
        loserId,
        picked: picked.length,
        at: ctx.now,
      },
      // The faces, for one beat, so the screen can turn them over. Deliberately
      // NOT in the log: the log outlives the moment, and these same cards can be
      // face down in the pile again three turns later.
      revealed
    );

    // An honest claim that emptied the claimer's hand puts them out — those
    // cards went to the caller, not back.
    if ((state.hands[claim.playerId] || []).length === 0 && !isOut(state, claim.playerId)) {
      state.finished.push(claim.playerId);
    }
    if (settleGame(state, ctx)) return;
    if (isOut(state, state.turnId)) state.turnId = nextTurnId(state, state.turnId);
    advanceAutoPlays(state, ctx);
  },

  /**
   * Let it go.
   *
   * Not a button on anybody's phone — a person says nothing and the clock runs
   * out. It exists for the bots, so a table with nobody left to wait for can
   * close its window early instead of sitting through three seconds of silence
   * every single turn.
   */
  'play/pass'(state, cmd, ctx) {
    if (state.phase !== 'playing') return fail('The game is not being played.', 'wrong-phase');
    const claim = state.claim;
    if (!claim) return fail('There is nothing on the table.', 'no-claim');
    const player = findPlayer(state, ctx.actorId);
    if (!player || player.left) return fail('We could not find you at this table.', 'no-seat');
    if (player.id === claim.playerId) return fail('It is your own claim.', 'own-claim');
    if (isOut(state, player.id)) return fail('You are out.', 'out');
    if (claim.declined[player.id]) return;
    claim.declined[player.id] = true;
    maybeCloseWindow(state, ctx);
  },

  /**
   * The window ran out and nobody said anything, so it stands.
   *
   * Dispatched by the room off `deadline()`, with no actor. Carries the moment
   * the window opened, so a timer that fires late — after the claim was already
   * called and a new one made — is a no-op rather than settling the wrong thing.
   */
  'play/settle'(state, cmd, ctx) {
    if (state.phase !== 'playing') return;
    if (!state.claim) return;
    if (cmd.openedAt != null && cmd.openedAt !== state.claim.openedAt) return;
    closeWindow(state, ctx);
    if (settleGame(state, ctx)) return;
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
    maybeCloseWindow(state, ctx);
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
    state.claim = null;
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

// -- The window ---------------------------------------------------------------

/**
 * Everybody still in is a bot.
 *
 * The condition on the speed control, and it is deliberately about who is still
 * HOLDING CARDS rather than who is at the table. Once you are out you are
 * watching, and watching four bots think at a person's pace is a wait.
 */
function onlyBotsLeft(state) {
  const left = stillIn(state);
  if (!left.length) return false;
  return left.every((p) => p.isBot || state.autoPlay[p.id]);
}

/**
 * Close the window early if there is nobody left who might call.
 *
 * Two ways that happens: everybody entitled to call has said they are letting it
 * go, or there is nobody entitled at all. Without this a table of bots would sit
 * out the full three seconds on every single claim, which is the difference
 * between a watchable game and a slideshow.
 *
 * A player being skipped never calls — the Master gave up waiting on them, and
 * having the app call on their behalf would be playing the hand for them.
 */
function maybeCloseWindow(state, ctx) {
  if (!state.claim) return;
  const waiting = couldCall(state).filter((p) => !state.claim.declined[p.id] && !state.autoPlay[p.id]);
  if (waiting.length) return;
  closeWindow(state, ctx);
  settleGame(state, ctx);
}

/**
 * The claim stands. Cards to the pile, the rank moves on, next player.
 *
 * The one place a claim becomes final without being turned over — so this is
 * also the moment a player who put their last cards down is safely out.
 */
function closeWindow(state, ctx) {
  const claim = state.claim;
  if (!claim) return;
  state.pile.push(...claim.cards);
  state.lastRank = claim.rank;
  state.claim = null;
  note(state, {
    kind: 'stands',
    playerId: claim.playerId,
    rank: claim.rank,
    count: claim.count,
    at: ctx.now,
  });
  if ((state.hands[claim.playerId] || []).length === 0 && !isOut(state, claim.playerId)) {
    state.finished.push(claim.playerId);
  }
  state.turnId = nextTurnId(state, claim.playerId);
}

// -- Settling -----------------------------------------------------------------

/**
 * Is the game over?
 *
 * **It ends when two players are left holding cards, not one.** That is not a
 * shortcut, it is the only way this game terminates. Heads-up Cheat cannot end:
 * "the same rank" is always a legal claim, so two players can pass one pile back
 * and forth for ever with neither ever forced into a position they cannot hold.
 * Every real table stops before that point, and this one does too.
 *
 * Of the last two, whoever is holding more cards loses. Level, and there is no
 * single loser and the app says so rather than inventing one — a coin toss for
 * the wooden spoon is worse than an honest draw.
 *
 * @returns {boolean} true if the game has just ended
 */
function settleGame(state, ctx) {
  if (state.phase !== 'playing') return false;
  const left = stillIn(state);
  if (left.length > 2) return false;

  state.phase = 'complete';
  state.completedAt = ctx.now;
  state.turnId = null;
  state.claim = null;
  state.loserId = null;
  state.tiedIds = null;

  if (left.length === 1) {
    state.loserId = left[0].id;
    return true;
  }
  if (left.length === 2) {
    const [a, b] = left;
    const held = (p) => (state.hands[p.id] || []).length;
    if (held(a) > held(b)) state.loserId = a.id;
    else if (held(b) > held(a)) state.loserId = b.id;
    else state.tiedIds = [a.id, b.id];
  }
  return true;
}

/**
 * A pick from a seed, without a clock or `Math.random()`.
 *
 * Small enough not to be worth pulling in the deck's generator, and it has one
 * job: choose who leads.
 */
function hashPick(key, size) {
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return size ? Math.abs(h) % size : 0;
}

/**
 * Play for anybody the Master has given up waiting on.
 *
 * One card, at the safest legal rank they hold, and a lie of one card when they
 * hold none of it. Deliberately timid: being absent should cost you the game
 * rather than have it quietly played well on your behalf. An absent player never
 * calls either, which is its own tell and a fair one.
 *
 * Stops as soon as a window is open — the clock takes it from there.
 */
function advanceAutoPlays(state, ctx) {
  for (let guard = 0; guard <= state.players.length; guard++) {
    if (state.phase !== 'playing' || !state.turnId || state.claim) return;
    if (!state.autoPlay[state.turnId]) return;
    const before = state.turnId;
    const out = HANDLERS['play/claim'](state, autoClaim(state, before), { ...ctx, actorId: null });
    if (out && out.error) return;
    if (state.turnId === before && state.claim) return;
  }
}

/** The one card an absent player puts down, and what they say it is. */
function autoClaim(state, playerId) {
  const hand = state.hands[playerId] || [];
  const legal = legalRanks(state.lastRank);
  const counts = countByRank(hand);
  const honest = legal.filter((rank) => counts[rank]).sort((a, b) => counts[b] - counts[a])[0];
  if (honest) return { type: 'play/claim', rank: honest, cardIds: [hand.find((c) => rankOf(c) === honest)] };
  return { type: 'play/claim', rank: legal[0], cardIds: [hand[0]] };
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
  CALL_MS,
  createGame,
  applyCommand,
  findPlayer,
  activePlayers,
  eligibleForMaster,
  isOut,
  stillIn,
  seating,
  nextTurnId,
  couldCall,
  knownTo,
  onlyBotsLeft,
  windowMs,
};
