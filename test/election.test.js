'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const game = require('../lib/game');
const { viewFor } = require('../lib/view');
const { resolveBallot, tally, byTiebreak } = require('../lib/election');

function ctxFactory() {
  let n = 0;
  let clock = 1_000;
  return {
    next(actorId) {
      n += 1;
      clock += 1;
      return { now: clock, newId: (p) => `${p}_${n}`, actorId };
    },
  };
}

function ok(state, command, actorId, ctxf) {
  const out = game.applyCommand(state, command, ctxf.next(actorId));
  assert.equal(out.error, undefined, `expected success, got: ${out.error && out.error.message}`);
  return out.state;
}

function refused(state, command, actorId, ctxf) {
  const out = game.applyCommand(state, command, ctxf.next(actorId));
  assert.ok(out.error, 'expected refusal');
  return out.error;
}

/** A started game; players[0] is the Master. */
function startedGame(names, handSize = 3) {
  const ctxf = ctxFactory();
  let { state } = game.createGame({ hostName: names[0], code: '1234', startHandSize: handSize }, ctxf.next(null));
  for (const name of names.slice(1)) state = ok(state, { type: 'player/join', name }, null, ctxf);
  state = ok(state, { type: 'game/start' }, state.masterId, ctxf);
  return { state, ctxf };
}

/** Knock a player offline and let their grace period lapse. */
function drop(state, playerId, ctxf) {
  let s = ok(state, { type: 'conn/set', playerId, connected: false }, null, ctxf);
  s = ok(s, { type: 'conn/takeover', playerId }, null, ctxf);
  return s;
}

// ── Tally rules on their own ─────────────────────────────────────────────────

test('votes are counted per candidate', () => {
  assert.deepEqual(tally({ a: 'b', c: 'b', d: 'a' }, ['a', 'b', 'c']), { a: 1, b: 2, c: 0 });
});

test('a ballot stays open until everyone eligible has voted', () => {
  const out = resolveBallot({
    candidates: ['a', 'b', 'c'],
    votes: { a: 'b' },
    eligible: ['a', 'b', 'c'],
    tiebreakOrder: ['a', 'b', 'c'],
  });
  assert.equal(out.status, 'open');
});

test('the clear leader wins', () => {
  const out = resolveBallot({
    candidates: ['james', 'alex', 'tom'],
    votes: { james: 'alex', alex: 'james', tom: 'james', extra: 'james' },
    eligible: ['james', 'alex', 'tom', 'extra'],
    tiebreakOrder: ['james', 'alex', 'tom'],
  });
  assert.equal(out.status, 'resolved');
  assert.equal(out.winnerId, 'james');
  assert.equal(out.reason, 'majority');
  assert.deepEqual(out.counts, { james: 3, alex: 1, tom: 0 });
});

test('a tie runs off between the tied candidates only', () => {
  const out = resolveBallot({
    candidates: ['james', 'alex', 'tom'],
    votes: { james: 'alex', alex: 'james', tom: 'james', d: 'alex', e: 'tom' },
    eligible: ['james', 'alex', 'tom', 'd', 'e'],
    tiebreakOrder: ['james', 'alex', 'tom'],
  });
  assert.equal(out.status, 'runoff');
  assert.deepEqual(out.candidates, ['james', 'alex'], 'Tom had one vote and drops out');
});

test('a runoff that cannot narrow resolves on seniority instead of looping', () => {
  // Two eligible voters, neither able to vote for themselves, tie forever.
  const out = resolveBallot({
    candidates: ['james', 'alex'],
    votes: { james: 'alex', alex: 'james' },
    eligible: ['james', 'alex'],
    previousCandidates: ['james', 'alex'],
    tiebreakOrder: ['alex', 'james'],
  });
  assert.equal(out.status, 'resolved');
  assert.equal(out.reason, 'tiebreak');
  assert.equal(out.winnerId, 'alex', 'the longest-standing tied player takes it');
});

test('seniority order decides the tiebreak', () => {
  assert.equal(byTiebreak(['c', 'b'], ['a', 'b', 'c']), 'b');
  assert.equal(byTiebreak(['z'], ['a']), 'z');
});

// ── Disconnection ────────────────────────────────────────────────────────────

