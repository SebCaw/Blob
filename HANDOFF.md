# Handoff — 26 August 2026

Written so a session with no memory of this one can pick up without asking Seb to
re-explain anything. Everything below is committed and pushed to `main`; the tip
is `a9921ba` and the working tree is clean.

---

## 1. What this project is

`C:\Users\sebca\Projects\Blob` — a Node/SSE multiplayer card-game app for Seb's
family. No dependencies, no build step. One server runs every game through an
engine registry; phones join by a four-digit code or a QR.

Five games are on the shelf and playable: **Blob**, **Silly Head**, **Sevens**,
**Chase the Ace**, **Cheat**. Two are planned: **Go Fish** (next) and
**Solitaire**.

Read `CLAUDE.md` first for the house conventions and the three invariants, then
`ADDING-A-GAME.md`, which is the cheat sheet for adding a game and is kept
current deliberately. Each game has its own rules doc.

Seb deploys to Render himself. **Commit and push to GitHub without asking — he
has given standing permission — but only on a green `npm test`, and never touch
the deploy.**

---

## 2. What was done this session

Twelve commits, `32bc564` through `a9921ba`. The substantial ones:

### Cheat, built from nothing (`444b73d`)

Game five. Also played as Bullshit or I Doubt It. Full rules in `CHEAT.md`.

- `lib/cheat/{deck,rules,game,view,bot}.js` — the engine.
- `public/screens/cheat/{home,lobby,table,over,index}.js` — the screens.
- `public/screens/help-cheat.js` — six steps and eight answers, wired into
  `help.js`'s `lessonFor`.
- Registered in `lib/engines.js`, `public/games.js`, five branch points in
  `public/app.js`, and `public/sw.js`.
- A fixture in `test/privacy.test.js`. It passed first run.

Three things it added that no earlier game needed:

**A clock of its own.** Engines gained an optional `deadline(state, now)`
returning `{key, afterMs, command}`, and `server/room.js` gained a fourth timer
(`_watchDeadline`) beside grace, stall and elections. Cheat uses it for the
four-second challenge window. **Chase the Ace became the second user of it later
the same session**, which is the argument for having made it general.

**An object hidden from every viewer at once.** The face-down pile is absent from
every payload there is, including the one sent to the player who put the top card
on it.

**A measured bot ladder.** See section 4.

### Chase the Ace, four fixes from real play (`f80402b`, `7b3b39e`)

All four came from Seb playing on his phone, not from tests.

- **Binning has a button.** The game blocked you until you threw a pair away and
  then offered exactly one control: SHUFFLE MY HAND, which scrambles the cards
  you are hunting for. Shuffle is now withheld while you hold a pair.
- **The nudge lights the pairs up** after five seconds instead of only counting
  them.
- **An opening pause.** `SETTLE_MS = 12_000` in `lib/chase/game.js`: nobody may
  draw while everybody reads the hand they were dealt. Ends early the moment
  every player still in has cleared their pairs, which on most tables is well
  inside it.
- **A pair now closes a hand in both directions.** You could not draw while
  holding one; now nobody can draw from you either. Needed two knock-ons —
  `stallWatch` grew a second case for a vanished SOURCE, and `advanceAutoPlays`
  now bins for every absent player rather than only the one whose turn it is.

### The screen key, and the bug it caused twice (`7b3b39e`)

`app.js` replays the whole entry animation whenever `screenKey()` changes. Chase
had the lifted card in its key — with a comment claiming that *prevented* the
replay — so binning a pair re-entered the screen every time. Cheat had the same
bug with its open claim and re-entered twice a turn. Seb reported it as the
screen reloading. Both keys are now the phase alone. Verified: zero re-entries
across taking a card, lifting one, and moving it.

### No per-game desktop layouts (`913fced`)

Both new games had grown a desktop layout at 700px and 760px — seats into a
two-up grid, the middle lifted out beside them. Seb, in caps: on a computer it
should be almost like the phone, just with more width. Both removed. Measured at
1194x970 and 375x812 the two are now structurally identical and differ only in
that the column is 700px rather than 375px.

### Cheat clarity (`3daa63d`)

