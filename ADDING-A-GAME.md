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
- **Cheat** (Bullshit, I Doubt It) — **BUILT and on the shelf. See `CHEAT.md`.**
  It was the hardest test of invariant 2 in the repo and the prediction held: a
  claim is public and its cards are not, the reducer knows the truth while every
  view withholds it, and a challenge reveals it retrospectively. The privacy
  harness existed first and passed on the first run, which is the whole argument
  for having built it before this game rather than after.

  Three things it added that no earlier game needed. It is the first engine with
  a **clock of its own** (`deadline`, below). It is the first to hide an object
  from EVERY viewer at once rather than redacting per player — the face-down
  pile, its own author included. And its bot ladder had to be **measured**, twice,
  because both intuitive versions came out perfectly inverted; the numbers are in
  `CHEAT.md` and the lesson generalises.
- **Go Fish** — **BUILT and on the shelf. See `GO-FISH.md`.** Asking a named
  player for a named rank is a public request about private information, and the
  prediction held: the whole game is in the log, and the log turned out to be the
  bot ladder as well.

  It is the first engine where **a turn is taken by two people**. An ask sits open
  on the state and the person holding the table up is the TARGET, not whoever's
  turn it is — so `stallWatch` watches two candidates, the way Chase the Ace's
  does, for a sharper reason. It is also the first game with a **forced move that
  is still a tap**: the answer is not a decision, and it is a button anyway,
  because resolving it on the server the instant it is asked deletes the one
  second the game is made of.

  Its privacy boundary is the **shortest in the repo** — hands and the pool, and
  nothing else. No card id ever leaves its owner's hand except the beat where
  cards physically cross the table. That was the easy half; see the cost section
  below for where the time actually went.

  The one open question is settled: **there IS a pool**, and **out is out** even
  while the pool still has cards. Measured consequence, worth knowing before
  playing: a game essentially never makes all thirteen books. It averages 11.8 and
  stops when there is nobody left to ask.

- **Kings Corner** — **BUILT and on the shelf. See `KINGS-CORNER.md`.** It
  became game seven ahead of Solitaire, and it is the better seventh: a real
  multiplayer game where Solitaire is a single-player one, so it exercised the
  machinery that actually breaks.

  Two things it added that nothing here had. A **turn is a chain of moves**
  ended by an explicit command rather than being one card, which means per-turn
  state in the reducer and a bot that returns one move and is asked again — and
  an `at` key that must move on every move INSIDE the turn, or the room's early
  return leaves a bot sat there after its first card. And it has **a move with no
  card in it**: a whole pile lifted off one slot onto another, where every other
  command in every engine is "play this card from my hand".

  It is also the first game whose **bot ladder could not be established**, and
  the first where a genuinely informative signal measured as harmful. See the
  cost section below — that lesson is about method and it generalises.
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

**ON HOLD, and it may not happen. Do not start it.** Seb's reservation, and it
is a good one: the world is already full of Solitaire. Every phone ships with a
version and there are a thousand more, so this one would have to be better than
all of them at a game where nobody is waiting on anybody — and being better than
all of them is not what this app is for.

The rest of this section already argues the same thing from the other end.
Solitaire is the only game on the list with no group in it, and a group with
phones is the entire premise: no second phone, no turn order, no reconnect
mid-turn, no privacy boundary worth the name. It would exercise almost nothing
that the other six exercise, which is why it was always going last.

Left written down rather than deleted, because the shape of it is worked out and
the reasoning is worth keeping if it is ever revived. What follows is that plan.


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
`historyRecord`, `historySummary`, `stallWatch`, `bots` (nullable), and
`deadline` (optional).

**`deadline(state, now)` arrived with Cheat** and is the only hook here that
exists because a game needed a TIMER of its own. Every other clock the room runs
is about somebody having gone missing — the grace window, the stall watch, an
election timing out. Cheat's challenge window is different in kind: nothing has
gone wrong, nobody is absent, and the game simply cannot move on until a few
seconds have passed.

Return `{key, afterMs, command}` or null. The room arms it exactly the way it
arms the bot timer, so **the key must stay identical while it is waiting for the
same thing** — otherwise the timer restarts on every broadcast, every reconnect
and every name edit, and a three second window never closes on a busy table. The
command should carry enough to no-op if it fires late; Cheat's `play/settle`
carries the moment its window opened.

Games without a clock of their own leave it off. The room asks before it calls.

