# Handoff — build Go Fish

Written for a session starting cold. Read this top to bottom before touching
anything; it is ordered so you can act from the first section.

Repo: `C:\Users\sebca\Projects\Blob`. Everything is committed and pushed to
`main`, tip `c828fdf`, working tree clean, `npm test` green at **293 passing**.

---

## 0. ASK THIS FIRST — it blocks everything

Go Fish's rules are settled with Seb bar one question, and the two answers are
different games. **Do not start until he answers.**

> **Is there a pool at all?**
>
> **Reading one** — normal Go Fish. Five cards each (seven if two or three
> players), the rest face down in the middle. Told to go fish, you draw one from
> it. Seb's rule "if they say go fish you don't pick anything" then applies only
> once that pool is empty.
>
> **Reading two** — no pool. The whole deck is dealt out, thirteen each with four
> players, and "go fish" simply means *no, and your turn ends*. Nothing is ever
> drawn.

Reading two looks right. Seb said "if they say go fish you dont pick anything"
against the drawing rule rather than against the pool question, which he had
already answered separately. It is also the better game — every card is in
somebody's hand, so all thirteen books can always be made, and it becomes pure
memory with no luck of the draw. It dissolves a problem raised earlier about a
thirty-two card pool sitting unused when a player goes out.

But it changes hand size from five to thirteen, so it cannot be assumed. One word
from Seb settles it.

---

## 1. Go Fish, as settled

Confirmed with him line by line. Also written into the planned-games section of
`ADDING-A-GAME.md`.

- Standard deck, **jokers out**. Three to six players, one deck.
- You collect **books of four**. Most books wins.
- On your turn you ask **one named player for one named rank**, and **you must
  already hold at least one card of that rank**. This is the rule the whole game
  hangs on.
- **They have some** → they hand over **all** of them, and **you go again**.
- **They haven't** → go fish.
- **You never show a card you fished.** Seb was explicit: "no matter what."
- **Therefore fishing always ends your turn.** If you went again after a lucky
  draw, everyone would know you got what you asked for — the two rules cannot
  both stand. Confirm this reading with him if you like, but it is forced.
- **Empty your hand and you are out**, keeping any books already laid down.
- Play **carries on until all sets are made**.

**What makes it a game:** asking is a public act about a private hand. Say "any
sevens?" and the whole table learns you hold a seven. Every question is
information you give away to get information back. The app must broadcast every
ask and every answer to everybody and remember them — and that is also the bot
ladder: the easy one forgets what was asked, the top one remembers every question
anyone has asked all game.

**Colour: hue 228, deep ocean, accent `#3dd8ff` (surf cyan), deep `#149fd7`.**
Seb picked it from a rendered comparison of three sea blues. It **breaks the
app's accent rule deliberately** — normally the accent is the complement of the
hue at S100 L62. Every blue ground produces a *warm* complement, and the warm end
of the shelf is full (Blob lime, Silly Head amber, Sevens orange). Sevens is also
already a blue at 205, which is why Go Fish had to go deep to 228. Document the
departure the way `CHEAT.md` documents its own colour reasoning.

**Two things to settle as you build:**

- **Does handing cards over happen automatically?** When asked for your sevens
  you have no choice, so instinct says the app just does it and animates it. But
  that exact call was got wrong in Chase the Ace — pairs were auto-binned on the
  same reasoning and Seb made it manual, because the *doing* is the game. Here
  the act is being *asked*, not the handing over, so automatic is probably right.
  Ask him.
- **The history record.** "Who asked whom for what" is the whole game and none of
  the existing record shapes carry it. See `historyRecord`/`historySummary`.

**No clock anywhere.** Unlike Cheat, nothing here is time-critical, so no window
and no countdown. Do not reach for the `deadline` hook.

---

## 2. What the app is

A Node/SSE multiplayer card-game app for Seb's family. **No dependencies, no
build step.** One server runs every game through an engine registry; phones join
by a four-digit code or a QR.

Five games are built and playable: **Blob**, **Silly Head**, **Sevens**, **Chase
the Ace**, **Cheat**. Go Fish is sixth; **Solitaire** is planned seventh.

**Read in this order:**

1. `CLAUDE.md` — house conventions and the three invariants. Non-negotiable.
2. `ADDING-A-GAME.md` — the cheat sheet. Kept deliberately current; it has the
   order of work, the engine contract, two browser checkpoints, the privacy
   section, the bots section, the glass section, and a Controls section of things
   that only came out of Seb playing.
3. `CHEAT.md` — the most recent worked example, built in one session. Its
   structure is a good model for `GO-FISH.md`.

**The three invariants**, from `CLAUDE.md`:

1. `lib/` is pure — `now`, `newId` and all randomness arrive through `ctx`.
2. `viewFor` is the privacy boundary. A value a player may not see is **absent
   from the payload**, not merely undrawn. Keys omitted, never nulled.
3. The client draws what the server says. Anything deciding legality is
   server-side; when the client needs a rule, the server puts it in the view.

---

## 3. What you have to touch to add a game

**Server** — `lib/engines.js` registers one entry supplying `createGame`,
`applyCommand`, `findPlayer`, `viewFor`, `historyRecord`, `historySummary`,
`stallWatch`, `bots`, and optionally `deadline(state, now)` (Go Fish will not
need that last one).