test('a disconnected player keeps a bid they already submitted', () => {
  const { state, ctxf } = startedGame(['Seb', 'James', 'Alex']);
  const [, james] = state.players.map((p) => p.id);
  let s = ok(state, { type: 'bid/submit', playerId: james, value: 2 }, james, ctxf);
  s = drop(s, james, ctxf);
  assert.equal(s.rounds[0].bids[james].value, 2, 'the bid survives the disconnection');
  assert.equal(s.rounds[0].bids[james].enteredBy, 'self');
  s = ok(s, { type: 'conn/set', playerId: james, connected: true }, null, ctxf);
  assert.equal(s.rounds[0].bids[james].value, 2);
  assert.equal(game.findPlayer(s, james).awaitingTakeover, false);
});

test('the Master may bid for a player only once their grace period has lapsed', () => {
  const { state, ctxf } = startedGame(['Seb', 'James', 'Alex']);
  const [seb, james] = state.players.map((p) => p.id);

  const justDropped = ok(state, { type: 'conn/set', playerId: james, connected: false }, null, ctxf);
  assert.equal(
    refused(justDropped, { type: 'bid/submit', playerId: james, value: 1 }, seb, ctxf).code,
    'not-allowed',
    'still inside the reconnection window'
  );

  const lapsed = ok(justDropped, { type: 'conn/takeover', playerId: james }, null, ctxf);
  const s = ok(lapsed, { type: 'bid/submit', playerId: james, value: 1 }, seb, ctxf);
  assert.equal(s.rounds[0].bids[james].enteredBy, 'master', 'recorded as entered by the Master');

  const view = viewFor(s, seb);
  assert.equal(view.players.find((p) => p.id === james).bidEnteredBy, 'master');
});

test('the Master sees who has submitted but not what they bid', () => {
  const { state, ctxf } = startedGame(['Seb', 'James', 'Alex', 'Tom']);
  const [seb, james, alex, tom] = state.players.map((p) => p.id);
  let s = ok(state, { type: 'bid/submit', playerId: seb, value: 3 }, seb, ctxf);
  s = ok(s, { type: 'bid/submit', playerId: james, value: 2 }, james, ctxf);
  s = ok(s, { type: 'bid/submit', playerId: tom, value: 1 }, tom, ctxf);

  const masterView = viewFor(s, seb);
  assert.equal(masterView.round.bidsIn, 3);
  assert.equal(masterView.round.bidsNeeded, 4);
  assert.equal(masterView.players.find((p) => p.id === james).hasBid, true);
  assert.equal(masterView.players.find((p) => p.id === james).bid, null, 'value stays hidden');
  assert.equal(masterView.players.find((p) => p.id === alex).hasBid, false);
});

// ── Master election ──────────────────────────────────────────────────────────

test('an election starts only once the Master is really gone', () => {
  const { state, ctxf } = startedGame(['Seb', 'James', 'Alex']);
  assert.equal(refused(state, { type: 'election/start' }, null, ctxf).code, 'master-present');

  const dropped = ok(state, { type: 'conn/set', playerId: state.masterId, connected: false }, null, ctxf);
  const s = ok(dropped, { type: 'election/start' }, null, ctxf);
  assert.equal(s.election.ballot, 1);
  assert.equal(s.election.candidates.length, 2, 'the two remaining connected players stand');
  assert.equal(s.election.resolvedAt, null);
});

test('the last remaining player is promoted without a ballot', () => {
  const { state, ctxf } = startedGame(['Seb', 'James']);
  const [seb, james] = state.players.map((p) => p.id);
  let s = ok(state, { type: 'conn/set', playerId: seb, connected: false }, null, ctxf);
  s = ok(s, { type: 'election/start' }, null, ctxf);
  assert.equal(s.masterId, james);
  assert.equal(s.election.reason, 'only-candidate');
  assert.equal(s.election.resolved, undefined);
  assert.ok(s.election.resolvedAt);
});

test('offline players cannot stand for Master and cannot vote', () => {
  const ctxf = ctxFactory();
  let { state } = game.createGame({ hostName: 'Seb', code: '1234', startHandSize: 3 }, ctxf.next(null));
  state = ok(state, { type: 'player/join', name: 'James' }, null, ctxf);
  state = ok(state, { type: 'player/addOffline', name: 'Grandad' }, state.masterId, ctxf);
  state = ok(state, { type: 'game/start' }, state.masterId, ctxf);

  const grandad = state.players.find((p) => p.name === 'Grandad').id;
  let s = ok(state, { type: 'conn/set', playerId: state.masterId, connected: false }, null, ctxf);
  s = ok(s, { type: 'election/start' }, null, ctxf);
  assert.equal(s.election.candidates.includes(grandad), false);
  assert.equal(s.election.eligible.includes(grandad), false);
});

