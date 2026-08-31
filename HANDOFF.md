# Handoff

Written for a session starting cold. Read it top to bottom before touching
anything; it is ordered so you can act from the first section.

Repo: `C:\Users\sebca\Projects\Blob`. `npm test` green at **423 passing**.

**One thing is not on `main`.** The seventh game, Kings Corner, is finished and
pushed to the branch `kings-corner` — both halves, both browser checkpoints
passed, tile live on the shelf. It is on a branch rather than `main` because Seb
had not played it yet at the point the session ended. Merging it is a merge and
nothing else; there is no unfinished work in it.

Live at `https://blob-nm9h.onrender.com` on Render's free tier, which sleeps when
nobody is playing and forgets every game it was running when it does. That is the
tier, not a bug to fix in code.

---

## 0. There is nothing blocked

No unfinished work in the tree, no question waiting on Seb, nothing half-built.
If you have arrived with a task, go and do it. What follows is context.

Two things sit with Seb rather than with you:

- **`BLOB_ALERT_EMAIL` and `BLOB_ALERT_KEY` are not set in Render**, so client
  error reports reach the log and nothing emails him. The code is written and
  tested; it stays off until both are set, and half-configured counts as off. See
  "Hearing about errors" in `CLAUDE.md`.
- **Paid hosting.** Settled twice. Keeping a computer switched on does not help —
  a free instance sleeps on inbound traffic and restarts regardless — and the
  electricity costs about what the paid tier does.

---

## 1. What the app is

A Node/SSE multiplayer card-game app for Seb's family. **No dependencies, no
build step.** One server runs every game through an engine registry; phones join
by a four-digit code, a shared link, or a QR code they now scan inside the app.

Seven games are built and playable: **Blob**, **Silly Head**, **Sevens**, **Chase
the Ace**, **Cheat**, **Go Fish**, **Kings Corner**. Solitaire was going to be the
seventh and is **on hold, possibly for good** — Seb's reservation is that the
world is already full of Solitaire, and it is the only game on the list with no
group in it.

The hue budget did not run out: Kings Corner took 178, a teal, with a coral
accent. See `ADDING-A-GAME.md` for the one thing about that accent worth looking
at on a real screen.

**Read in this order:**

1. `CLAUDE.md` — house conventions and the three invariants. Non-negotiable.
2. `ADDING-A-GAME.md` — the cheat sheet, kept deliberately current. Order of
   work, the engine contract, two browser checkpoints, privacy, bots, the glass,
   and a Controls section of things that only came out of Seb playing.
3. The per-game file for whatever you are touching (`SILLY-HEAD.md`, `SEVENS.md`,
   `CHASE-THE-ACE.md`, `CHEAT.md`, `GO-FISH.md`).

**The three invariants**, from `CLAUDE.md`:

1. `lib/` is pure — `now`, `newId` and all randomness arrive through `ctx`.
2. `viewFor` is the privacy boundary. A value a player may not see is **absent
   from the payload**, not merely undrawn. Keys omitted, never nulled.
3. The client draws what the server says. Anything deciding legality is
   server-side; when the client needs a rule, the server puts it in the view.

---

## 2. What changed most recently

### Kings Corner — the seventh game, on the `kings-corner` branch

Rules in `KINGS-CORNER.md`, settled with Seb before any code. Two things in it
have no precedent here: **a turn is a chain** of moves ended by an explicit
`play/endTurn` rather than being one card, and `play/movePile` is **the first
command that touches nobody's hand**. A turn cannot go round for ever for a
structural reason rather than a careful one — a pile may only land on another
pile, so every pile move reduces the number of occupied slots by one.

**Its bot ladder could not be established, and that is written down rather than
papered over.** Only `easy` is separated. Four heuristics were built and thrown
away for making the bots measurably WORSE, and both obvious ways to measure a
ladder turned out to be invalid instruments — heads-up is won by whoever leads
100% of the time, and a uniform field can be free-ridden. The sharpest finding
generalises past this game: **counting the deck here is worth less than nothing**,
because what it informs is a shared resource, so acting on it helps everybody at
the table equally. `lib/kingscorner/bot.js` and `ADDING-A-GAME.md` carry the
detail.

