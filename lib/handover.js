'use strict';

/**
 * Somebody walks out, and a bot sits down in their chair.
 *
 * **The bug this exists for.** Leaving used to delete the leaver's hand. Three
 * of the six games never recovered from that: Sevens builds every suit out from
 * its seven, so thirteen cards ceasing to exist leaves holes nothing can fill,
 * every card above a hole is stranded, and nobody can ever go out. Measured with
 * `tools/soak.js`: Sevens failed 250 games out of 250, Chase the Ace 146 of 200,
 * Silly Head deadlocked 50 times. Go Fish and Cheat survived only because they
 * happened to put the hand back into the pool and the pile rather than binning
 * it. One person leaving ended the game for everybody, silently, with nothing on
 * screen to say why.
 *
 * Handing the seat to a bot is the only answer that works the same way in all
 * six games, because it is the only one where NO CARDS MOVE. Every failure above
 * came from cards ceasing to exist; a seat that carries on holding them cannot
 * cause any of it. It also reuses the idea the app already has for a phone that
 * has gone quiet, so leaving and vanishing stop being two different stories.
 *
 * The seat keeps its name. It is still the hand that person was dealt, and their
 * score is still theirs — `handedOver` is what the screens use to say a bot is
 * playing it now, rather than pretending nothing happened.
 */

/**
 * Turn a seat into a bot in place, keeping everything it is holding.
 *
 * @param {object} state the game state, mutated
 * @param {object} target the player who is leaving, mutated
 * @param {{now: number, newId: (prefix: string) => string}} ctx
 */
function handToBot(state, target, ctx) {
  target.isBot = true;
  target.handedOver = true;
  target.leftAt = ctx.now;
  target.botSeed = ctx.newId('handover');
  target.botLevel = target.botLevel || 'medium';

  // A bot has no phone to drop. Saying it is connected is what stops the stall
  // watch arming behind a seat that is never going to answer, and stops the
  // table showing it as "away" when it is playing perfectly well.
  target.connected = true;
  target.awaitingTakeover = false;
  target.disconnectedAt = null;

  // Deliberately NOT `left`. A left player is skipped by `activePlayers` and by
  // the turn order, which is exactly what must not happen here: the seat is
  // still in the game, still holding cards, and still due a turn.
  if (state.autoPlay) delete state.autoPlay[target.id];
}

module.exports = { handToBot };
