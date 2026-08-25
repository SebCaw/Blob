# Adding a game

The checklist for putting a new game on this app. Written from four reviews of
what adding Silly Head as game two cost, then corrected against what adding
Sevens as game three actually cost — see "What building Sevens actually cost",
which is the part written from scars rather than from reading.

Read `CLAUDE.md` for the house conventions first. This file is the ordered work,
the traps, and the decisions that are still open.

**Keep it current.** If you find something this file got wrong, or you settle one
of the open decisions, edit it in the same commit as the work. A checklist that
has drifted is worse than none.

---

## The one-line summary

Adding a game is **not** one row in `games.js`. It is a row there, a row in
`lib/engines.js`, a rules module, a view module, a screen folder, and roughly a
dozen shared files that still branch on a game id. `CLAUDE.md:89-90` says
otherwise; that sentence is true about the **shelf tile** and false about
everything else.

---

## The planned games

Seb is thinking about **Sevens, Cheat, Go Fish, Solitaire and Chase the Ace**.
House rules for each still to come; do not start a reducer before they arrive.

**This is five more games, not one, and that settles most of the open questions
below.** At two games a hardcoded `if` is cheaper than a registry field. At seven
it is not: the dozen branch points listed further down become roughly forty,
spread across files whose owners have no reason to think about a new game. Do the
generalisation first and add games into it, rather than adding five games and
generalising afterwards.

What each one demands that the platform does not already do:

- **Sevens** (Fan Tan, Domino) — **BUILT and on the shelf.** Rules and screen
  design in `SEVENS.md`. It was the right one to go first: no hidden state beyond
  hands, so it exercised the whole path — room, join, turn order, SSE, reconnect —
  while putting the lightest possible load on the privacy boundary. The reducer
  took an afternoon; every real problem was on the glass, which is the ratio to
  expect. Still has **no tests of its own**.
- **Cheat** (Bullshit, I Doubt It) — the hardest test of invariant 2 in the repo.
  A claim is public and the card is not, so the reducer must know the truth while
  every view withholds it, and a challenge reveals it retrospectively. If the
  cross-engine privacy harness exists before this one is written, it will catch
  the mistakes; if it does not, this is the game that leaks.
- **Go Fish** — asking a named player for a named rank is a public request about
  private information, and the answer changes what everyone knows. Watch the
  history record: "who asked whom for what" is the whole game and none of the
  existing record shapes carry it.
- **Solitaire** — **single player, and two variants under one tile: traditional
  (Klondike) and around the clock (Clock Patience).** See the section below; it
  is the odd one out and needs its own treatment.
- **Chase the Ace** — **BUILT and on the shelf. See `CHASE-THE-ACE.md`.** Note the name:
  the house calls it this, but it is the game usually published as **Old Maid**,
  with an odd ace rather than an odd queen. This entry previously described
  Ranter-Go-Round — pass or keep, lives lost — which is a different game and would
  have been built by mistake. Two things it needs that nothing here has yet: hand
  ORDER as authoritative server state rather than presentation, because
  rearranging your fan is the game; and a command that acts on somebody else's
  hand, which every existing command avoids. Elimination mid-game is also new —
  check it against the Master election and the grace windows rather than
  assuming.

### Solitaire, which is the odd one out

Single player, and **two variants under one shelf tile**: traditional (Klondike)
and around the clock (Clock Patience).

**Two variants, one engine, one tile.** The precedent already exists and works —
Silly Head's `quick` is a variant flag set at create time and changeable in the
lobby (`lib/sillyhead/game.js:71`, `:83`, `:394`). Klondike and Clock are that
same shape, not two shelf rows. Note Klondike then has a *second* variant axis on
top, draw-one versus draw-three, so whatever carries the flag should not assume
one boolean.

**What it does not need:** no opponent, so nothing to broadcast; no bots; no
Master election worth holding; no `stallWatch`. The lobby is a screen with one
name on it and a Start button, so consider going straight from the tile to the
deal — meaning the lobby slot work must tolerate a game with **no lobby at all**,
not merely different options.

**What it forces:** `minPlayers` as engine data. VERIFIED hardcoded at
`lib/game.js:38` and `lib/sillyhead/game.js:43`, refusing to start below two, and
published to the client at `lib/view.js:114`. This was already on the
missing-from-the-server-registry list; Solitaire promotes it from tidy-up to
blocking.