Five bugs came out of the browser and none would have failed a test. The two
worth knowing before touching any state handler: a crash inside one looks
**exactly** like a broken SSE push (a typo threw before `state = next`, and the
second phone sat on the lobby through a whole dealt game while every push
arrived perfectly — read the console on the phone that is behaving oddly, not on
the one you are driving); and `arrived(next)` is part of the handler contract
that nothing enforces, so leaving it out strands anybody arriving by shared link.


### QR reading — `public/qr-read.js`, `public/scan.js`

The app had shown a QR code in every lobby for months and had no way of reading
one. Using the phone's own camera app opens the link in the **browser**, which
for an installed app is not the installed app — you land in a second copy of Blob
looking at your own game from outside, with a different session. No web API lets
a link jump into an installed app, so the only way to stay inside is to scan
inside.

`BarcodeDetector` is used where it exists. **It does not exist on iOS**, which is
where this app is played, so a scanner built only on it would not work for the
person who asked for one. Hence a hand-written reader — versions 1–10, all four
correction levels, numeric, alphanumeric and byte modes.

It is two halves that fail differently, and the file says so at the top. The
arithmetic — format info, unmasking, de-interleaving, Reed–Solomon, the bitstream
— is right or obviously wrong, and `test/qr-read.test.js` checks it against
everything the encoder can produce, including codes damaged past saving. Turning
a photograph into a grid is a guess and is treated as one: the scanner runs it
ten times a second and a failed frame costs nothing.

**Three bugs in the front half, all found by measurement, each looking like
something else. Know them before touching that code:**

1. **Per-block thresholds fragment the image.** Cutting each 8×8 square at its own
   midpoint is wrong when the squares line up with the code's modules, which at
   ordinary distances they do — a square inside a dark module has its midpoint
   dragged down, the light square next door has its dragged up, and every module
   boundary grows a one-pixel stripe of the wrong colour. The binary image comes
   out as an **outline drawing** and the finder scan reads a code whose modules
   are one pixel across. Thresholds are smoothed over a 5×5 block neighbourhood.
2. **An alignment pattern is five runs, not three.** Read as dark-light-dark it
   matches twice, once either side, and lands a module out both times. Three runs
   are also not distinctive enough to survive a widened search — the false
   positive is usually **nearer the guess** than the real pattern is.
3. **The alignment search must use the module size at that corner**, extrapolated
   from the three finders, not the average across the code. Perspective is the
   entire reason that search exists, so assuming even modules assumes the problem
   away: at a steep angle the centre module came out half as big again, the ratio
   check called it too fat to be one module, and the search returned nothing on
   exactly the codes that needed it most.

The code size is also not rounded and trusted — the nearest valid dimension is
tried, then the ones either side, because at a steep angle the count comes out a
module or two over. A wrong guess cannot produce a wrong answer: the format
information and the Reed–Solomon check both have to pass. About 10ms a frame.

### The code box on the front page — `screens/shelf.js`

"Got a code?" with a four-digit field, a camera button and Join, above the tiles.
Somebody handed a code did not come to browse; the only way in before was to guess
which of six tiles the code belonged to, open it, find Join, and type it there.
**It does not need to know which game the code is for.** The server does.

### Silly Head — your go, on your cards

The status line always said "Your go" at the top of the screen, which is not where
anybody is looking. A gold ring now sits on the block your own cards live in for
exactly as long as the game is waiting on you. `outline` and `box-shadow`, never
padding — `fitCards` measures that block after paint, and a turn that changed its
height would resize every card on the table each time it came round.

### Go Fish — a star on what you just picked up

