'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const game = require('../lib/game');
const bot = require('../lib/bot');
const { viewFor } = require('../lib/view');
const { legalPlays, suitOf, newDeck } = require('../lib/deck');

// ── Harness ──────────────────────────────────────────────────────────────────

function ctxFactory(start = 1_000) {
  let n = 0;
  let clock = start;
  return {
    next(actorId) {
      n += 1;
      clock += 1;
      return { now: clock, newId: (prefix) => `${prefix}_${n}`, actorId };
    },
  };
}

function ok(state, command, actorId, ctxf) {
  const out = game.applyCommand(state, command, ctxf.next(actorId));
  assert.equal(out.error, undefined, `expected success, got: ${out.error && out.error.message}`);
  return out;
}

/** An online lobby with a human Master and however many bots. */
function lobbyWithBots(levels, startHandSize = 3) {
  const ctxf = ctxFactory();
  let { state } = game.createGame(
    { hostName: 'Human', code: '1234', startHandSize, mode: 'online' },
    ctxf.next(null)
  );
  const masterId = state.players[0].id;
  for (const level of levels) {
    state = ok(state, { type: 'player/addBot', level }, masterId, ctxf).state;
  }
  return { state, ctxf, masterId };
}

/**
 * Play a whole online game out with the bots deciding for themselves and the
 * human doing whatever is legal. Returns the finished state.
 *
 * This is the test that matters most: it is the reducer, the view and the brain
 * wired together exactly as the server wires them, so anything the bot cannot
 * legally do shows up here as a refusal rather than as a bad hand months later.
 */
function playOutGame(state, ctxf, masterId, humanPlays = (legal) => legal[0]) {
  const secretOf = (p) => ({ seed: p.botSeed, level: p.botLevel });
  let guard = 4000;

  while (state.phase !== 'complete' && guard-- > 0) {
    const round = game.currentRound(state);

    if (state.phase === 'bidding') {
      for (const player of game.roundPlayers(state, round)) {
        if (round.bids[player.id]) continue;
        const value = player.isBot
          ? bot.chooseBid(viewFor(state, player.id), secretOf(player))
          : 0;
        assert.ok(
          Number.isInteger(value) && value >= 0 && value <= round.handSize,
          `bid ${value} is not between 0 and ${round.handSize}`
        );
        state = ok(state, { type: 'bid/submit', playerId: player.id, value }, player.id, ctxf).state;
      }
      continue;
    }

    if (state.phase === 'playing') {
      const turnId = round.trick.turnId;
      const player = game.findPlayer(state, turnId);
      const legal = legalPlays(round.hands[turnId], round.trick.ledSuit);
      const cardId = player.isBot
        ? bot.chooseCard(viewFor(state, turnId), secretOf(player))
        : humanPlays(legal);
      if (round.handSize === 1) {
        // Forehead round: nobody names the card, bots included.
        state = ok(state, { type: 'trick/play' }, turnId, ctxf).state;
      } else {
        assert.ok(legal.includes(cardId), `${player.name} tried to play ${cardId}, which is not legal`);
        state = ok(state, { type: 'trick/play', cardId }, turnId, ctxf).state;
      }
      continue;
    }

    if (state.phase === 'summary') {
      state = ok(state, { type: 'round/next' }, masterId, ctxf).state;
      continue;
    }

    throw new Error(`stuck in phase ${state.phase}`);
  }
  assert.equal(state.phase, 'complete', 'the game never finished');
  return state;
}

/** Advance the game by exactly one legal action, whoever is up. */
function stepOnce(state, ctxf, masterId) {
  const round = game.currentRound(state);
  if (state.phase === 'bidding') {
    const player = game.roundPlayers(state, round).find((p) => !round.bids[p.id]);
    const value = player.isBot
      ? bot.chooseBid(viewFor(state, player.id), { seed: player.botSeed, level: player.botLevel })
      : 0;
    return ok(state, { type: 'bid/submit', playerId: player.id, value }, player.id, ctxf).state;
  }
  if (state.phase === 'playing') {
    const turnId = round.trick.turnId;
    const player = game.findPlayer(state, turnId);
    if (round.handSize === 1) return ok(state, { type: 'trick/play' }, turnId, ctxf).state;
    const cardId = player.isBot
      ? bot.chooseCard(viewFor(state, turnId), { seed: player.botSeed, level: player.botLevel })
      : legalPlays(round.hands[turnId], round.trick.ledSuit)[0];
    return ok(state, { type: 'trick/play', cardId }, turnId, ctxf).state;
  }
  if (state.phase === 'summary') return ok(state, { type: 'round/next' }, masterId, ctxf).state;
  throw new Error(`nothing to do in phase ${state.phase}`);
}

// ── Adding them ──────────────────────────────────────────────────────────────