**The privacy boundary is already solved, and it still matters.** Face-down cards
must be absent from the only player's own payload, which sounds odd for a game
with one viewer but is exactly the existing case — see the test at
`test/sillyhead.test.js:644`, "your own face-down cards are absent from your own
payload". That test is the pattern to copy for the stock and the tableau.

This is also the argument for keeping Solitaire **server-side** rather than
running it locally, which will be tempting since nothing needs broadcasting: if
the deck lives in the browser, the face-down boundary is a lie and anyone can read
the deal out of the payload or memory. Invariant 2 decides this, not convenience.

**Clock Patience has no decisions in it at all.** Deal thirteen piles of four,
turn the top of the centre pile, place it under the pile of its rank, turn that
pile's next card, repeat until the fourth king appears. Every step is forced. The
player never chooses anything, and the outcome is fixed by the shuffle before the
first card turns (it comes out around one in thirteen). Three consequences, and
they invert the usual effort split:

- The reducer is nearly nothing — one `next` command, or an autoplay tick. Do not
  budget reducer time for it.
- **All of the value is on the glass.** For every other game the tests protect the
  rules and the browser protects the presentation; here there are barely any rules
  to protect. The animation *is* the game. Weight the work accordingly.
- **Do not compute the whole sequence at deal time and send it.** It is the
  obvious implementation, since the outcome is already determined, but the payload
  would then contain the ending and the player could read their own result out of
  it before it plays. Reveal card by card, same as any other hidden state.

**Klondike is the largest state shape of the five** — stock, waste, four
foundations, seven tableau piles — though the rules are simple. It is also the
only game on the list where **players expect undo**, and nothing in the platform
supports it today. Pure reducers over a command list make it feasible, but decide
the mechanism deliberately rather than discovering the expectation late.

**Build order: after at least one multiplayer game, not first.** Solitaire
exercises almost none of the machinery that breaks — no broadcast, no second
phone, no turn order, no reconnect-mid-turn — so it will not shake out the
platform work the way Sevens or Cheat will.

### The hue budget

Every game gets its own colour, and the colour is a hue. That is a **finite
budget**, which nobody has had to think about at two games.

`public/styles.css:19-32` derives eight tokens from `--hue` — five night grounds
at 9-31% lightness and 53-65% saturation, plus three ink steps. Two consequences:

- Hues roughly in the **60-110 band go muddy** at those lightness values. A dark
  ground there reads as olive or brown rather than as a colour, and brown is
  already spoken for by `.board-row--spoon`. That takes about fifty degrees of the
  wheel out of play.
- With that band excluded, **seven or eight games is the practical ceiling** at a
  spacing anybody can tell apart. Blob has 265 and Silly Head has 148. Assign the
  remaining five from the usable arc deliberately and in one pass, rather than
  picking each one as its game is written — picked one at a time, the fourth and
  fifth will collide with something.

---

## Order of work

Do these in order. The browser checkpoints are not optional and not at the end.

**0. The rules on paper.** A markdown file in the repo the way `SILLY-HEAD.md`
exists, before any code. Every ambiguity found here is an hour not spent
unpicking a reducer. Seb supplies these.

**1. `lib/<game>/game.js`** — state shape, `createGame`, and the two or three
commands that make a hand progress. Pure: `now` and `newId` come through `ctx`,
never `Date.now()` or `Math.random()`. Tests as you go, driving whole hands
through `applyCommand`. This is the one stretch where a green run means
something.

**2. `lib/<game>/view.js` and its privacy test, together, before any screen
exists.** Not after. Retrofitting redaction once screens exist is exactly how a
secret ends up in a payload that a screen merely declines to draw.

**3. Register it.** An entry in `lib/engines.js`, a row in `public/games.js` with
`ready: false`, and a screen that renders `JSON.stringify(view)` and nothing
else.

**4. BROWSER CHECKPOINT ONE — the lobby.** Before a single playing screen exists.
See the checklist below. The lobby is the first screen with real content of
unknown length and the only one that proves session, theme, routing and
reconnect at once. If any of it is wrong here, every screen built afterwards sits
on the fault and you find out at the end. That is how both existing games
produced their lists.

**5. One playing screen, one legal move.**

**6. BROWSER CHECKPOINT TWO — one turn landing on a second phone**, at all three
size settings, in a narrow window, console open. Nothing gets built on top until
this passes.