A hand kept in rank order means a new card files itself between two you already
had and the hand simply looks one longer. Worked out **on the client**, by
comparing consecutive hands, and it has to be: the server cannot say which card
came out of the pool without leaking the one genuinely private thing in that game.
The three cases that must come out as "nothing is new" — the deal, a reconnect,
and a hand that only shrank — are written up in `ADDING-A-GAME.md`; each was a bug.

### The install offer is a card, not a strip

Seb's words were that it "looks like cookies", which was exactly right: one line
of small grey text, a button and a cross is the shape everybody has trained
themselves to dismiss unread. Now a card with the mascot, a heading, a sentence
and a full-width button, with "Not now" in words instead of a ✕. Still not modal,
still only at the end of a game.

---

## 3. The shelf height budget — spent, and then set aside

**The seventh tile arrived and the prediction below was exactly right**: in one
column at the largest text setting it ended at **937px against an 812px
viewport**.

**And the answer is that the shelf scrolls.** A two-column grid was built and
shipped first; Seb asked for scrolling instead, which is his call and it is the
front page. So there is now no special rule at all — `.shelf` is already
`screen--scroll`, one column at every size, icons and full names intact, and you
scroll to reach the games that do not fit.

**An eighth tile therefore costs nothing.** The budget below is kept because the
arithmetic is still why the front page is watched, but it has stopped being a
wall. Before reaching for columns again, read what they cost in
`ADDING-A-GAME.md`: three silent failures in a row, all to avoid a scroll nobody
had objected to.

## 3a. The original budget — read before adding an eighth game

`html[data-size='huge']` in `styles.css` exists because the largest text setting
multiplies everything by 1.4, and six tiles plus a code box do not fit a phone.

Measured on a 375×812 viewport: **the sixth tile ends at 801px.** Eleven pixels of
headroom for the whole screen. Getting there cost the taglines, the shelf heading,
the "Got a code?" label, and tightened padding on both the tiles and the code
field. The code box alone had pushed the last tile from 798 to 954.

**A seventh tile is about another 112px and will not fit.** No amount of spacing
recovers it. Plan for a scrolling list or a two-column grid at that size, and
**measure it** — the failure is silent, happens at one text setting only, and
shows up as somebody never discovering half the games.

The code field also clips silently when it is set too wide for the row it shares
with two buttons: six digits at the Large setting needed 166px in a 128px box,
with the leading digits scrolled off the left and no visual sign of it. Test with
`482716`, not `4827`.

---

## 4. Traps that have cost real time

**The service worker will lie to you.** `public/sw.js` precaches the whole client,
so any change to a shell file needs `CACHE` bumped **and** new modules added to
`SHELL`, or the browser serves the old one. It is at **v58**. This has cost hours
across several sessions — once believing a layout fix had failed when the CSS was
stale, once telling Seb something was live that his phone could not see. It is
completely convincing while it is happening. To clear it when verifying:

```js
navigator.serviceWorker.getRegistrations().then(r => r.forEach(x => x.unregister()));
caches.keys().then(k => k.forEach(x => caches.delete(x)));
```

**Never run the dev server on the default port or data dir.** `CLAUDE.md` forbids
it; it collides with `npm test` and sweeps `data/live/`. Use the `blob-scratch`
entry in `.claude/launch.json`, or by hand:

```bash
BLOB_PORT=4200 BLOB_DATA_DIR=/tmp/blob-scratch node server.js
```

**Heredocs break on this content.** `cat > file <<'EOF'` fails on JS and markdown
— backticks, `${}`, table pipes. PowerShell here-strings mangle commit messages
outright; write the message to a scratchpad file and use `git commit -F`. For
multi-file edits, write a Python patch script and run it.

**`requestAnimationFrame` does not fire while the preview pane is hidden.** Any
browser measurement that waits on a frame will simply time out. Force a reflow
with `void el.offsetHeight` and measure synchronously instead.

**Zoom.** Measurement is in screen pixels; anything inside `#app` is inside a
`zoom`. Divide by `uiZoom()` before writing a measured length back. `uiZoom`
measures a known 100px probe rather than the app against itself — a bug that
already happened and returned 2.1 for a zoom of 1.4.