test('a player cannot vote for themselves, or twice, and votes stay private', () => {
  const { state, ctxf } = startedGame(['Seb', 'James', 'Alex', 'Tom']);
  const [seb, james, alex, tom] = state.players.map((p) => p.id);
  let s = ok(state, { type: 'conn/set', playerId: seb, connected: false }, null, ctxf);
  s = ok(s, { type: 'election/start' }, null, ctxf);

  assert.equal(refused(s, { type: 'election/vote', candidateId: james }, james, ctxf).code, 'self-vote');
  assert.equal(refused(s, { type: 'election/vote', candidateId: james }, seb, ctxf).code, 'not-eligible');

  s = ok(s, { type: 'election/vote', candidateId: james }, alex, ctxf);
  assert.equal(refused(s, { type: 'election/vote', candidateId: tom }, alex, ctxf).code, 'already-voted');

  const tomView = viewFor(s, tom);
  assert.equal(tomView.election.votesIn, 1);
  assert.deepEqual(tomView.election.voted, [alex], 'Tom sees THAT Alex voted');
  assert.equal(tomView.election.counts, null, 'but no counts before the tally');
  assert.equal(JSON.stringify(tomView.election).includes(`"${james}"`), true);
  const alexView = viewFor(s, alex);
  assert.equal(alexView.election.yourVote, james, 'you can see your own vote');
});

test('the winner of the vote becomes Master for the rest of the game', () => {
  const { state, ctxf } = startedGame(['Seb', 'James', 'Alex', 'Tom']);
  const [seb, james, alex, tom] = state.players.map((p) => p.id);
  let s = ok(state, { type: 'conn/set', playerId: seb, connected: false }, null, ctxf);
  s = ok(s, { type: 'election/start' }, null, ctxf);

  s = ok(s, { type: 'election/vote', candidateId: james }, alex, ctxf);
  s = ok(s, { type: 'election/vote', candidateId: james }, tom, ctxf);
  s = ok(s, { type: 'election/vote', candidateId: alex }, james, ctxf);

  assert.equal(s.election.resolvedAt !== null, true);
  assert.equal(s.masterId, james);

  // The old Master coming back does not get the crown back.
  s = ok(s, { type: 'conn/set', playerId: seb, connected: true }, null, ctxf);
  assert.equal(s.masterId, james);
  assert.equal(viewFor(s, seb).you.isMaster, false);
  assert.equal(viewFor(s, james).you.isMaster, true);
});

test('a tied election runs another ballot between the tied players', () => {
  const { state, ctxf } = startedGame(['Seb', 'James', 'Alex', 'Tom', 'Nina']);
  const [seb, james, alex, tom, nina] = state.players.map((p) => p.id);
  let s = ok(state, { type: 'conn/set', playerId: seb, connected: false }, null, ctxf);
  s = ok(s, { type: 'election/start' }, null, ctxf);

  // James 2, Alex 2, Tom 1 -> runoff between James and Alex.
  s = ok(s, { type: 'election/vote', candidateId: james }, alex, ctxf);
  s = ok(s, { type: 'election/vote', candidateId: james }, tom, ctxf);
  s = ok(s, { type: 'election/vote', candidateId: alex }, james, ctxf);
  s = ok(s, { type: 'election/vote', candidateId: alex }, nina, ctxf);

  assert.equal(s.election.resolvedAt, null);
  assert.equal(s.election.ballot, 2);
  assert.deepEqual([...s.election.candidates].sort(), [alex, james].sort());
  assert.deepEqual(s.election.votes, {}, 'votes are cleared for the new ballot');
  assert.equal(s.election.lastBallot.counts[james], 2);

  // Second ballot: James takes it 3-1.
  s = ok(s, { type: 'election/vote', candidateId: james }, alex, ctxf);
  s = ok(s, { type: 'election/vote', candidateId: james }, tom, ctxf);
  s = ok(s, { type: 'election/vote', candidateId: james }, nina, ctxf);
  s = ok(s, { type: 'election/vote', candidateId: alex }, james, ctxf);

  assert.equal(s.masterId, james);
  assert.equal(s.election.reason, 'majority');
});