**Chase the Ace became the second user of it** and that is the argument for
having made it general rather than special-casing Cheat: it needed a pause after
the deal, during which nobody may draw while everybody reads the hand they were
given. Same hook, completely different shape of wait.

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
- ~~`historySummary(record)`~~ — **added**, see the verified bugs below.
- "the secrets in this state, by owner" — a function the room never calls and
  only the cross-engine privacy test uses. See Privacy below. Still a fixture in
  `test/privacy.test.js` rather than a hook, and after five games that looks like
  the right place for it: the fixture is written from the ENGINE's point of view
  and the test needles it from authoritative state, so a redaction bug cannot
  hide behind a hook that is wrong in the same direction.

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

**`shelf.js`** — agnostic apart from the `'blob'` fallback in `resumeRow`. Fix
the fallback and it is clean. This is the one screen CLAUDE.md's claim is true
about. It carries the code box as well as the tiles now — see **Arriving with a
code** below, and read the height budget there before you add a seventh tile.

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

## Arriving with a code

The commonest way anybody new reaches this app is not the shelf. It is somebody
handing them a code, or holding up a phone with a QR on it. Four pieces cover
that, all of them shared, and a new game wires up exactly one of them.

**The code box is the first thing on the shelf.** `shelf.js` `joinBar` — a
four-digit field, a camera button and Join, above the tiles. **A new game needs
nothing here.** The box does not know or care which game a code belongs to; it
sets `ui.code` and routes to `join`, and the server resolves the code to a game
when the join lands. Do not add a per-game anything to it.

**But it costs height, and the shelf is full.** The `html[data-size='huge']`
block in `styles.css` exists because at the largest text setting everything is
multiplied by 1.4 and six tiles plus a code box do not fit a phone. It is tuned,
by measurement, to land the sixth tile at 801px against an 812px viewport on a
375-wide phone. **That is eleven pixels of headroom for the whole screen.** A
seventh tile is about another 112px, so it will not fit and no amount of
tightening spacing will make it — the same arithmetic that already forced the
taglines, the shelf heading and the "Got a code?" label to be dropped at that
size. When you add game seven, plan for the shelf to become a scrolling list or
a two-column grid at `huge`, and **measure it** rather than assuming: the failure
is silent, it only happens at one text setting, and the way it shows up is a
person never discovering half the games.

**`codeCard(state)` in `common.js` — import it, never copy it.** The game code,
the QR, and the "Send a link" button, for every lobby. This was six near-identical
copies once, and the day a share button was added to Blob's lobby and to no other,
five games out of six silently did not have it. One copy now, and a new lobby gets
all three by calling it.

**The QR encodes `?c=<code>&g=<game id>`, and the `g` has a job.** A code is four
digits and says nothing about what is being played, but the game only arrives with
the first state, which is a round trip away. Without the hint, somebody scanning a
Go Fish code spends that round trip on a purple screen that then turns blue under
them — the one screen a new player is most likely to see first, wearing the wrong
game's colours. `boot()` and `ctx.scanToJoin` both honour it, and both check the
id against `GAMES` first. **So the id in `public/games.js` is what makes this
work**, and a game whose registry id and link id drift apart fails soft: the hint
is ignored, nothing breaks, and nobody notices the colours are wrong.

**Scanning is `scan.js` plus `qr-read.js`, and is entirely game-agnostic.** Worth
knowing why it exists rather than using the phone's own camera app: a scanned link
opens in the *browser*, which for an installed app is not the installed app — you
land in a second copy of Blob looking at your own game from outside, with a
different session. No web API can make a link jump into an installed app. The
reader is ours because `BarcodeDetector` does not exist on iOS. Neither file has
any per-game content and neither should grow any.

---

## Two things a new game's table screen should copy

Both came out of playing rather than building, and both are about a screen that
is technically correct and still leaves somebody confused.

**Say whose turn it is where the player is looking.** Every game has a status
line at the top saying "Your go", and at a table of five it was still possible to
sit there while everybody waited — because your eyes are on your hand, working
out what you can play, not on a caption above the table. Silly Head puts a gold
ring on the block your own cards live in for exactly as long as the game is
waiting on you (`sillyhead/table.js` `yoursClass`, `.sh-yours--turn`). Copy the
idea, and copy the mechanism: **an `outline` and a `box-shadow`, never a border
or padding.** Anything that changes how tall that block is gets measured by
`fitCards` after paint, and a turn that resized every card on the table each time
it came round would be worse than the problem being solved.

