# Leavers, and the Master coming back

Two questions Seb asked. One turns out to be a real bug in three of the six
games; the other turns out to be a rule he wants changed rather than a bug.

Findings only. Nothing in `lib/` or `server/` was changed.

---

## Question one: somebody leaves mid-game

> "whenever somebody leaves the game they get taken over by a bot, or their cards
> go somewhere - we will decide what happens then"

### What happens today

There are two different things and they behave differently.

**Disconnecting** — a phone locks, wifi drops. Handled well already: the seat is
marked away, a grace window runs, and after it the Master can cover them
(`conn/takeover`). Coming back restores the seat. Nothing is lost.

**Leaving** — tapping Leave game, which is `player/remove`. This is the one with
the problem, and what happens to the cards is decided **per engine**:

| Game | Where the leaver's hand goes | Code |
| --- | --- | --- |
| Go Fish | Back into the pool | `lib/gofish/game.js:403` |
| Cheat | Onto the pile | `lib/cheat/game.js:417` |
| Blob | Nowhere — leaving is only allowed between hands | `lib/game.js:340` |
| Silly Head | **Deleted** | `lib/sillyhead/game.js:370` |
| Sevens | **Deleted** | `lib/sevens/game.js:318` |
| Chase the Ace | **Deleted** | `lib/chase/game.js:382` |

Three games conserve the cards. Three delete them.

### What that costs, measured

The soak harness was pointed at exactly this: play a game, have one real player
walk out partway through, and see whether the bots left behind can still finish.

| Game | Result |
| --- | --- |
| Cheat | 200 games, no failures |
| Go Fish | 200 games, no failures |
| Silly Head | **50 deadlocks** |
| Chase the Ace | **146 of 200 never finished** |
| Sevens | **250 of 250 never finished** |

The split is exactly the table above. The games that keep the cards are fine. The
games that delete them break.

Blob is absent because it refuses the walkout at all — "players can only be
removed before the game starts, or between hands" — which is its own answer to
the question and a perfectly good one.

### Why Sevens fails every single time

Traced one game end to end rather than inferring it:

- 52 cards in hands before the leave, **39 after — 13 cards deleted**
- the game then played 3,000 more moves, of which **2,974 were passes**
- it was still in `playing`, with three players holding 5, 6 and 2 cards

Sevens is built out from the sevens in each suit. Delete thirteen cards and the
layout has holes that can never be filled, so every card above a hole is
unplayable for ever. Nobody can go out, so nobody can win. Everyone sits there
passing until they give up and close the tab.

**This is not rare and it is not subtle.** One person leaving a game of Sevens
ends it for everybody, permanently, with no message explaining why.

### The options

**A. A bot inherits the seat and the hand.** What Seb suggested first.

- Fixes all three broken games, because no cards move at all.
- The machinery mostly exists — bots already play seats, and `awaitingTakeover`
  already covers a disconnected player.
- Keeps the game the shape it was: same number of players, same cards in play.
- Against it: somebody who has left is still "in" the game and can win it, which
  is odd, and their name sits on the table. Solvable by renaming the seat.

**B. The hand goes back where the game can use it.** What Go Fish and Cheat
already do.

- Also fixes it, and is proven — those two are the ones that pass.
- Cheaper: three small changes, each mirroring code that already exists next door.
- Against it: needs a sensible destination per game, and Sevens has no pool or
  pile to put cards into. For Sevens the honest version is "play the cards into
  the layout automatically", which is more than a small change.

**C. Refuse to let people leave mid-game**, as Blob does.

- Simplest and safest, and already precedent in this codebase.
- Against it: people will close the tab anyway, and then it is a disconnect,
  which is handled. So this mostly renames the problem rather than solving it.

### Recommendation

**A, a bot inherits the seat**, for three reasons.

1. It is the only one that works the same way in all six games. B needs a
   different answer per game and has no good answer for Sevens.
2. It reuses the takeover path that already exists for disconnects, so leaving
   and vanishing stop being two different stories.
3. It cannot break card conservation, because nothing moves. Every failure above
   comes from cards ceasing to exist.

The seat should probably be renamed — "Ada (bot)" or similar — so nobody thinks
a person who walked out is still playing.

---

## Question two: the Master coming back

> "whenever the master rejoins they get their privileges back even if a new
> master has taken over"

### What happens today

**In Blob only**, at `lib/game.js:705`:

> A Master who comes back before anyone has voted keeps the crown: a 45-second
> phone blip shouldn't cost them the game. Once a vote is cast the election
> stands, and per the rules they do not get it back.

So Blob already does half of this, and the other half is a deliberate decision
written into the code rather than an oversight.

**In the other five games it does not happen at all.** Go Fish's `conn/set`
(`lib/gofish/game.js:629`) restores the connection, clears the takeover and the
auto-play, and never looks at `state.election`. Silly Head, Sevens, Chase and
Cheat are the same. A Master whose phone blips for a moment loses the crown in
five games out of six even if they come straight back and nobody has voted.

That inconsistency looks like a plain bug, and it is the cheapest thing on this
page to fix: copy Blob's four lines into the other five.

### What Seb asked for is a rule change

Getting the crown back **even after a new Master has taken over** reverses the
existing decision. That is his call to make, but it is worth knowing what it
costs:

- Somebody was made Master by a vote, has been acting as Master — covering
  absent players, moving rounds on — and then silently stops being Master when
  the original walks back in. Nobody is told.
- There is no split-brain risk in the data: `masterId` is one field, so only one
  person can hold it. The problem is social, not technical.
- The awkward case is a returning Master arriving mid-vote with some votes cast.

If he wants it, the least surprising version is: the returning Master is **offered
it back** and the current Master is told, rather than it silently changing hands.

### Recommendation

Two separate pieces of work, and only the first is uncontroversial:

1. **Copy Blob's unvoted-election rule into the other five engines.** Restores
   consistency, is clearly a bug, small and safe.
2. **Reclaim after a resolved election** — do it only if Seb still wants it after
   reading the above, and do it as an offer rather than a silent swap.

---

## What would need testing

For the leaver work, whichever option is chosen:

- Every game, every table size, one player leaves at various points, and the game
  still reaches `complete`. The harness does this now with `--leaver`, and it is
  the test that would have caught this.
- Cards are conserved across a leave: count before, count after.
- The leaver was the player on turn; the leaver was the player being asked (Go
  Fish); the leaver was mid-claim (Cheat); the leaver held the ace (Chase).
- The last human leaves a table of bots.
- The leaver was the Master.

For the Master work:

- Master drops and returns with no votes cast: keeps it, in all six games.
- Master drops and returns with votes cast but unresolved.
- Master drops, election resolves, original returns.
- Two people cannot both believe they are Master at any point.