- The claim is now a 60px numeral and a 38px word, not a 24px line under a row of
  card backs. Seb was still working out what had been claimed when the bar ran
  out.
- The window went three seconds to four.
- The per-seat "deciding" indicator is gone, and the field is out of the view
  entirely — three seats changing under your eyes while you read a claim is what
  he was describing as the screen refreshing.
- The call button is on screen the whole time, live or not. Verified across a
  full turn cycle that it never shifts position.

### The Silly Head ladder test (`b702ff9`)

It had been dismissed as flaky for weeks. It was not. It asserted that medium
loses to hard 60% of the time over 200 duels; re-measured over 1200 duels a rung:

| Rung | Lower one loses |
|---|---|
| easy vs medium | 71.3% |
| **medium vs hard** | **53.4%** |
| hard vs impossible | 58.5% |
| medium vs impossible | 60.7% |

53.4% at 200 games clears half by less than one standard deviation, so it failed
about one run in six. It was a true claim about the bots quietly going out of
date. The test now asserts only the rungs wide enough to prove at a sane sample
size and pins the narrow one structurally through the ordering of `SLIP`. Numbers
written into `SILLY-HEAD.md`.

### Documentation

- `CHEAT.md`, `HANDOFF.md` (this file) created.
- `ADDING-A-GAME.md` updated substantially: the `deadline` hook, a new
  **Controls** section with the four things playing it caught, two additions to
  **The glass** (no per-game desktop layouts; bump `CACHE` in `sw.js` for any
  shell change), the Cheat retrospective, the screen-key rule, the hue budget.
- `NEXT-SESSION.md` rewritten. It had drifted into fiction — seven of its twelve
  Silly Head items were already done and it did not say so.
- `CHASE-THE-ACE.md` and `SILLY-HEAD.md` updated with the new rules and numbers.
- `.claude/launch.json` gained a `blob-scratch` entry — port 4200 (the harness
  maps it to 4210) with its own data dir, so a dev run cannot collide with
  `npm test` or sweep `data/live/`. **Use that one, never the default `blob`
  entry.**

---

## 3. Current state

**Everything is working, committed and pushed.** `main` is at `a9921ba`, tree
clean, and Seb was testing on Render at the end of the session.

`npm test` — **293 tests, 0 failures.** Run three times consecutively to confirm.

Two flaky things that are NOT code problems, so nobody wastes time on them:

- `test/server.test.js` occasionally fails teardown with
  `ENOTEMPTY` on a Windows temp directory. It is a cleanup race in the harness.
  Re-run.
- Nothing else. The Silly Head ladder flake described above is fixed.

Nothing is mid-edit. No half-done work.

---

## 4. Decisions made, and why

**Cheat's bot ladder is built on what a level can SEE, not how keen it is.** Two
intuitive versions came out perfectly inverted (easy won 43%, impossible 3%)
because of one fact: **only 19% of claims are lies**, so calling is usually
wrong, and a bot that calls more loses more. Measured tells:

| Signal | Lie rate |
|---|---|
| base rate, any claim | 19% |
| claimer down to two cards, claiming 2+ | **59%** |
| exactly three cards | 47% |
| their last cards, going out | 47% |
| same rank twice running | 37% |
| **four cards** | **15%** — *below* the base rate |

That last row is the counter-intuitive one: a big claim is usually somebody with
a good hand, because nobody makes up a lie that large. Both earlier versions
treated size as the main tell and were anti-correlated with lying. Two signals
were measured and deliberately thrown away (same rank twice, big pile) — they are
recorded in `lib/cheat/bot.js` so nobody adds them back on intuition. Final
standings over 160 games: easy 2% won / 49% spooned, medium 32/20, hard 35/14,
impossible 31/12.

**Cheat ends with two players holding cards, not one.** Heads-up Cheat cannot
terminate — the same rank is always legal, so two players pass one pile back and
forth for ever. Seb spotted this before a line was written. Of the last two,
whoever holds more loses; level and there is no spoon at all.

**Chase the Ace tells the table whose pair it is waiting on.** A deliberate,
bounded leak: it says two of somebody's cards match, never which, a second before
everybody watches them land in the middle anyway. The block is unusable without
the reason.