**If the hand sorts itself, say which card is new.** A hand kept in rank order
means a card you have just been given or just drawn files itself between two you
already had, and the hand simply looks one longer — you cannot tell which one
arrived, which in Go Fish is most of what you want to know. `gofish/table.js`
marks it with a small star (`gf-hand__card--fresh`), and `app.js`
`markWhatArrived` decides which cards those are **by comparing your hand with the
one before it, on the client**. That is not laziness and it is the part to copy
carefully:

- The server *cannot* send it. Which card came out of the pool is the one
  genuinely private thing in Go Fish, and a `lastEvent` naming it would hand the
  table a card id that `viewFor` spent a whole essay refusing to leak.
- Your own hand is only ever in your own view, so the difference between two
  consecutive ones is too. No boundary is crossed.
- It is presentation, not a decision. Nothing about what is legal is worked out
  here, which is what keeps it inside the "the client draws what the server says"
  rule rather than in breach of it.
- **Three cases must come out as "nothing is new", and each one was a bug**: the
  deal, where every card is new and marking all seven says nothing; a phone
  reconnecting, which has no previous hand and would light up the lot; and a hand
  that only shrank, where the existing marks must stay put, because the last thing
  you picked up is still the last thing you picked up after you lay a book down.

Any new state you keep for this goes in the `ui` object in `app.js` **and gets
cleared in `resetGameView()`** — the list there is long for a reason, and a key
that outlives its game is a stale selection pointing into somebody else's hand.

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

**A big screen is a phone with more room, not a different app.** `.screen` is a
560px column that widens to 620 and then 700 as the glass grows, and that is the
WHOLE responsive story. Do not give a game its own desktop layout. Chase the Ace
and Cheat both got one - seats into a two-up grid, the middle lifted out beside
them - and both had to be taken out again: the shelf stopped looking like one
app, and moving from a phone to a laptop meant learning the screen twice.

Worth knowing how it survived review. There were TWO media blocks doing it per
game, and the older one sat directly underneath a comment explaining that
widening this screen would make it the odd one out. It did exactly that,
immediately below the sentence saying not to. **Grep for `min-width` in your
game's block before you believe it is clean.**

**Bump `CACHE` in `sw.js` for any change to a shell file.** The service worker
precaches the whole client, so a stylesheet or screen change without a version
bump reaches nobody who has opened the app before. This cost real time twice in
one session: once believing a layout fix had failed when the browser was serving
the old CSS, and once telling Seb a fix was live when his phone could not see it.
It is one line and it is not optional.

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

**2. ~~No cross-engine privacy test.~~ FIXED — `test/privacy.test.js`.** It walks
`ENGINES` rather than naming a game, plays a hand of each with every seat driven
by that game's own bots, and audits every payload at every state along the way.

Two things about it matter more than the check itself:

- **A game with no fixture FAILS**, by name, with a message saying what to add.
  Verified by registering a pretend fifth game and watching it go red. That is
  the whole design: it turns "somebody has to remember" into "you cannot forget".
- **There is a negative control.** One test deliberately plants another player's
  hand in a payload and asserts the audit catches it. A test that can never fail
  is worse than no test, and this one proves it can.

Each game declares `hiddenFrom(state, viewerId)` — the cards THIS viewer must not
be told about. Both directions, because Blob's forehead round inverts it: there
the one card you may not see is your own. It found a real mistake on its first
run, in the fixture rather than the code — Silly Head's `publicHand` is a
legitimate exception, since the room watched those cards get picked up, and
writing the rule down was what forced the distinction into the open.

**3. `engineById` returns `BLOB` for an unknown id** (`lib/engines.js:223`)
instead of refusing, so a typo in a game id silently plays Blob.

**3b. ~~`screens/history.js` renders Blob's shape.~~ FIXED while building Go
Fish.** `historySummary` fixed the server half while Sevens was going in; the
client half sat unfinished for three more games, so every Sevens, Chase, Cheat
and Go Fish row in the history list said "undefined rounds" and listed every
player's score as `undefined`. It now drops the rounds when there are none and
falls back to the engine's own `detail` line when nobody has a total. **Worth
noticing how it survived**: the fix was written down in this file as needing
BOTH halves, one half was done, and the entry was not updated — so three games
were added on top of a bug the checklist had already found.

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

## What building Cheat actually cost

Sevens' ratio held and then some. The reducer, the view and the deck were an
afternoon and needed almost no revision. Everything expensive was somewhere else:

- **The bots took longer than the game did**, and three rewrites. Twice the
  ladder came out perfectly inverted, and neither time was it visible without
  measuring — the games all looked fine. See `CHEAT.md`. **If a game has a
  judgement call in it, measure the ladder before believing it.** A 160-game
  script is twenty lines and it is the only thing that tells you whether
  "impossible" means anything.
- **One bug was browser-only and thirty seconds to find there.** The countdown
  drew as already spent on every claim after the first, because the view was
  missing the one field the client used as an identity. No test would have caught
  it and no amount of reading would have either.
- **The platform grew one hook** (`deadline`) and the room grew one timer beside
  its other three. That was the whole platform cost, which is the argument for
  the engine registry working.

## What building Go Fish actually cost

The reducer-to-glass ratio held again: rules, view, bots and thirty-four tests in
one stretch, and every real problem afterwards. Four things worth carrying.

**The screen grew past the window and every check said it was fine.** `.screen`
is `flex: 1`, which overrides the height `.screen--fixed` sets — so at the
largest text with six players the screen was 1024px tall in an 812px window and
the answer button sat below the fold. Nothing was clipped, so
`scrollHeight === clientHeight` and `spillIfNeeded` reported a screen that fitted
perfectly. **This is the third screen to hit it** and the note at `.screen--fits`
in `styles.css` already described it; the fix is `flex: 0 0 auto`, and it should
probably move onto `.screen--fixed` itself rather than being rediscovered a
fourth time. Cheat's table has the same shape and has never been measured at six
players.

**Then the obvious repair was wrong in the direction that hides itself.** The
replacement check — is the screen's bottom past the bottom of the window — is
true always, because the screen is SUPPOSED to be one window tall and starts a
few pixels down. It fired at every size and quietly threw away part of the screen
that fitted. Compare against `--app-h`, which is what the screen was told to be.

**Let the measurement decide WHAT to drop, not just whether to scroll.** Go Fish
sheds its transcript first and only scrolls if that is not enough, because the
transcript is the one part of that screen that is a convenience rather than a
control. Keyed on measurement, so it needs no rule about player counts: five
short names and five long ones are different screens.

**The bot ladder came out inverted at the top, exactly as Cheat's did.** The
first version gave the top rung two extras over Hard — information hygiene and
discounting stale negatives — and measured at 26.8% against three Hards, which is
a 25% baseline. What actually separates them is **counting**: a player known to
be sitting on three sevens is a book to anybody holding the fourth, and Hard only
knows that they hold *some*. With counting, and with the hygiene term measured up
from 0.12 to 0.4 rather than guessed, the ladder over 500 four-handed games runs
easy 2.0%, medium 12.9%, hard 36.4%, impossible 48.6%. **The general lesson is
the same one twice now: the extra a top rung gets has to be a different KIND of
knowledge, not more enthusiasm about the same kind.**

Two smaller things. `topbar` already draws the game code on the right, so passing
`left: codeChip(state)` shows it twice — Cheat's table does this and nobody has
noticed. And a log that is the game's whole memory is a real payload: at 160
entries it is about nine kilobytes on every broadcast, which is why Go Fish's log
entries carry no clock.

## Controls, and the four things playing it caught

None of these came out of a test. All four came from Seb playing a real game and
saying it felt wrong, which is the ratio to expect: the reducer is provable and
the glass is not.

**Never offer a blocked player the one control that makes it worse.** Chase the
Ace refused to let you draw while holding a pair, told you so, and then offered a
single button: SHUFFLE MY HAND - which scrambles the very cards you are hunting
for. If the game is waiting on one action, that action gets the button, and the
one that would undo your progress is not on the screen at all.

**The thing the player must react to is the biggest thing on the screen.** Cheat
put the claim - the only object in the game anybody has to answer - in a 24px
line under a row of card backs, with a four second clock on it. Reading it cost
most of the window. It is now a 60px numeral and a 38px word. Related: use a
NUMERAL for a count somebody is racing, never a word. "3" is read at a glance;
"three" has to be read.

**A control that is on a clock must never also be the control that moves.**
Cheat's call button used to appear only while a claim was open, so the one thing
you had four seconds to hit was also the one thing whose position you could not
learn. It is now always on screen and simply goes live.

**Do not animate other people's deliberation.** Each seat in Cheat said
"deciding" and cleared as each bot answered, so three seats changed under your
eyes during the seconds you were trying to read a claim. Seb described the screen
as reloading. Somebody else's thinking is not yours to act on - and anything that
repaints during a moment the player is trying to read is noise, however true.