test('the Master can fill the table with bots', () => {
  const { state } = lobbyWithBots(['easy', 'hard']);
  assert.equal(state.players.length, 3);
  const bots = state.players.filter((p) => p.isBot);
  assert.equal(bots.length, 2);
  assert.deepEqual(bots.map((b) => b.botLevel), ['easy', 'hard']);
  // Named, connected, and each with a seed of its own.
  assert.ok(bots.every((b) => b.name && b.connected && b.botSeed));
  assert.notEqual(bots[0].botSeed, bots[1].botSeed);
});

test('an unknown level lands on medium rather than refusing', () => {
  const { state } = lobbyWithBots(['dastardly']);
  assert.equal(state.players[1].botLevel, 'medium');
});

test('only the Master can add a bot, and only to an online lobby', () => {
  const ctxf = ctxFactory();
  let { state } = game.createGame({ hostName: 'Human', code: '1234', mode: 'online' }, ctxf.next(null));
  const masterId = state.players[0].id;
  state = ok(state, { type: 'player/join', name: 'Sam' }, null, ctxf).state;
  const samId = state.players[1].id;

  assert.match(
    game.applyCommand(state, { type: 'player/addBot' }, ctxf.next(samId)).error.message,
    /Only the Master/
  );

  let table = game.createGame({ hostName: 'Human', code: '5678', mode: 'table' }, ctxf.next(null)).state;
  const tableMaster = table.players[0].id;
  assert.equal(
    game.applyCommand(table, { type: 'player/addBot' }, ctxf.next(tableMaster)).error.code,
    'not-online'
  );

  state = ok(state, { type: 'game/start' }, masterId, ctxf).state;
  assert.ok(game.applyCommand(state, { type: 'player/addBot' }, ctxf.next(masterId)).error);
});

test('a bot cannot be elected Master', () => {
  const { state, ctxf, masterId } = lobbyWithBots(['hard', 'hard']);
  let next = ok(state, { type: 'conn/set', playerId: masterId, connected: false }, null, ctxf).state;
  const outcome = game.applyCommand(next, { type: 'election/start' }, ctxf.next(null));
  // There is nobody with a phone left to stand, and a bot is not a candidate.
  assert.equal(outcome.error.code, 'no-candidates');
});

test('a bot is never marked away', () => {
  const { state, ctxf } = lobbyWithBots(['easy']);
  const botId = state.players[1].id;
  const next = ok(state, { type: 'conn/set', playerId: botId, connected: false }, null, ctxf).state;
  assert.equal(game.findPlayer(next, botId).connected, true);
});

// ── The privacy boundary ─────────────────────────────────────────────────────

test('a bot is dealt the same redacted view as a phone', () => {
  const { state, ctxf, masterId } = lobbyWithBots(['impossible', 'impossible']);
  const started = ok(state, { type: 'game/start' }, masterId, ctxf).state;
  const botId = started.players[1].id;
  const view = viewFor(started, botId);

  // Its own hand, and no key at all for anybody else's.
  assert.equal(view.you.hand.length, 3);
  for (const player of view.players) {
    assert.ok(!('hand' in player), 'a hand reached the players list');
  }
  const payload = JSON.stringify(view);
  for (const other of started.players.filter((p) => p.id !== botId)) {
    for (const card of started.rounds[0].hands[other.id]) {
      assert.ok(!payload.includes(`"${card}"`), `${card} leaked into a bot's view`);
    }
  }
});

test('nothing about how a bot plays ever leaves the server', () => {
  const { state, ctxf, masterId } = lobbyWithBots(['hard']);
  const started = ok(state, { type: 'game/start' }, masterId, ctxf).state;
  const seed = started.players[1].botSeed;

  for (const viewerId of [masterId, started.players[1].id, null]) {
    const payload = JSON.stringify(viewFor(started, viewerId));
    assert.ok(!payload.includes(seed), 'the bot seed leaked into a view');
    assert.ok(!payload.includes('persona'), 'a persona leaked into a view');
    assert.ok(!payload.includes('bidBias'), 'persona settings leaked into a view');
  }

  // What IS public: that it is a bot at all, and which level was picked.
  const seat = viewFor(started, masterId).players.find((p) => p.id === started.players[1].id);
  assert.equal(seat.isBot, true);
  assert.equal(seat.botLevel, 'hard');
  const human = viewFor(started, masterId).players.find((p) => p.id === masterId);
  assert.equal(human.isBot, false);
  assert.equal(human.botLevel, null);
});

