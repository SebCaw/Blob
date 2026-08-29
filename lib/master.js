'use strict';

/**
 * The Master coming back.
 *
 * Two things were wrong before this, and only one of them was a rule.
 *
 * **The bug.** Blob gave the crown back to a Master who reconnected before
 * anybody had voted - a 45-second phone blip should not cost you the game - and
 * the other five engines never looked at the election at all. So in five games
 * out of six a Master whose signal dipped lost the job even if they were back
 * two seconds later and nobody had touched a button. That was an oversight
 * rather than a decision, and this is the fix: one copy of the rule, used by all
 * six.
 *
 * **The rule.** Blob's version stopped at the first vote: once somebody had
 * voted the election stood, and a returning Master did not get it back. Seb
 * asked for the opposite - "whenever the master rejoins they get their
 * privileges back even if a new master has taken over" - and that is what this
 * does now. It is his game and his call; what follows is what the change costs,
 * written down so it is not a surprise later.
 *
 * Somebody may have been voted Master, acted as Master for several minutes, and
 * then stop being Master the moment the original walks back in. There is no
 * split-brain risk in the data - `masterId` is a single field, so exactly one
 * person holds it - but there is a social one, which is why the handover is
 * written to the log rather than done silently.
 */

/**
 * Give the crown back to a returning Master, and tidy up any vote about them.
 *
 * Safe to call on ANY reconnecting player: it does nothing unless this person
 * was the Master who went missing.
 *
 * @param {object} state mutated
 * @param {object} player the player who has just reconnected
 * @returns {null | {kind: 'master-back', playerId: string, fromId: string|null}}
 *   what changed hands, for the caller to write down, or null if nothing did.
 */
function reclaimMaster(state, player) {
  if (!state || !player) return null;

  const election = state.election;
  const openAboutThem = election && !election.resolvedAt && election.forPlayerId === player.id;

  // A vote that was about them and has not finished is simply dropped. Nobody
  // needs to choose a stand-in for somebody who is standing right here.
  if (openAboutThem) state.election = null;

  // They never lost it - an unresolved election had not changed anything yet.
  if (state.masterId === player.id) return null;

  // A vote about somebody ELSE is a different question and is left alone. This
  // only ever hands back a crown that was taken because THIS player vanished.
  const wasAboutThem = election && election.forPlayerId === player.id;
  if (!openAboutThem && !wasAboutThem) return null;

  const fromId = state.masterId || null;
  state.masterId = player.id;
  return { kind: 'master-back', playerId: player.id, fromId };
}

module.exports = { reclaimMaster };