**7. Then, in order:** bots, `stallWatch`, history record and summary, help,
sound hint, settings rows, animation.

**8. Flip `ready: true` last.** That is the switch that puts it in front of
people.

### The minimum that counts as playable

An engine entry with `createGame`, `applyCommand`, `findPlayer`, `viewFor`; a
`games.js` row; two screens. Create a room, join it from a second origin, take
one legal turn, watch it land on both screens over SSE.

**Bots are not in the minimum** — `bots` may be null (`lib/engines.js:32`,
guarded at `server/room.js:283`). Neither are history, help, sound, settings rows
or animation.

---

## Browser checkpoint one — the lobby

Two **origins**, not two tabs: `localhost:4100` and `127.0.0.1:4100` are two
players, because the session lives in `localStorage`.

- [ ] Shelf tile appears in its own hue. Front page otherwise untouched.
- [ ] Create from the tile, land in the lobby.
- [ ] Second origin joins by code and appears in the player list.
- [ ] **Read the other player's raw SSE frame with your own eyes** and look for
      their cards. The test asserts this; this catches the test asserting the
      wrong field name.
- [ ] Reload mid-lobby: resumes into the game, not the front page. The shelf
      paints first, then the colours go on (`public/app.js:415-425`).
- [ ] A long name and a two-digit count do not overflow the player row.
- [ ] Settings opens and closes from the lobby.
- [ ] All three size settings, at 393x852.

## Browser checkpoint two — the first playing screen

- [ ] Fits without scrolling at all three sizes.
- [ ] No card runs to the edge of the phone.
- [ ] The entry animation does **not** replay when somebody else moves. If it
      does, `screenKey` is wrong.
- [ ] A measured layout survives a text-size change.
- [ ] Nothing overlaps when a name is long.
- [ ] One bot moves once, with a visible pause. This exercises
      `owing` / `at` / `move` end to end, and an `at` key that never changes
      shows up here immediately.

Note for agents: `requestAnimationFrame` and CSS animations do not run in a
hidden tab, and every fitter is scheduled that way. A browser surface that keeps
the page hidden cannot verify any of the above.

---

## What a game must supply

### Server — `lib/engines.js` (documented at `:24-32`)

`id`, `name`, `createGame`, `applyCommand`, `findPlayer`, `viewFor`,
`historyRecord`, `stallWatch`, `bots` (nullable).

**Missing today and worth adding with game three**, because each is currently a
hardcoded `if` somewhere it does not belong:

- hand-size rules, or a `validateCreate(body)`. This is what `server/http.js:128`
  is doing by hand, and it is the HTTP layer knowing a game's rules.
- min and max players as data. `games.js` carries `players: '2 to 8'` as
  **prose**, unenforceable, while the real number lives inside the reducer. One
  fact in two places with nothing keeping them agreed. Silly Head already shows
  the fix: publish `state.minPlayers` into the view, and the client needs no rule
  of its own (`public/screens/sillyhead/lobby.js:22`).
- which lobby options the game takes. `http.js` accepts `handSize` and `mode`
  from every game and each engine quietly ignores what it does not want.
- `historySummary(record)` — see the verified bugs below.
- "the secrets in this state, by owner" — a function the room never calls and
  only the cross-engine privacy test uses. See Privacy below.

### Client — `public/games.js`

`id`, `name`, `tagline`, `blurb`, `players`, `hue`, `accent`, `accentDeep`,
`icon`, `ready`.

**Missing today**, all currently expressed as `if`s in shared files: the
phase-to-screen map, the welcome screen, the state-arrival handler, the
screen-key shape, the help lesson bundle, the sound hint, the settings rows, and
a history row renderer.

### Why two registries and not one

Not preference. `lib/engines.js` is CommonJS behind `require`; `public/games.js`
is an ES module the browser imports; there is **no build step**. Merging means
shipping reducers to the phone or icons to Node.

There is a second reason worth holding onto: the client is cached by a service
worker and can be months out of date, while the server is the only thing that can
refuse a command. **Anything deciding legality lives server-side.** When the
client needs to know a rule, the server puts it in the view.

Bind the two with a test asserting the id sets match. One assertion, and it turns
"added the tile, forgot the engine" from a runtime mystery into a red test.

---

## The branch points a third game hits

