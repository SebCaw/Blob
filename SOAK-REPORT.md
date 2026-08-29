# Soak report

Run on 29 August 2026, on `c69c3b8`, with `tools/soak.js`.

## What was run

24,157 games, every engine, every table size the engine allows, bot levels mixed
across easy, medium, hard and impossible. 400 seconds.

| Engine | Games |
| --- | --- |
| Blob | 4,998 |
| Silly Head | 4,998 |
| Sevens | 4,165 |
| Chase the Ace | 3,332 |
| Cheat | 3,332 |
| Go Fish | 3,332 |

**No failures.** Not one game out of 24,157 stalled, threw, refused a bot command
twice in the same position, or failed to reach `complete`.

## Is that claim worth anything?

It is worth exactly as much as the games being different from each other, so that
was checked rather than assumed. Three seeds of the same engine and table size
finished in 132, 126 and 122 commands; replaying the first seed gave 132 again.
The games vary and they replay, which is what the report needs to mean anything.

## Table sizes an engine does not offer

Limits, not failures. Recorded because a soak that silently skipped them would
look like it had covered more than it had.

- Sevens, Cheat, Go Fish: at least 3 players
- Chase the Ace: at least 4 players
- Cheat: at most 7
- Go Fish: at most 6

## What this does NOT cover

Worth stating plainly, because a clean report invites more confidence than it has
earned.

- **The server.** The harness drives the reducers directly. Presence, grace
  windows, elections, the command queue and the bot timers are all `server/`, and
  none of them ran. `test/bot-refusal.test.js` is the one test that exercises a
  bot and a room together.
- **Anything a person does.** Every seat is a bot playing legally. Nobody
  disconnects, nobody leaves, nobody taps two things at once. That gap is where
  the leaver findings below came from, and it is the gap most likely to hide
  something else.
- **Card conservation.** No invariant checks that cards are neither duplicated
  nor lost during normal play. It would be a good thing to add and it is not
  here, because a wrong invariant produces confident nonsense and each of the six
  games conserves cards differently.
- **Blob cannot finish on its own.** It stops on the scoreboard between hands and
  waits for the Master, so the harness taps "next round" for it. That is a fact
  about the game, not a bug, but it means Blob's runs had one human step
  simulated. See `NUDGES` in the harness, which is deliberately kept short.

## Then a second run, with somebody walking out

The first run was every seat playing to the end. The second had one real player
leave partway through — Seb had asked what should happen in that case. This is
where the findings are, and they are in `LEAVERS-AND-MASTER.md`.

Short version: **three of the six games broke permanently when somebody left
mid-game.** Sevens failed 250 times out of 250.

That is fixed. A bot now inherits the seat and the hand rather than the hand
being deleted, and the same runs come back clean. Re-run afterwards with 9,657
games of ordinary play to check nothing else moved: no failures.