## What building Kings Corner actually cost

The seventh game, and the reducer-to-glass ratio held for a seventh time:
rules, view, bots and thirty-four tests in one stretch, and every problem worth
writing down afterwards. Five things generalise.

**The bot ladder is not a ladder, and finding that out was most of the work.**
Only `easy` came out separated. `medium`, `hard` and `impossible` measure 27-34%
at a mixed table against a 25% baseline with no stable ordering. Four heuristics
were built, measured and thrown away for making the bots WORSE. The details are
in `KINGS-CORNER.md` and `lib/kingscorner/bot.js`; three things belong here
because they are about method rather than about this game.

**Both of the obvious measuring instruments were invalid, and each looked
perfect while lying.** Heads-up reported exactly 50.0% for every rung, which
reads as a beautifully balanced measurement and was measuring the seat: in a
mirror match between two competent bots, whoever leads wins 100% of the time,
and the harness swapped seats every other game. Then "one challenger against
three of a kind" produced "hard beats a field of mediums" AND "medium beats a
field of hards" - both true, because a uniform field can be free-ridden. **Before
trusting a ladder number, check that the instrument can distinguish the thing you
think it is measuring**; a null run of one policy against itself should come out
at baseline, and if it does not, nothing above it means anything.

**The value of information depends on whether the thing it tells you about is
yours.** Cheat and Go Fish both taught that a top rung needs a different KIND of
knowledge. Kings Corner is the counter-example and it is worth holding next to
them: counting the deck here is real knowledge, correctly derived, entirely
public - and worth less than nothing. A field of counting bots was markedly
easier to beat than a field without (46% against 24%). What the counting informs
is the eight shared slots, so acting on it helps everyone at the table equally.
Go Fish's counting pays because a book is yours alone.

**A game can be shaped so its best play is generous.** Freeing a slot is the
move Kings Corner appears to be about, and at four players it is a gift: the slot
is used by the three people who play before it comes back to you. Bots that did
it proactively lost about ten points; bots that never did it at all collapsed.
The optimum is to free one only when you have nothing else left to do. Worth
knowing before designing a bot for any game with a shared board.

**Say so when a ladder is not real.** Four levels are offered because the lobby
and the platform expect four. The lobby blurbs describe what each one
demonstrably does - "puts one card down and stops", "plays out its whole turn" -
rather than promising a difficulty nobody has established, and the shortfall is
written down in the game's own file. Claiming a bot is unbeatable when it is
level with the one below it is a small lie the player finds out about.

### And on the glass

**`arrived(next)` is part of the state-handler contract and nothing says so.**
Every other engine's handler ends with the same four lines and mine had three of
them. It is what routes a phone INTO a game and puts the colours on, so leaving
it out strands anybody arriving by shared link or waking mid-game. If the
handlers are ever generalised, that tail is the part to lift.

**A crash inside a state handler looks exactly like a broken SSE push.** A
`holdWake is not defined` typo threw before `state = next`, so the second phone
sat on the lobby through an entire dealt game while every push arrived
perfectly. Half an hour went on the network before the console was read. **Read
the console on the phone that is behaving oddly, not on the one you are driving.**

**`topbar`'s default title is Blob's.** ADDING-A-GAME.md already recorded that
passing `left: codeChip(state)` draws the code twice, which Cheat's table does.
Removing the chip exposed the other half of the same trap: with no `left` and no
`title`, the default is `Round N of M` falling back to `Lobby`, so a game with no
rounds sits under the word Lobby for its whole length. **A new table screen needs
an explicit `title:` and no `left:`.**

**The shelf just scrolls, and the two-column detour is worth reading before
anybody tries it again.** The seventh tile ended at 937px against an 812px
viewport at the largest text size, exactly as the height budget predicted. Two
columns were built, measured, shipped - and then Seb asked for scrolling
instead, which is his call and it is the front page.

Recording what the two columns cost, because it is the argument against
reaching for them a second time. Each failure was silent.
`grid-template-columns: 1fr 1fr` overflows, because a 1fr track still has
`min-width: auto` and a name that will not break widens its own track and pushes
the second column off the phone - `minmax(0, 1fr)` fixes that. Then the names
ellipsised, giving "Ch..." for **both** Cheat and Chase the Ace, which is two
tiles nobody can tell apart on the one screen whose job is showing you what
there is. Then `overflow-wrap: break-word` gave "Kin gs Cor ner". The only thing
that worked was dropping the icon at that size.