`public/app.js` at **426** (state arrival), **600** (welcome), **603** and
**609-614** (phase to screen), **631** (screenKey); `public/net.js:89` and
**:326**; `public/screens/shelf.js:59`; `server/http.js:128`;
`public/screens/help.js:229`; `public/screens/settings.js:33` and **:115**;
`public/sw.js:38-44`.

**The asymmetry underneath all of it.** Silly Head is already done correctly — it
delegates to its own `screens/sillyhead/index.js`, which owns its phase map. Blob
is not: its phase map is inlined in the shared shell at `app.js:609-614` and its
state handler is the fall-through body. The shell treats Blob as the default and
Silly Head as the exception, when they are peers.

So the fix is **not to add a third branch at each point — it is to make Blob a
delegate like Silly Head, at which point those four branches disappear rather
than becoming three-way.** This is the highest-value change available and it is
invisible to any grep for `'sillyhead'`, because the cost is Blob's inlining, not
Silly Head's branch.

**The `'blob'` fallbacks are wrong now**, independent of game three. They mean
"unknown", spelled as a real game id, so anything unknown silently inherits
Blob's identity. `lib/engines.js:223` `engineById` has the same fault — it
returns `BLOB` for an unrecognised id rather than refusing. `net.js:326` is the
one defensible case (a session written before the shelf had no `game` field) and
should be named as the migration fallback it is, not spelled `'blob'`.

**Leave alone:** `help.js:166` `words: ['blob', ...]` is Blob's scoring
vocabulary, a word players say for zero. `help.js:338` and `:354` `from: 'blob'`
is the chat speaker. Neither is a game id.

---

## The shared screens

**`common.js`** — genuinely agnostic, and the model to copy. Takes state and
options, branches on shape, never on game id. New shared furniture goes here.
Caveat: `leaderboard()` (`:492`) and `roundPips()` (`:410`) are Blob-only members
that nothing marks as such, so a third game may reach for one and find it almost
works.

**`shelf.js`** — agnostic apart from the `'blob'` fallback at `:59`. Fix the
fallback and it is clean. This is the one screen CLAUDE.md's claim is true about.

**`help.js`** — a bundle registry pretending to be a conditional. The content is
already split into `help-sillyhead.js`; only the selection at `:229` is an `if`.
**Registry field** pointing at the bundle. Cheapest fix on the list. Consider a
lazy import so a third game's help is not in every phone's bundle.

**`settings.js`** — agnostic shell, two holes, and they want different
mechanisms. `soundHint` (`:33`) is a **field**: one string per game, with a true
generic default already written at `:35`. `gameRows` (`:115`) is a **slot** — it
returns interactive rows carrying handlers and prefs, and no field can express
that.

**`history.js`** — not agnostic. It renders `game.rounds` (`:59`) and `p.total`
(`:63-65`), both Blob concepts, plus the server-side break listed under verified
bugs. Needs **both halves**: the engine supplies `historySummary(record)` so the
server can build a row without knowing Blob's shape, and the client registry
supplies the row renderer. It has to be both because the summary is made
server-side and the drawing is client-side.

**`lobby.js`** — not agnostic, and already forked: `sillyhead/lobby.js` is a
deliberate copy whose own comment says the furniture should stay identical. Two
lobbies will be three. Most of it genuinely is shared — code card, QR, player
list, start button — and what differs is the middle. **A slot**, not a field. Do
this before game three, or you will be reconciling three copies.

**`summary.js` and `complete.js`** — **Blob's screens, misfiled as shared.**
Silly Head uses `sillyhead/over.js` instead, and that is the correct outcome
rather than a failure: an end-of-round score summary is a Blob concept. A third
game should not be pushed into them. Consider moving them to `screens/blob/` so
the names stop implying they are a platform surface.

---

## Phases

**Middle phases are private to the game.** All four reviews agree. Nothing in a
shared file may name `bidding`, `sort`, `reveal`, `summary` or `playing`.

What the shared layer legitimately needs is a **lifecycle**, not a vocabulary:
can somebody still join, has it started, is it finished. Only these files ask,
and today they ask by string comparison:

- `server/http.js:191-192` — joinable, started
- `server/room.js:239-241` — write the history record
- `server/rooms.js:45`, `:126`, `:239` — TTL, restore, rematch
- `public/screens/common.js:373` — topbar, back button, settings
- `public/screens/lobby.js:174`