test('the played-card log carries only cards everyone watched go down', () => {
  const { state, ctxf, masterId } = lobbyWithBots(['medium']);
  let next = ok(state, { type: 'game/start' }, masterId, ctxf).state;
  for (const player of next.players) {
    next = ok(next, { type: 'bid/submit', playerId: player.id, value: 0 }, player.id, ctxf).state;
  }
  const round = game.currentRound(next);
  const turnId = round.trick.turnId;
  const card = round.hands[turnId][0];
  next = ok(next, { type: 'trick/play', cardId: card }, turnId, ctxf).state;

  const view = viewFor(next, masterId);
  assert.deepEqual(view.round.trickLog, []); // nothing has settled yet
  assert.equal(view.round.trick.plays[0].cardId, card);
});

// ── Bidding ──────────────────────────────────────────────────────────────────

test('every level bids inside the round, on every hand size', () => {
  for (const level of ['easy', 'medium', 'hard', 'impossible']) {
    for (const handSize of [1, 2, 5, 7]) {
      const { state, ctxf, masterId } = lobbyWithBots([level, level], handSize);
      const started = ok(state, { type: 'game/start' }, masterId, ctxf).state;
      for (const player of started.players.filter((p) => p.isBot)) {
        const value = bot.chooseBid(viewFor(started, player.id), {
          seed: player.botSeed,
          level: player.botLevel,
        });
        assert.ok(
          Number.isInteger(value) && value >= 0 && value <= handSize,
          `${level} bid ${value} on a hand of ${handSize}`
        );
      }
    }
  }
});

test('a hand full of aces is worth more than a hand full of twos', () => {
  const strong = bot.estimateTricks(['AS', 'AH', 'AD', 'AC', 'KS'], 'S', 4, 5);
  const weak = bot.estimateTricks(['2S', '3H', '4D', '5C', '6S'], 'S', 4, 5);
  assert.ok(strong > weak + 2, `${strong} should comfortably beat ${weak}`);
  assert.ok(strong <= 5 && weak >= 0);
});

test('trumps are worth more than the same cards in a plain suit', () => {
  const asTrumps = bot.estimateTricks(['QH', 'JH', '10H', '9H'], 'H', 4, 4);
  const asPlain = bot.estimateTricks(['QH', 'JH', '10H', '9H'], 'S', 4, 4);
  assert.ok(asTrumps > asPlain, `${asTrumps} should beat ${asPlain}`);
});

test('the forehead round is bid on what it can see, not on what it holds', () => {
  // The smallest hand a game can START on is three, so the one-card round is
  // reached by playing down to it.
  const { state, ctxf, masterId } = lobbyWithBots(['hard', 'hard'], 3);
  let next = ok(state, { type: 'game/start' }, masterId, ctxf).state;
  let guard = 200;
  while (game.currentRound(next).handSize !== 1 && guard-- > 0) {
    next = stepOnce(next, ctxf, masterId);
  }
  const round = game.currentRound(next);
  assert.equal(round.handSize, 1);
  assert.equal(next.phase, 'bidding');

  const botPlayer = next.players.find((p) => p.isBot);
  const view = viewFor(next, botPlayer.id);
  assert.equal(view.you.hand, undefined, 'the bot was shown its own forehead card');
  // Everyone else's card IS public in this round — that is the whole game.
  const others = view.players.filter((p) => p.id !== botPlayer.id);
  assert.ok(others.every((p) => p.card), 'the bot could not see the cards on the other foreheads');

  const value = bot.chooseBid(view, { seed: botPlayer.botSeed, level: 'hard' });
  assert.ok(value === 0 || value === 1, `bid ${value} on a one-card hand`);
});

// ── Playing ──────────────────────────────────────────────────────────────────

test('every level plays a legal card, every trick, to the end of a game', () => {
  for (const level of ['easy', 'medium', 'hard', 'impossible']) {
    const { state, ctxf, masterId } = lobbyWithBots([level, level, level], 3);
    const started = ok(state, { type: 'game/start' }, masterId, ctxf).state;
    const finished = playOutGame(started, ctxf, masterId);
    // Five rounds: 3, 2, 1, 2, 3.
    assert.equal(finished.rounds.length, 5);
    for (const round of finished.rounds) {
      const dealt = game.roundPlayers(finished, round);
      const tricks = dealt.reduce((n, p) => n + round.tricks[p.id], 0);
      assert.equal(tricks, round.handSize, `round ${round.index} lost a trick`);
    }
  }
});

test('a table of bots and people finishes a full seven-card game', () => {
  const { state, ctxf, masterId } = lobbyWithBots(['easy', 'medium', 'hard', 'impossible'], 7);
  const started = ok(state, { type: 'game/start' }, masterId, ctxf).state;
  const finished = playOutGame(started, ctxf, masterId);
  assert.equal(finished.rounds.length, 13);
  assert.equal(finished.players.length, 5);
});