**Cheat's hue moved from 305 to 30.** Seb said 305 was too close to Blob's 265 to
tell apart on a dim phone, which it was. Moving it also dissolved a problem
recorded as unavoidable: at 305 the accent rule produced green, wrong for a game
about lying. At 30 the complement is blue, so the rule holds and the app gets its
first cool accent.

---

## 5. Open questions and blockers

**One, and it blocks Go Fish entirely.**

Go Fish's rules are settled with Seb bar a single question, written up in the
planned-games section of `ADDING-A-GAME.md`:

> **Is there a pool at all?**
> - **Reading one** — normal Go Fish. Five cards each, the rest face down in the
>   middle, draw one when told to go fish. Seb's "you don't pick anything"
>   applies only once that pool is empty.
> - **Reading two** — no pool. The whole deck dealt out, thirteen each with four
>   players, and "go fish" simply means no and your turn ends.

Reading two is the better game and fits everything else he has said, and it also
dissolves a concern raised earlier about a thirty-two card pool sitting unused.
But it changes the hand size from five to thirteen, so it cannot be assumed.
**Ask, then build.**

Also unanswered but not blocking: Seb was mid-test on Render when the session
ended, so there is no verdict yet on whether Cheat's claim is readable now or
whether Chase's opening pause feels right.

---

## 6. Next steps

1. **Ask Seb the pool question** (section 5). One word settles it.
2. **Wait for his Render verdict** on the Cheat clarity work and the Chase
   opening pause. Both were changed on his report and neither has been confirmed
   from his side.
3. **Build Go Fish** once the pool question is answered. Everything else is
   settled: books of four, must hold the rank you ask for, a hit lets you go
   again, a fished card is never shown so fishing always ends your turn, empty
   hand and you are out, play carries on until all sets are made, three to six
   players, hue 228 with a surf cyan accent `#3dd8ff`. Follow the order of work
   in `ADDING-A-GAME.md`.
4. **The Silly Head list in `NEXT-SESSION.md`** if Go Fish is blocked — five
   genuinely open items, the biggest being three card-travel animations and the
   loser row still being painted in the error colour (which Cheat has inherited
   by reusing `.sh-loser`, so one CSS rule fixes four games).

Not urgent but recorded: Sevens and Chase the Ace and Cheat have no tests of
their own beyond the shared privacy fixture; Solitaire is the seventh game and
there is no obvious hue left for it.

---

## 7. Anything else needed to resume

**Running it.** Never use the default launch entry or `node server.js` bare —
`CLAUDE.md` forbids it, and it collides with `npm test` and sweeps `data/live/`.
Use the preview tool with the `blob-scratch` config, or by hand:

```bash
BLOB_PORT=4200 BLOB_DATA_DIR=/tmp/blob-scratch node server.js
```

**The service worker will lie to you.** `public/sw.js` precaches the whole
client. Any change to a shell file needs `CACHE` bumped or the browser serves the
old one — this cost real time twice in one session, once believing a layout fix
had failed when it had not. It is at `v17`. When verifying in a browser, clear
it:

```js
navigator.serviceWorker.getRegistrations().then(r => r.forEach(x => x.unregister()));
caches.keys().then(k => k.forEach(x => caches.delete(x)));
```

**Heredocs break on this content.** `cat > file <<'EOF'` has failed repeatedly on
JS and markdown in this repo — backticks, `${}`, table pipes. Use the Write tool,
or write a Python patch script to the scratchpad and run it. Both work reliably.

**Seb's preferences.** Open every response with his name. No emojis anywhere,
files or chat. He is token-conscious and has said not to run large test sweeps
without reason — but the privacy fixture is not optional, and measuring a bot
ladder is cheap and has twice been the only thing that caught an inverted one.

**How he works.** He plays a real game and reports what felt wrong, usually in
one line and often mid-turn. Almost every bug this session came that way and none
of them would have been caught by a test. Take the report seriously even when the
mechanism he describes is not the actual cause — "the screen reloads when I throw
a pair away" was a precise description of a screen-key bug he had no way to name.