**Engine files** — `lib/gofish/{deck,rules,game,view,bot}.js`, mirroring
`lib/cheat/`.

**Client** — `public/games.js` (the shelf tile: id, name, tagline, blurb,
players, hue, accent, accentDeep, icon, ready), `public/screens/gofish/{home,
lobby,table,over,index}.js`, `public/screens/help-gofish.js` wired into
`help.js`'s `lessonFor`, and **five branch points in `public/app.js`** — the
import, `createGoFish`/`playGoFishSolo`, the `net.on('state')` handler, the
welcome branch, the screen branch and the screen-key branch. Plus `public/sw.js`.

**A fixture in `test/privacy.test.js` is not optional.** That test walks
`ENGINES` and **fails by name** for any game without one. It exists so a new game
cannot ship without a privacy check. Cheat's passed first run because it was
written before the game.

---

## 4. Traps that cost real time in the last session

**The service worker will lie to you.** `public/sw.js` precaches the whole
client, so any change to a shell file needs `CACHE` bumped or the browser serves
the old one. This cost time twice in one session — once believing a layout fix
had failed when the CSS was stale, once telling Seb something was live that his
phone could not see. It is at **v18**. When verifying in a browser, clear it:

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

**Heredocs break on this content.** `cat > file <<'EOF'` failed repeatedly on JS
and markdown — backticks, `${}`, table pipes. Use the Write tool, or write a
Python patch script to the scratchpad and run it. Both work.

**The screen key.** `app.js` replays the whole entry animation whenever
`screenKey()` changes, so a key names **where you are, not what you are doing
there** — phase, essentially always. Putting a selection or an open window in it
makes the screen re-enter on every tap. That bug shipped in two games with
comments confidently claiming the opposite, and Seb reported it as the screen
reloading.

**A big screen is a phone with more room, not a different app.** `.screen` is a
560px column widening to 620 then 700. Do not give a game its own desktop layout;
both new games grew one and both had to lose it. But **do** use the vertical space
on a tall window — see the note at `.ch-play` in `styles.css` for the one case
where growing the body is right and the one where centring is.

**Re-measure after a reload when testing sizes.** The app pins its height at
load, so resizing the viewport gives stale numbers until you navigate again. This
produced two false readings before it was spotted.

---

## 5. Bots — the one lesson worth carrying over

Cheat's ladder was built on intuition **twice** and came out perfectly inverted
both times (easy won 43%, impossible 3%). Nothing looked wrong; the games all
played fine. Only measuring caught it.

The cause was one fact: **only 19% of claims were lies**, so calling was usually
wrong, and a bot that called more lost more. Measured tells:

| Signal | Lie rate |
|---|---|
| base rate, any claim | 19% |
| claimer down to two cards, claiming 2+ | **59%** |
| exactly three cards | 47% |
| their last cards, going out | 47% |
| same rank twice running | 37% |
| **four cards** | **15%** — *below* the base rate |

Two signals were measured and deliberately discarded; they are recorded in
`lib/cheat/bot.js` so nobody adds them back on intuition.

**So: if a game has a judgement call in it, measure the ladder before believing
it.** A 160-game script is twenty lines and it is the only thing that tells you
whether "impossible" means anything. Silly Head's ladder test was also dismissed
as flaky for weeks and turned out to be reporting a real drift — its middle rung
had narrowed to 53.4%, barely a coin toss.

For Go Fish the ladder is obvious and easy: **memory**. Easy forgets what was
asked, medium remembers the last round, hard remembers everything asked, and the
top one also tracks what it has given away. All of it from the public log, never
from anybody's hand.

---

## 6. How Seb works

- **Open every response with his name.** No emojis anywhere, files or chat.
- **Commit and push to GitHub without asking** — standing permission — but only
  on a green `npm test`. **Never touch the Render deploy**; he does that himself.
- He is token-conscious; do not run large sweeps without reason. The privacy
  fixture and a bot-ladder measurement are both worth it.
- **He plays a real game and reports what felt wrong, usually in one line, often
  mid-turn.** Almost every bug in the last session came that way and none would
  have been caught by a test. Take the report seriously even when the mechanism
  he names is not the actual cause — "the screen reloads when I throw a pair
  away" was a precise description of a screen-key bug he had no way to name.
- He answers rules questions tersely and in order. Number your questions.

---

## 7. State of everything else

Nothing is half-done. Recently finished and awaiting his verdict on Render: the
Cheat clarity work (bigger claim, four-second window, call button always
present), Chase the Ace's opening pause, and the vertical-space fix for Cheat.

**Known and not worth chasing:** `test/server.test.js` occasionally fails
teardown with `ENOTEMPTY` on a Windows temp directory — a cleanup race in the
harness. Re-run.

**`NEXT-SESSION.md`** holds five genuinely open Silly Head items if Go Fish is
blocked. The biggest are three card-travel animations and the loser row still
being painted in the error colour — which Cheat and the others have inherited by
reusing `.sh-loser`, so one CSS rule fixes four games.

**Solitaire has no hue left.** The warm end of the shelf is full and both blues
are taken. Worth solving before it starts.