**This is load-bearing.** A game whose end phase is not spelled `complete` never
expires, never writes a history record, and shows as joinable forever.

Breaking the rule today: `app.js:609-614` (Blob's phase map in the shared router)
is the structural one, and `app.js:426` and `:631` are the same break on the
state-arrival and key paths — one fix covers all three. `mascot.js:129-136`,
`common.js:373` and `lobby.js:174` are cosmetic: wrong face, wrong back button.

Phase strings inside `lib/engines.js` (`:53`, `:79`, `:139`, `:165`) are fine —
that is the game's own registry entry, which is where such a string belongs.

See open decision 1 for how the lifecycle should be expressed.

---

## Privacy — the part to do first

The recipe:

1. **Redaction lives in `lib/<game>/view.js`, and each secret is read through
   exactly one accessor.** Blob's is `handFor`. One reader per secret means one
   place to audit.
2. **Build the payload by naming what a viewer may see.** Construct the seat
   object field by field. Never copy state and delete from it — the next field
   somebody adds would be public by default.
3. **Omit keys, never set them to `null`** (`CLAUDE.md:45-47`), so a secret
   cannot arrive as an empty-looking field that a later change quietly fills.
4. **Test at the SSE layer, against the serialised frame** — `stream.last.text`,
   not a return value. A unit test inspects an object; a player receives a
   string, and the two can differ via a `toJSON`, a later merge in `broadcast`,
   or a debug field.
5. **Assert two things**: the secret's identifiers are absent, *and* its public
   counterpart is present (`cardsHeld`, `downLeft`). The second half is what
   stops a "fix" that deletes the field and breaks the game.
6. **Three viewers**: the owner, another player, and the seatless spectator.

**Allowlist, not denylist.** `test/server.test.js:900-908` takes the secrets it
knows about and checks those strings are absent — it passes forever while a newly
added secret sails through, because it was never told that field exists.
`test/sillyhead-server.test.js:219-232` is the correct form: build the set of
everything this phone may legitimately know, regex every card-shaped token out of
the frame, and fail on anything outside the set. That catches the secrets nobody
thought of, which is the only kind that matters.

**Two mistakes that pass while the payload leaks:**

- Asserting on the object. `assert.equal(view.players[1].hand, undefined)` passes
  happily while the same cards sit in `up`, in `lastEvent`, or in a history
  record.
- Building the needle from the **view** instead of from **state**. The cards are
  already gone from the view, so the needle is empty and `includes` is vacuously
  true. Pin the deal, and take the needle from `state`.

**VERIFIED: no test iterates `ENGINES`.** The identifier does not appear anywhere
in `test/`. Every privacy assertion is written per game against that game's own
fixtures. **A third game leaks silently until somebody remembers to write its
equivalent, and nothing goes red to remind them.**

This is the single strongest thing to put in the first commit: one test that
walks every registered engine, plays a game, and applies the allowlist assertion
— with a game that supplies **no manifest failing the suite** rather than
passing. That inverts the default from "untested unless somebody remembers" to
"must be declared", and it is the difference between an invariant and a habit.

---

## Bots

**The `at` rule, stated so it needs no copying:** `at` is a fingerprint of the
**decision**, not of the state. Build it from exactly the inputs that would
change the answer, and from nothing else — never a clock, a connection count, a
version number or the player list.

The test while writing it: *if two consecutive broadcasts would lead the same
brain to the same move, `at` must be byte-identical; if it now has a different
move to make, `at` must differ.* Or, put another way: write `at` from the game
state a human would look at to make the same decision. If a player could not tell
two positions apart, neither should the key.

Two shapes, covering both existing games and any third:

- **Turn-based moment** — key on position in the game. Blob: `engines.js:76` and
  `:84`. Silly Head play: `:175`.
- **Everybody-at-once moment** — there is no position, so key on **that bot's own
  private material**. Silly Head sort: `:168-170`.

**The failure modes are asymmetric and the dangerous one is silent.**
`server/room.js:298` returns early when the key is unchanged, and clears and
re-arms when it changes. A key that **churns** therefore cancels and restarts the
timer on every broadcast, so **the bot never moves at all** — no error, no log, a
table that just sits there. A key that is too **coarse** is the loud one, caught
by the guard at `room.js:339-343`.

**The fallback:** a brain that throws must degrade to a **legal move derivable
from `view.you` alone** — never null, never a rethrow, and never a command the
reducer will refuse, since a refusal strands the table exactly as a throw would.
Blob: `engines.js:125`. Silly Head: `:202-206`, walking down to the move that is
always available.

**Why the fallback lives in `engines.js` and not in the brain**, in order of
weight:

1. The brain is the component that just failed, and a `catch` has to be outside
   what it is catching.
2. A frozen table is a promise the **room** makes to the other players, not a
   game-playing concern. `engines.js` is where a room-level obligation meets a
   game-specific answer.
3. `lib/` is pure and cannot log. The `console.error` calls at `engines.js:106`,
   `:198` and `:206` are the only way anybody finds out a brain is broken.

There is a structural reason it cannot be pushed further out either: `lib/bot.js`
sees only the redacted view, so it cannot always work out a legal move — but the
view carries `you.playable`, which the **call site** can read without knowing
anything about the game.

---

## The glass

**Every push rebuilds the screen.** Compare an explicit **key** held in module
scope. Never diff renders, and never compute "something changed" from the DOM.
Gate on the key **plus a time window** — one action renders three times (the tap,
the state landing, the request settling), so a single one-shot flag is wiped
before it paints. Correct: `app.js:625-635` `screenKey` with `ENTER_MS` at
`:637-643`, and `LAND_MS` in `sillyhead/table.js`. Related: never put an entry
animation on `.screen` in CSS — `styles.css:172-175` records what that cost.

**Zoom.** Measurement is in screen pixels; transforms inside the zoomed subtree
are in its own. **Divide by `uiZoom()`** before writing any measured length back.
Correct: `common.js:118-130`, `bidding.js:77`, `sillyhead/table.js:98`. `uiZoom`
measures a known 100px probe rather than the app against itself — a bug that
already happened and returned 2.1 for a zoom of 1.4.

**Fixed versus scrolling.** Four classes, and the question is *does this screen
have a control that must be reachable*. `styles.css:181` `.screen--fixed` never
scrolls; `:186` `html[data-size] .screen--fixed` is the escape hatch, written for
Blob's bid pad, where an unreachable Submit is worse than a screen that moves;
`:197` `.screen--fits` opts back out of the hatch for a screen that shrinks its
own contents; `:204` `.screen--spill` is the last resort, set by `fitCards` when
even the smallest cards will not fit. **Default to `screen--scroll`.** A screen
with a button that must be pressed takes the hatch; a surface you look at adds
`screen--fits` and calls `fitCards`. Do not leave it undeclared.

**Cards, fans, seats.** Never shrink a card to make things fit — tighten the fan
first, then split, then spill. Measure after paint; never predict. Use the shared
fitters: `common.js:96` `fitFan`, `:155` `splitHand`, `:198` `fitCards`, `:281`
`allowSpill`. The order matters and is written down at
`sillyhead/table.js:150-163` — all of it inside one `requestAnimationFrame` after
the screen is in the DOM. Bespoke fitters already exist four times over; check
before writing a fifth.

Two traps inside fitting that have both bitten: **clear your own last answer
before measuring**, or the fit reads its own output and creeps tighter every
render; and **do not ask `scrollHeight`** whether a positioned layout fits — seats
lean out of the ring by design and it counts them (`common.js:213-215`).

**Sticky results.** The fit result must be sticky per screen, window and size
(`common.js:293-311`), or a status line growing by one line resizes every card on
the screen. Reserve the line instead: `styles.css:3679`.

**Safe areas.** `env(safe-area-inset-*)` **added to** the design value, never
instead of it (`styles.css:165-166`, and `:480` / `:522` for pinned overlays).
The padding is for the screen and the gutter is for the cards — two different
numbers. `HAND_GUTTER` at `common.js:114` is the second one.

**Three sizes.** One knob, `--ui-zoom`. Never enlarge a few font sizes by hand —
that gives big text in boxes built for small text, which is worse than either.
Check every screen at all three, **largest first**, because that is where things
fall off. `--app-h` must be pinned by `pinViewport()` and consumed at
`styles.css:182`, because `100dvh` inside a zoomed subtree is not the viewport.

**Hidden tabs.** `requestAnimationFrame` does not fire in a hidden tab and every
fitter is scheduled that way (`bidding.js:42`, `playing.js:167`,
`sillyhead/sort.js:200`, `sillyhead/table.js:158`). Nothing load-bearing may sit
behind one.

---

## Verified bugs a third game inherits

**1. ~~Silly Head games are silently missing from history.~~ FIXED while
building Sevens (`954275c`).** `server/store.js` read `record.rounds.length` and
`players[].total` off every record — Blob's shape. It threw on a Silly Head
record, the `catch` logged "unreadable history file", and the game never
appeared in the list. The store now asks the engine for its own line through a
new `historySummary(record)`, so a game that cannot be read thinly still lists
rather than vanishing. **That is the first thing added to the engine contract by
a game other than Blob**, and the shape to copy: only the game knows its record.

**2. No cross-engine privacy test.** See Privacy above. This is the one to fix
first.

**3. `engineById` returns `BLOB` for an unknown id** (`lib/engines.js:223`)
instead of refusing, so a typo in a game id silently plays Blob.

**4. `public/sw.js:38-44` lists every screen by hand.** A third game's screens
are missing from the precache and nobody finds out until a phone goes offline.
There is no build step, so the practical fix is a test asserting every file under
`public/` appears in `SHELL` — the list stays hand-written, but forgetting one
fails the suite instead of silently shipping an uncacheable module.

---

## What building Sevens actually cost

Written after the fact, from the things that bit. Everything above was theory
until a third game went in; this is the part that was wrong or missing.

**The prediction in "How far to generalise" came true, and I did the thing it
warned against.** Sevens went in as a third set of `if`s — four more in
`public/app.js` (state arrival, welcome, screen, screen key), one in
`settings.js`, five hand-written lines in `sw.js`. The branch count went UP. It
works and it shipped, but game four now pays for it as well, and the honest
label for that is debt rather than a decision. Generalising the four `app.js`
branches is still the highest-value change available and it is still not done.

**Work out the biggest hand your game can deal, before you draw one.** Sevens
deals the whole deck, so three players is eighteen cards each. Blob tops out
around thirteen and Silly Head at nine, so nothing in the shared code had ever
had to cope, and the fan was written as a single row. Eighteen cards cannot be
fanned into one row on a phone at any spacing that still shows the corner you
read a card by. `splitHand` (`common.js:155`) exists for exactly this and was
sitting there unused. Use nine to a row rather than its default eleven if the
fan is also rotated — a tilted card's box is wider than the card.

**A game's stacking order must not be able to reach the app's.** Column slots
were numbered around 40, which is `.sheet` — so opening settings mid-game left
three columns of cards painted on top of the panel. Give any game-local
stacking its own context with `isolation: isolate` and keep the numbers small.
`position: relative` alone does NOT create one, which is the part that is easy
to assume.

**Do not carry over a UI convention without checking the numbers behind it.**
Blob and Silly Head dim what you cannot play, and it reads well there because
most of a hand usually is playable. In Sevens two or three legal cards out of
fifteen is an ordinary turn, so the same rule greyed out almost the whole hand
and made it unreadable. The general form: a convention is a judgement about a
distribution, and a new game changes the distribution.

**Every control must answer, including the ones that do nothing.** Removing that
dim took away the only signal separating a live card from an inert one, so
eleven identical-looking cards gave nothing back when pressed. It was reported —
reasonably — as a broken hitbox, and cost a wrong diagnosis and a browser
session to disprove. An inert control that looks live is a bug report waiting to
happen. Say why: an unplayable card now names what its suit is waiting for.

**Gate on measurement, not on which setting somebody picked.** Blob's scrolling
hatch keyed on `html[data-size]`, i.e. on a guess that a bigger text size is the
only way a screen overruns. At the default size a long forehead round clipped
its own top with no way to reach it. Measure after paint and set `screen--spill`
from what you find. And never put a second scroller inside a screen that does
not scroll — the half in the scroller moves, the half outside it freezes.

**Pick `--fixed` against `--fits` by asking whether there is a control to
reach.** Sevens has a Pass button and I gave it `--fits` anyway, which would
have made that button unreachable at the largest text size. The rule is already
written in `styles.css`; read it rather than copying whichever screen you had
open.

**A cap sized for a phone breaks a desktop.** Capping the one element that grows
stopped the hand being pushed off a small screen and left the whole table in the
top half of a large window. Put the cap behind the media query it was written
for.

**Anything that flies should live outside the zoomed subtree.** The flying card
is `position: fixed` on `document.body` on purpose: coordinates and size are
then both plain screen pixels and there is no `uiZoom()` to divide back out.
Staying in one coordinate space is cheaper than converting between two.

**Check whether your game needs its own rank order.** `lib/deck.js` puts the ace
high, because that is what a trick and a pile need. Sevens builds down to the
ace, so it keeps its own. Borrowing the shared one would have made the upward
run thirteen long and the downward run five, and nothing would have complained.

**Verifying in a browser, two traps.** `requestAnimationFrame` does not fire in
a hidden tab, so no fitter has run and any overflow you measure is a phantom —
call the fit pass by hand first, then measure. And `getBoundingClientRect` on a
rotated card returns its axis-aligned box, so probe the thing you actually mean:
for "can I press the rank", take the rank element's own rect.

**Never start the dev server on the default port or data directory.** `CLAUDE.md`
says this and I did it anyway: it collided with `npm test` (a clean suite
reported a failure) and swept `data/live/`. Use `BLOB_PORT=4200
BLOB_DATA_DIR=/tmp/blob-scratch`. Note `.claude/launch.json` points at the
defaults, so `preview_start` by name walks straight into it — open a browser at
the scratch URL instead.

## Open decisions

Settle these before or during game three, and record the answer here.

**1. How the lifecycle is expressed.** Everyone agrees the middle phases are
private. Two readings of the rest:

- `lobby` and `complete` are **required literal strings** every game must use,
  and the shared layer keeps comparing them.
- Phases are **entirely private** and the shared layer asks the engine —
  `isLobby(state)` / `isOver(state)`, or fields on the state.

The second is cleaner and survives a game with an unusual shape. The first is
free.

**2. How far to generalise. — SETTLED: all of it, and before the next game.**

One review argued that a registry field holding three values is not obviously
better than three `if`s, and that pretending otherwise is how you get a plugin
architecture nobody can read. That was correct at the time it was written, when
the question was a third game.

It is now five more (see The planned games). Every branch point below becomes a
seven-way switch, and `soundHint`, `gameRows` and the help bundle stop being
cheap at the third one. Generalise first, then add games into the seam.

**3. The CLAUDE.md sentence.** `CLAUDE.md:89-90` — "Adding a game is therefore
one row in `games.js` and nothing else." True about the shelf tile, false about
the app. The word doing the damage is **therefore**: it reasons from "the front
page needs nothing" to "the app needs nothing". Narrow it to what it guarantees
and point at this file. Not done yet — it is Seb's house document.

**4. Hand-picked accents. — SETTLED in principle: derive them.**

`public/games.js:33-34` and `:55-56` carry `accent` and `accentDeep` as hex
literals, which is the thing `CLAUDE.md:101-102` forbids. At two games that is two
exceptions and arguable. At seven it is seven, hand-tuned against seven grounds,
and the rule has stopped being a rule.

So the accent derives from the hue, and the two existing pairs get replaced by
whatever the derivation produces. **Check the result on a real screen before
committing to it** — Blob's `#c8ff3d` and Silly Head's `#ffd23d` are the accents
everything else was contrast-checked against, and a derived value that reads
worse on a dim phone is not an improvement. If the derivation cannot match them,
that is a finding worth writing here rather than quietly keeping the literals.

**The derivation, found by measuring the three that exist rather than invented:**
every accent in this app is exactly `S100 L62` and every deep is `S83 L46`. On
hue, Sevens' accent is the EXACT complement of its ground, Blob's is eight
degrees off, and Silly Head is the only real outlier at seventy-eight — amber on
green, where the true complement is pink and would have been loud. So the rule is
**accent = complement of the hue at S100 L62; deep = the same hue at S83 L46**,
departed from only when the complement is genuinely unpleasant.

Two of the three games already obey a rule nobody had written down, which is why
this reads as recording a convention rather than imposing one. It also means new
games can follow it without repainting Blob and Silly Head — worth avoiding,
since those accents are what every other colour in the app was contrast-checked
against.

**The hues, placed as a set** so the last ones do not get whatever is left:
Blob 265, Silly Head 148, Sevens 205, Chase the Ace 345, Go Fish 176 (a sea
game), Cheat 305, Solitaire 20. The three cool ones at 148/176/205 are the
tightest cluster and the pair most likely to need separating once seen.