test('two eligible voters resolve rather than tie forever', () => {
  const { state, ctxf } = startedGame(['Seb', 'James', 'Alex']);
  const [seb, james, alex] = state.players.map((p) => p.id);
  let s = ok(state, { type: 'conn/set', playerId: seb, connected: false }, null, ctxf);
  s = ok(s, { type: 'election/start' }, null, ctxf);

  s = ok(s, { type: 'election/vote', candidateId: alex }, james, ctxf);
  s = ok(s, { type: 'election/vote', candidateId: james }, alex, ctxf);
  assert.equal(s.election.ballot, 2, 'a runoff opens first');

  s = ok(s, { type: 'election/vote', candidateId: alex }, james, ctxf);
  s = ok(s, { type: 'election/vote', candidateId: james }, alex, ctxf);
  assert.ok(s.election.resolvedAt, 'the unchanged runoff resolves on seniority');
  assert.equal(s.election.reason, 'tiebreak');
  assert.equal(s.masterId, james, 'James joined before Alex');
});

test('an election that times out is settled from the votes cast', () => {
  const { state, ctxf } = startedGame(['Seb', 'James', 'Alex', 'Tom']);
  const [seb, james, alex] = state.players.map((p) => p.id);
  let s = ok(state, { type: 'conn/set', playerId: seb, connected: false }, null, ctxf);
  s = ok(s, { type: 'election/start' }, null, ctxf);
  s = ok(s, { type: 'election/vote', candidateId: james }, alex, ctxf);

  s = ok(s, { type: 'election/resolve' }, null, ctxf);
  assert.equal(s.masterId, james);
  assert.ok(s.election.resolvedAt);
});

test('a Master back before any vote is cast keeps the crown', () => {
  const { state, ctxf } = startedGame(['Seb', 'James', 'Alex']);
  const seb = state.masterId;
  let s = ok(state, { type: 'conn/set', playerId: seb, connected: false }, null, ctxf);
  s = ok(s, { type: 'election/start' }, null, ctxf);
  assert.ok(s.election);

  s = ok(s, { type: 'conn/set', playerId: seb, connected: true }, null, ctxf);
  assert.equal(s.election, null, 'the vote is called off');
  assert.equal(s.masterId, seb);
});

test('once a vote is cast the election stands even if the Master returns', () => {
  const { state, ctxf } = startedGame(['Seb', 'James', 'Alex']);
  const [seb, james, alex] = state.players.map((p) => p.id);
  let s = ok(state, { type: 'conn/set', playerId: seb, connected: false }, null, ctxf);
  s = ok(s, { type: 'election/start' }, null, ctxf);
  s = ok(s, { type: 'election/vote', candidateId: james }, alex, ctxf);
  s = ok(s, { type: 'conn/set', playerId: seb, connected: true }, null, ctxf);
  assert.ok(s.election, 'the vote continues');
  assert.equal(s.election.resolvedAt, null);
});

test('a Master lost after results are entered does not disturb the round', () => {
  const { state, ctxf } = startedGame(['Seb', 'James', 'Alex']);
  const [seb, james, alex] = state.players.map((p) => p.id);
  let s = state;
  for (const [id, value] of [[seb, 1], [james, 1], [alex, 1]]) {
    s = ok(s, { type: 'bid/submit', playerId: id, value }, id, ctxf);
  }
  s = ok(s, { type: 'results/submit', tricks: { [seb]: 1, [james]: 1, [alex]: 1 } }, seb, ctxf);
  assert.equal(s.phase, 'summary');

  s = ok(s, { type: 'conn/set', playerId: seb, connected: false }, null, ctxf);
  s = ok(s, { type: 'election/start' }, null, ctxf);
  assert.equal(s.phase, 'summary', 'the round summary survives the election');
  assert.equal(s.rounds[0].scores[seb], 11);

  s = ok(s, { type: 'election/vote', candidateId: james }, alex, ctxf);
  s = ok(s, { type: 'election/vote', candidateId: alex }, james, ctxf);
  s = ok(s, { type: 'election/vote', candidateId: james }, alex, ctxf);
  s = ok(s, { type: 'election/vote', candidateId: alex }, james, ctxf);
  assert.ok(s.masterId === james || s.masterId === alex);

  s = ok(s, { type: 'round/next' }, s.masterId, ctxf);
  assert.equal(s.phase, 'bidding', 'the new Master carries the game on');
  assert.equal(s.rounds.length, 2);
});