**Re-measure after a reload when testing sizes.** The app pins its height at load,
so resizing the viewport gives stale numbers until you navigate again. This has
produced false readings more than once.

**The screen key.** `app.js` replays the whole entry animation whenever
`screenKey()` changes, so a key names **where you are, not what you are doing
there** — phase, essentially always. Putting a selection or an open window in it
makes the screen re-enter on every tap. That shipped in two games with comments
confidently claiming the opposite, and Seb reported it as the screen reloading.

**A big screen is a phone with more room, not a different app.** `.screen` is a
560px column widening to 620 then 700. Do not give a game its own desktop layout;
two games grew one and both had to lose it.

**Known and not worth chasing:** `test/server.test.js` occasionally fails teardown
with `ENOTEMPTY` on a Windows temp directory — a cleanup race in the harness.
Re-run.

---

## 5. Bots — the lesson worth carrying to any new game

Cheat's difficulty ladder was built on intuition **twice** and came out perfectly
inverted both times (easy won 43%, impossible 3%). Nothing looked wrong; the games
all played fine. Only measuring caught it. The cause was one fact: only 19% of
claims were lies, so calling was usually wrong, and a bot that called more lost
more. Two signals were measured and deliberately discarded; they are recorded in
`lib/cheat/bot.js` so nobody adds them back on intuition.

**If a game has a judgement call in it, measure the ladder before believing it.**
A 160-game script is twenty lines and it is the only thing that tells you whether
"impossible" means anything. Silly Head's ladder test was dismissed as flaky for
weeks and turned out to be reporting a real drift — its middle rung had narrowed
to 53.4%, barely a coin toss.

**Kings Corner added two more, and they are about method.** First: **check that
your instrument can measure the thing you think it is measuring.** Both obvious
ways to rank bots gave confident wrong answers there - heads-up reported a
perfect 50.0% for every rung while measuring nothing but who went first, and
one-against-three-of-a-kind produced two contradictory results that were both
true, because a uniform field can be free-ridden. Run one policy against itself
first; if that does not come out at baseline, nothing above it means anything.

Second: **the value of information depends on whether the thing it tells you
about is yours.** Counting the deck earns Go Fish its top rung and is worth less
than nothing in Kings Corner, because there the count informs decisions about
eight shared slots and acting on it helps everybody equally.

`tools/soak.js` drives the reducers directly and is the fastest way to hammer a
game without a browser. `SOAK-REPORT.md` records what it found last time.

---

## 6. How Seb works

- **Open every response with his name. No emojis anywhere**, files or chat.
- **Commit and push to GitHub without asking** — standing permission — but only on
  a green `npm test`. **Never touch the Render deploy**; he does that himself.
- He is token-conscious and will say so mid-turn. Do not run large sweeps without
  reason. A privacy fixture and a bot-ladder measurement are both worth it.
- **He plays a real game and reports what felt wrong, usually in one line, often
  mid-turn.** Almost every UI bug in this project arrived that way and almost none
  would have been caught by a test. Take the report seriously even when the
  mechanism he names is not the actual cause — "the screen reloads when I throw a
  pair away" was a precise description of a screen-key bug he had no way to name,
  and "it plays up with the touch pad but a touch screen works perfectly" was the
  only clue that found a transform bug in Go Fish's seats.
- He sometimes dictates, so a sentence occasionally arrives garbled. Ask rather
  than guess, but do the rest of the work first and ask at the end.
- He answers rules questions tersely and in order. Number your questions.

---

## 7. Reports, not queues

`NEXT-SESSION.md`, `SOAK-REPORT.md` and `LEAVERS-AND-MASTER.md` record finished
work, kept because they hold measurements rather than intentions. Nothing in them
is outstanding. `NEXT-SESSION.md` does still list some genuinely open Silly Head
polish — card-travel animations, and the loser row painted in the error colour,
which four games have inherited by reusing `.sh-loser`, so one CSS rule fixes all
of them.