test('a bot follows suit when it can', () => {
  const { state, ctxf, masterId } = lobbyWithBots(['hard', 'hard'], 5);
  let next = ok(state, { type: 'game/start' }, masterId, ctxf).state;
  for (const player of next.players) {
    next = ok(next, { type: 'bid/submit', playerId: player.id, value: 1 }, player.id, ctxf).state;
  }

  let followed = 0;
  let guard = 60;
  while (next.phase === 'playing' && guard-- > 0) {
    const round = game.currentRound(next);
    const turnId = round.trick.turnId;
    const player = game.findPlayer(next, turnId);
    const led = round.trick.ledSuit;
    const hand = round.hands[turnId];
    const cardId = player.isBot
      ? bot.chooseCard(viewFor(next, turnId), { seed: player.botSeed, level: player.botLevel })
      : legalPlays(hand, led)[0];
    if (player.isBot && led && hand.some((c) => suitOf(c) === led)) {
      assert.equal(suitOf(cardId), led, `${player.name} threw off with ${led} still in hand`);
      followed += 1;
    }
    next = ok(next, { type: 'trick/play', cardId }, turnId, ctxf).state;
  }
  assert.ok(followed > 0, 'the test never actually exercised following suit');
});

// ── The personas ─────────────────────────────────────────────────────────────

test('a bot plays a different way each round, and two bots differ from each other', () => {
  const seen = new Set();
  for (let round = 0; round < 12; round += 1) {
    seen.add(JSON.stringify(bot.personaFor('hard', 'bot_seed_one', round)));
  }
  assert.ok(seen.size >= 2, 'the same persona came up every single round');

  const first = bot.personaFor('hard', 'bot_seed_one', 0);
  let differs = false;
  for (const seed of ['bot_a', 'bot_b', 'bot_c', 'bot_d']) {
    if (JSON.stringify(bot.personaFor('hard', seed, 0)) !== JSON.stringify(first)) differs = true;
  }
  assert.ok(differs, 'every bot at the table would play identically');
});

test('the same seed and round always give the same persona', () => {
  assert.deepEqual(bot.personaFor('medium', 'seed', 4), bot.personaFor('medium', 'seed', 4));
});

test('a level nobody recognises still gets a persona', () => {
  assert.ok(bot.personaFor('nonsense', 'seed', 0));
});

// ── Sanity on the whole thing ────────────────────────────────────────────────

test('deciding is pure — the same view twice gives the same card', () => {
  const { state, ctxf, masterId } = lobbyWithBots(['impossible'], 5);
  let next = ok(state, { type: 'game/start' }, masterId, ctxf).state;
  for (const player of next.players) {
    next = ok(next, { type: 'bid/submit', playerId: player.id, value: 2 }, player.id, ctxf).state;
  }
  const round = game.currentRound(next);
  const botPlayer = next.players.find((p) => p.isBot);
  // Get it to the bot's turn.
  while (game.currentRound(next).trick.turnId !== botPlayer.id) {
    const turnId = game.currentRound(next).trick.turnId;
    const r = game.currentRound(next);
    next = ok(next, { type: 'trick/play', cardId: legalPlays(r.hands[turnId], r.trick.ledSuit)[0] }, turnId, ctxf)
      .state;
  }
  const secret = { seed: botPlayer.botSeed, level: 'impossible' };
  const view = viewFor(next, botPlayer.id);
  assert.equal(bot.chooseCard(view, secret), bot.chooseCard(view, secret));
  assert.ok(round.handSize > 0);
});

test('a bot cannot invent a card it does not hold', () => {
  const { state, ctxf, masterId } = lobbyWithBots(['impossible', 'hard'], 7);
  let next = ok(state, { type: 'game/start' }, masterId, ctxf).state;
  for (const player of next.players) {
    next = ok(next, { type: 'bid/submit', playerId: player.id, value: 2 }, player.id, ctxf).state;
  }
  let guard = 100;
  while (next.phase === 'playing' && guard-- > 0) {
    const round = game.currentRound(next);
    const turnId = round.trick.turnId;
    const player = game.findPlayer(next, turnId);
    const cardId = player.isBot
      ? bot.chooseCard(viewFor(next, turnId), { seed: player.botSeed, level: player.botLevel })
      : legalPlays(round.hands[turnId], round.trick.ledSuit)[0];
    assert.ok(round.hands[turnId].includes(cardId), `${player.name} played ${cardId} from nowhere`);
    next = ok(next, { type: 'trick/play', cardId }, turnId, ctxf).state;
  }
  assert.equal(next.phase, 'summary');
});

test('the name pool does not repeat itself at one table', () => {
  const { state } = lobbyWithBots(['easy', 'easy', 'easy', 'easy', 'easy']);
  const names = state.players.map((p) => p.name);
  assert.equal(new Set(names).size, names.length);
});

test('a deck is still a deck', () => {
  assert.equal(new Set(newDeck()).size, 52);
});