Three silent failures, and the fix for all of them was one line of CSS deleted:
`.shelf` is already `screen--scroll`. **The general lesson is worth more than
the specific one: when a layout needs three repairs to avoid a scroll, ask
whether the scroll was ever the problem.** Nobody had objected to it.

**Let the measurement decide what to drop, on the table as well as the shelf.**
The table itself ran 85px past the fold at the largest size. The page scrolled,
so nothing was unreachable and the naive check passed - but the fix is the board
giving room back rather than the screen moving, because the board is the biggest
block and its cards do not need to shrink for it to do so.

## The screen key, and the bug it caused twice

`app.js` plays the whole entry animation whenever `screenKey()` CHANGES. So a
key is the answer to "which screen am I on", and nothing else may go in it.

Both new games got this wrong in the same way, with comments confidently
explaining the opposite. Chase the Ace put the lifted card in its key, on the
stated grounds that this would stop the animation firing on every tap - it
guaranteed it instead, and because binning clears the lifted card, **throwing a
pair away replayed the entry animation every single time.** Cheat put the open
claim in its key and re-entered twice a turn.

Seb reported it as the screen reloading, which is exactly what it looks like.

**The rule: a key names where you ARE, not what you are doing there.** Phase is
almost always the whole of it. A within-screen state - a selection, an open
window, a countdown, a hand that grew - never belongs. The legitimate exceptions
are the ones that genuinely swap one screen for a different screen: Blob's
`correcting` and Silly Head's `shConfirmReady` both do that, and both are fine.

If you want an animation for something smaller, animate that thing. There is a
worked example of the shape in `screens/cheat/table.js` (`freshEvent`): gate on
the event's own identity plus a time window, never on "this render differs".

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
Blob 265, Silly Head 148, Sevens 205, Chase the Ace 345, **Go Fish 228**,
**Cheat 30**, Solitaire 20. The three cool ones at 148/176/205 are the
tightest cluster and the pair most likely to need separating once seen.

Cheat moved from 305 to 30 when Seb looked at the plan and said it was too close
to Blob's 265 — which it was, on a phone in a dim room, and that is the entire
point of the exercise. **Two things worth taking from that.** A hue that is
merely a different number can still be the same colour to a person, so the test
is whether you can tell the two TILES apart, not whether the numbers differ. And
moving it dissolved a problem that had been written down here as unavoidable: at
305 the rule produced a green accent, wrong for a game about lying, and the plan
was to break the rule. At 30 the complement is blue, so the rule holds and the
app gets its first COOL accent — the one thing on the shelf that cannot be
confused with any other.

Solitaire's pencilled 20 now sits next to Cheat's 30 and should move before it
is built. **Go Fish took 228 as planned**, and it looks right next to Sevens'
205 on the shelf — the twenty-three degrees are enough because the accents are
not the same temperature.

**The warm end of the shelf is now full, and that is a real constraint.** Blob
has lime, Silly Head amber, Sevens orange. Every BLUE ground produces a warm
accent, because blue's complement is warm - so Go Fish, which had to be a sea
blue, could not take a rule-derived accent without landing on top of one of
those three. It takes a bright surf cyan instead: a documented departure, the
second after Chase the Ace's.

Sevens is also already a blue at 205, so Go Fish had to go deep - 228 - to be
tellable apart from it on the shelf, where the tiles sit side by side each
carrying its own hue AND its own accent (`screens/shelf.js:86`).

**Kings Corner took the seventh hue: 178, a teal**, with a coral `#ff3d47` at
S100 L62 straight off the accent rule — the first red accent in the app, and the
shelf had nothing else in that family. It sits between Silly Head's 148 and
Sevens' 205, which is the cluster this section named in advance as the one most
likely to need separating; on a phone the three tiles are tellable apart, so the
prediction held and the budget did not run out.

**One thing to look at on a real screen before copying the rule blindly.** The
derived accent doubles as the `--lime` token, which is what every screen paints
"this is the thing to tap" and "this card is playable" in. A red one puts a red
ring on a playable card and a red primary button on the table, and red is a
strong convention for something else. It is consistent, it is the rule working,
and it may still be wrong — flagged rather than changed, because repainting a
game's accent is Seb's call.

**Solitaire was to be the seventh game and there was no obvious hue left for it.** Worth
solving before it is started rather than after - though see the section above,
which is where the hue problem most likely goes away by the game not being
built. Six games have used the usable arc almost exactly as planned, which is
the budget working rather than running out.
