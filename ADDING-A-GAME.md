# Adding a game

The checklist for putting a new game on this app. Written after four reviews of
what adding Silly Head as game two actually cost, so game three does not pay it
again.

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

**1. Silly Head games are silently missing from history, right now.**
`server/store.js:132` reads `record.rounds.length` unguarded. Silly Head's
`historyRecord` (`lib/sillyhead/view.js:195-215`) has no `rounds`, no `winners`
and no `p.total`. It throws, the `catch` at `:136` logs "skipping unreadable
history file", and the game never appears in the list. Any third game with its
own record shape gets the same treatment. Fix: `historySummary(record)` on the
engine.

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

**2. How far to generalise.** One review pushed back on the rest, and the point
stands: a registry field that will only ever hold three values is not obviously
better than three `if`s, and pretending otherwise is how you get a plugin
architecture nobody can read. Suggested split — fix the `'blob'` fallbacks and
the `sw.js` manifest unconditionally; generalise the four `app.js` branches,
because Blob's inlining is the actual defect; treat `soundHint`, `gameRows` and
the help bundle as cheap now and worth converting at the moment they become
three-way.

**3. The CLAUDE.md sentence.** `CLAUDE.md:89-90` — "Adding a game is therefore
one row in `games.js` and nothing else." True about the shelf tile, false about
the app. The word doing the damage is **therefore**: it reasons from "the front
page needs nothing" to "the app needs nothing". Narrow it to what it guarantees
and point at this file. Not done yet — it is Seb's house document.

**4. Hand-picked accents.** `public/games.js:33-34` and `:55-56` carry `accent`
and `accentDeep` as hex literals, which is the thing `CLAUDE.md:101-102` forbids.
Either the accent derives from the hue, or the rule is not the rule. Decide
before writing a third row, because a third row is a third exception.
