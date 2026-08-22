# Working on Blob

The README explains what Blob is and how it fits together — read it first. This file is
about working *in* the code: the invariants that must not be broken, and the mistakes that
have actually been made here.

## Commands

```bash
node server.js     # http://localhost:4100 — no build step, no install needed
npm test           # node --test, 200 tests
node --check <f>   # quick syntax check on a single file
```

There are **no dependencies**. `package.json` exists so hosts detect a Node app and know
how to start it. Keep it that way — a dependency needs a real argument, and the QR encoder
in `public/qr.js` was written out by hand rather than pulled in.

Run a local server on a spare port with its own data directory, never the default:

```bash
BLOB_PORT=4200 BLOB_DATA_DIR=/tmp/blob-scratch node server.js
```

Two phones are two browser **origins**, not two tabs: the session lives in
`localStorage`, so `localhost:4100` and `127.0.0.1:4100` give you two players on one
machine. A third can be driven straight through `/api/games` and `/api/command`.

## The three invariants

**1. `lib/` is pure.** `applyCommand(state, command, ctx)` returns a new state or a
refusal. No I/O, no clock, no network, no randomness — `now` and `newId` arrive through
`ctx`. This is what makes the rules testable at speed, and every test depends on it. If
something in `lib/` needs the time or a random number, inject it through `ctx`; do not
reach for `Date.now()` or `Math.random()`.

**2. `lib/view.js` is the privacy boundary.** A value that a player is not allowed to see
must be **absent from the payload**, not merely hidden by the UI. Bid values while bidding
is open, election votes, and — online — the cards in everyone else's hand already work this
way. `test/server.test.js` asserts that neither a hidden bid nor a hand ever appears in
anyone else's payload — those tests are load-bearing, and any new secret needs its
equivalent. A bot's private seed is one of those secrets and `test/bot.test.js`
pins it.

Hands are read through `handFor()` and nowhere else, and keys are left **out** rather than
set to `null` when the viewer may not see them, so a secret cannot arrive as an
empty-looking field that a later change quietly fills in.

**2b. A bot is a client too.** It is driven from `viewFor(state, botId)` — the same
redacted payload a phone gets — and `lib/bot.js` cannot reach `state` at all. That is
what makes "Impossible" mean *thinks well* rather than *sees your hand*, and it is
structural rather than a promise: if the payload does not carry it, no amount of skill
in there can invent it. Never add a wider view "just for the bots".

**3. The client draws what the server says.** `public/` holds no game logic and applies
nothing optimistically: a bid that appeared to land and then did not would be far worse
than one that takes 40ms.

There is exactly **one** deliberate exception, in `public/screens/lobby.js`: the starting
hand size moves locally while the Master is tapping and the server is told once the tapping
stops. It is a lobby setting rather than anything scored, only the Master can change it,
and a refusal puts it straight back. Do not widen this exception without the same
reasoning.

## More than one game

`public/games.js` is the shelf: one row per game, and the row IS the definition —
name, hue, accent, whether it is ready. `screens/shelf.js` renders them and is the front
door; picking one calls `ctx.openGame(id)`, which puts that game's colours on and moves to
its own front page. Anything arriving with a destination — a scanned code, a shared link,
a game already in progress — skips the shelf in `boot()`, because nobody being handed a
code should have to pick a game first.

**A game gets a hue, not a palette.** `--hue` in `:root` rotates the whole dark ground,
and every step keeps its lightness and saturation — so a green game has exactly the
contrast the purple one does, in the same dim pub, with no screen redesigned. Verified:
purple `rgb(20, 8, 38)` and green `rgb(8, 38, 22)` are the same three numbers permuted.
Cards need a dark, low-saturation ground to read against, and that part does not get to
vary; a bright green background with playing cards on it is worse than no theme at all.
The accent moves with the hue, because an accent sitting close to its own background has
stopped being one.

Do not hand-pick a second set of hex values for a new game. If a game needs more than a
hue to look right, the thing to fix is the design it is fighting, not the token list.

## UI conventions

**Steppers patch the DOM in place. They never re-render.** Rebuilding a screen under the
thumb that is tapping it drops whichever tap lands mid-render — this was a real bug in all
three steppers. Hold references to the value node and the buttons, mutate `textContent` and
`disabled` directly, and leave the rest of the screen alone. See `public/screens/reveal.js`
(results entry), `welcome.js` (starting hand), `lobby.js` (lobby hand size).

A corollary: **anything that reads state captured at render time goes stale** once the
screen stops re-rendering. Read the live value at the moment you use it.

**`render()` replaces the contents of `#app` only.** Anything appended to `document.body`
survives a re-render — which is why the confetti lives there. A decorative layer returned
as a child of a screen is destroyed and rebuilt on every repaint, and a `position: fixed`
layer inside a scrolling screen gets stranded mid-content on iOS.

**Re-render after changing UI state that the server does not push.** A command that changes
the phase gets its repaint free, because the screen changes with it. One that does not — a
score correction, say — needs an explicit `ctx.render()`, or the pushed state lands before
your flag change and nothing repaints.

## Drawing cards (online mode)

**`public/cards.js` is the only place a card is drawn.** Faces, backs, the trick pile, the
trump badge and the hand order all live there, so `screens/playing.js` can stay about the
game. It holds no rules: what is legal arrives in `you.playable`.

**The hand sorter groups suits and alternates their colour** — red, black, red, black, ranks
low to high inside a group. A missing suit leaves no gap, an all-black hand is left alone,
and a tie on suit count opens on red. Two same-coloured suits touching are the ones people
misread under pressure.

**Seats are placed by arithmetic and then fitted by measurement.** Everybody sits at equal
spacing round the whole ring with you at the bottom, so four players land on north, east,
south and west without that being a case in the code. `seatWidthPct()` spaces them, then
`fitSeats()` runs after paint and shrinks `--seat-scale` until no two seats touch. Keep both: the formula gets two to eight players close, and the measuring
pass settles what it cannot predict — how tall a seat ends up once the name, the numbers and
a played card have had their say. Compare the pieces (seat box, card box) rather than one
merged box; a card sits on a tighter ring than the badges, so a merged box reports
collisions that are not there.

**A finished trick is held, then swept.** The server clears a trick the instant it settles,
which would make the winning card vanish before anyone saw it, so `playsToShow()` keeps
showing `round.lastTrick` for `TRICK_HOLD_MS` with its winner named in the middle of the
table. The hold is a maximum, not a block: leading the next card ends it early, because play
must never wait on an animation.

**A played card is offset far enough to clear its own seat**, not merely toward the middle.
At 46px it sat on the badge and name of whoever was at the bottom of the ring — always you —
and the offset differs by axis because a seat is taller than it is wide.

**The hand fan measures itself too.** `fitHand()` tightens `--fan-overlap` until seven cards
fit across the screen. Card width depends on the stylesheet, the size setting and the round,
so laying them out and looking is the only honest test.

**The deal is Web Animations, not a CSS transition.** An animation leaves no inline styles
behind, so it cannot end up fighting the stylesheet rule holding a card at rest, or the lift
that follows it. It runs once per round, keyed on `game id + round index`.

**A bigger screen gets a bigger layout, not bigger type.** The table spreads and the column
widens, but card sizes, seat badges and the table typography are **fixed pixels**, so the
smallest setting is the size Blob has always been drawn at on every device. Scaling them
with the viewport was tried and reverted: it made the default quietly bigger than the design
it came from. How big the type should be is the player's call, not the screen's — that is
what the size setting is for.

**The table is a shape, not a column.** `.table` is the space going spare; `.table__ring`
inside it takes the largest square-ish area that fits and centres in what is left, and
everything positioned — seats, felt, deck, banner — is a percentage of the ring. Left as one
stretched box it gave a tall empty oval with small pieces marooned on it. The playing screen
also gets a wider `max-width` than the text screens, which stay narrow because a line of
prose 800px wide is harder to read, not easier.

**One knob scales the whole app.** `--ui-zoom` in `:root` is `--ui-base` (what the screen
suggests — a phone gets 1, an iPad and a laptop more) times `--ui-step` (what the player
chose, stored per device by `public/size.js`), applied as `zoom` on `#app`. Never enlarge a
few font sizes by hand instead: big text in boxes built for small text is worse than either.

Two things follow from `zoom` and both have bitten:

- **Viewport heights have to be divided back out.** `height: calc(100dvh / var(--ui-zoom))`,
  or a zoomed screen is taller than the screen it is on and the hand falls off the bottom.
- **Measuring and moving are in different units.** `getBoundingClientRect` reports what you
  can see; a transform inside the zoomed subtree is in that subtree's own pixels. Anything
  that measures one and moves by the other divides by `uiZoom()` — the deal animation does.

The automatic scale is gated on **height as well as width**, because a laptop is wide and
short, and a screen that must not scroll cannot be scaled by its width alone.

**`requestAnimationFrame` does not fire in a hidden tab.** Both the deal and the seat fit are
scheduled that way, so a backgrounded phone runs them when it comes back. Do not put
anything load-bearing behind one without that being fine.

**Ask Blob is a lookup table, not a model.** `screens/help.js` scores a typed question
against word lists and replies with a written answer, with a short pause so being answered
feels like being answered. There is no backend and no key, and it works with no signal. If
nothing matches it says so — a wrong answer about the rules is worse than no answer, so
never make the fallback guess.

**On the bidding screen the hand outranks the pad.** Your cards are what you are reading
while you decide; the pad is a keypad and a keypad does not need half the glass. So `.peek`
is weighted above `.pad` and has a floor, `.pad` is capped against the viewport, and at the
larger size settings the pad sheds its captions — the question and the box showing your
choice both repeat what the pad and the Submit button already say. Controls stay, captions
go.

**And the hand grows into the room it is given.** Space is no use if the cards do not use
it: a seven-card hand used to drop to 46px to fit across a phone, which left the cards
SMALLER on the screen where you study them than on the one where you play them. So
`fitPeek()` fans them tighter instead of shrinking them, and only gives width back once
the overlap would cover the corner you read the card by (55%). Three traps it walks into
and back out of: `.peek` must have no `gap`, or the spacing has two sources and every sum
is wrong; the fit must clear its own last answer before measuring, or it creeps tighter
every render; and the overlap is floored rather than rounded, because a fan a pixel too
tight is invisible and a pixel too wide runs off the phone.

Two more traps: a percentage `max-height` needs a definite parent, and a flex item has
none — `max-height: 46%` on `.pad` silently did nothing, so it is `calc(Ndvh /
var(--ui-zoom))` instead. And `.screen--fixed` sets a height that `flex: 1` on `.screen`
overrides, so an oversized screen grows the page rather than scrolling inside itself; at a
non-default size the page is allowed to scroll, because a Submit button that cannot be
reached is worse than a screen that is not perfectly still.

**Nothing small survives in the middle of the table.** Measured on a phone: the top and
bottom seats' cards land within 28px of the centre and are 60px tall, so anything sitting
there is covered every hand. The turned card used to. No shape of table fixes it — the
ring is already as wide as the screen, so vertical room can only come from somewhere that
has none spare — so the middle stopped carrying it. The suit is painted across the felt
instead (`.table__trump`), far too big for a card to hide: with all four cards down it is
still ~79% visible. What is left in the middle is the deck, which is what it says it is
and the anchor the deal flies out of.

**Trumps live in the top-left corner, as the actual card.** It used to be a `♠ TRUMPS`
pill on the right and it was missed constantly: it was competing with the game code and
the settings button, and at that size the four pips are near enough the same shape. The
turned card takes the corner and the round number moves to a chip, because the round
matters once a hand and the trump suit matters on every card you play. Your own trumps
carry a gold edge in the fan for the same reason.

**A finished trick slides to whoever won it.** `sweepTrick()` animates every `.seat__card`
to the winner's seat before the table is cleared, which is why seats carry
`data-player-id`. It says who took the trick better than a label does and doubles as the
reset beat between tricks. `TRICK_HOLD_MS` was shortened to pay for it, so the whole beat
is the length it always was. Like the deal it measures on screen and moves inside the
zoomed subtree, so it divides by `uiZoom()`; and it calls `done` on every path — a
browser with no Web Animations, reduced motion, or a screen that changed underneath must
still end up with a cleared table.

**The server must pace bots against the client's animations.** A trick settles instantly
on the server while every phone is still holding it up and sweeping it away, so a bot
leading straight after would have its card simply THERE when the table cleared — which is
the "no gap between bots" people actually notice. `SETTLE_ALLOWANCE_MS` in `lib/bot.js` is
paired with `TRICK_HOLD_MS + SWEEP_MS` in `screens/playing.js`; change one and move the
other. `MIN_BOT_GAP_MS` in `server/room.js` is the backstop under all of it, because every
other route to two bots landing together ends there too.

**Sound is synthesised, never loaded.** `public/sound.js` builds every noise from
oscillators and one noise buffer. No files to cache, nothing to download on pub wifi, and
— the reason that decides it — no third-party anything, so the CSP stays as tight as it
is. Short and quiet: this is cards being put down, not a soundtrack. One switch in
Settings, and turning it ON makes a noise, which is the only honest way to show a sound
switch worked.

**Buzz for the three moments the game is waiting on you** — a new hand, your bid, your card
— and nothing else. `[14, 70, 14]` for a hand starting, a single `12` for your turn to play.
More than that and people stop noticing any of it.

**`h()` in `public/ui.js` takes text, never markup.** `text:` sets `textContent`; there is
no way to inject HTML, which is what keeps a player called `<script>` uninteresting.
Props starting with `on` become `addEventListener`. Inputs keep their focus across renders
via `data-focus-key`.

## Adding a command

Commands live in `HANDLERS` in `lib/game.js`. The current set:

```
player/join  player/addOffline  player/addBot  player/remove
game/setHandSize  game/acknowledgeDeck  game/start  game/end  game/rematchStarted
bid/submit  results/submit  results/amend  round/next
trick/play  trick/stalled  trick/skipTurns
conn/set  conn/takeover
election/start  election/vote  election/resolve
```

`results/submit` and `results/amend` are **table-only**; `trick/play` is **online-only**.
Each refuses in the other mode rather than doing something surprising.

Every refusal message is shown to a player as-is, so write it in plain English. Give a
`code` only when the client needs to branch on it. Commands that could be double-tapped
must be idempotent — a second tap is a no-op, not an error.

## Things that are easy to get wrong

- **Add new client modules to `SHELL` in `public/sw.js`.** Caching is network-first so a
  miss is survivable, but the shell should list every module.
- **Leaving a running game is one-way.** `leaveGame()` clears the session, and round a
  table `player/join` refuses once the game has started, so there is no way back in.
  Anything that discards a session mid-game needs to ask first. (Online a *new* player can
  join a game in progress — but a player who left has lost their seat either way.)
- **A round remembers who was in it.** Someone joining an online game mid-hand cannot be
  dealt into a hand already being played, so `round.playerIds` records the seats that were
  dealt and they sit that one out. Read it through `roundPlayers(state, round)`, never
  `state.players`, anywhere inside a round: bidding, the play order, and scoring all use
  the roster. A round without `playerIds` — every table round — is everybody, so nothing
  about the original game changed shape.
- **A latecomer never shrinks the hand.** Joining before the off trims `startHandSize` to
  what the deck can deal; joining after it does not, because the people already holding
  cards would lose one. Instead the join is refused when the deck cannot stretch to the
  biggest hand still to come.
- **A player's seat is worth keeping until it is replaced.** Do not clear a session on the
  way to joining a different game — only once the new join has landed.
- **A one-card round still has trumps.** No-trumps only happens when a deal consumes the
  whole deck and there is no card left to turn — which the online hand-size cap currently
  makes unreachable, since it always keeps a card back. `lib/deck.js` handles it anyway.
- **Two modes share one engine.** `state.mode` is `table` or `online`, and the phase after
  bidding is `reveal` or `playing` accordingly. Online rounds grow `hands`, `trumpCard`,
  `trick` and `tricksWon`; a table round has none of those fields at all, so table state is
  byte-for-byte what it was before the mode existed. Both score through `scoreRound`, and
  that must stay true — a mode-specific scoring path is how the two would drift apart.
- **A dropped phone never gets covered — it gets skipped.** The Master can cover a missing
  player's *bid*, but never their cards: that would mean showing the Master their hand. So
  after ten seconds of a trick not moving (`STALL_MS` in `server/room.js`) the server
  dispatches `trick/stalled`, which only puts the choice on the Master's screen. If they
  take it, `trick/skipTurns` plays that player's **worst legal card** each turn until the
  hand ends — a plain suit before a trump, lowest rank of what is left. It lasts one hand
  and is cancelled the moment they reconnect. Being absent should cost you the hand, not be
  quietly played well on your behalf.
- **Auto-plays go through `playCard`, the same as tapped ones.** There is deliberately no
  second, quieter path through the rules. `advanceAutoPlays` just keeps calling it while
  the turn lands on somebody being skipped.
- **Letting a player go is not deleting them.** Between hands (`summary`, online) the Master
  can remove a phone that has gone for good: they are flagged `left`, keep the points they
  won and stay visible in the rounds they played, but drop out of the leaderboard, the
  winners and every later deal. Coming back means joining again — a new seat, from the next
  hand, on nothing.
- **"On your own" is a mode, not a shortcut.** It sits with the other two answers to
  "how are you playing?" rather than behind Online — whose nudge asks whether the GROUP
  has cards, which is not a question when there is no group — and it asks nothing at all:
  `ctx.playSolo()` creates the online game, sits three bots down and lands in the ordinary
  lobby, which is where the difficulty and the hand size already live. No new screen, and
  none wanted. A first-timer with no stored name becomes "You", which is why `ownName()`
  exists: "You (you)" reads like a bug.
- **The front door sheds its decoration at the larger sizes.** The mascot shrinks and the
  tagline goes, because the three choices are what the screen is for and everything scales
  together until they fall off the bottom. Somebody using the big type is exactly who wants
  a practice game, so they must not have to scroll past a picture to find it. Same rule as
  the bidding pad.
- **A bot is a player, not a special case.** It sits in `state.players` with `isBot`,
  `botLevel` and a private `botSeed`, so the deck limit, the hand-size ceiling, the round
  roster, scoring and the history all treat it like anybody else. What it is NOT: a
  candidate for Master (`eligibleForMaster`), something `conn/set` or `sweepPresence` can
  mark away, or something the stall/skip machinery ever fires for. Adding a bot is
  online-only and lobby-only.
- **`server/room.js` drives the bots, one move at a time.** `_scheduleBotMove()` uses the
  same key-and-timer shape as `_watchForStall`, so a broadcast that does not change whose
  turn it is leaves the pause alone rather than restarting it. The position is read again
  when the timer fires, and a brain that throws falls back to a legal card — a bot that
  cannot decide must never be able to freeze a table.
- **Three ways to play at every level, rechosen each round.** One policy per level is
  readable after two hands. The persona lives only in `lib/bot.js`, is picked from
  `botSeed + roundIndex`, and must never reach a view — which is also why the lobby
  blurbs say nothing about method. `test/bot.test.js` measures that the levels actually
  separate; if you change the play policy, re-run that.
- **Correcting a scored round rebuilds every later running total.** `results/amend` does
  not patch in place; it recomputes from the bottom. A correction made after the game has
  finished also has to re-save the history record, which is written once on completion.

## Deployment

Live on Render's free tier at `blob-nm9h.onrender.com`, deploying from `main`. Builds
queue and can take 10–15 minutes.

- `PORT` is read as a fallback to `BLOB_PORT`, because hosts inject it.
- `/healthz` returns `{ok, games}` and is the health check.
- **Single instance, always.** Rooms, the command queue and the SSE connections all live in
  memory, so a second replica would split players in the same game across servers. Scale
  vertically, never horizontally.
- **The free tier has no disk.** Games in progress and all history are lost on every
  redeploy and after ~15 minutes idle. Fixing this means a paid instance with a volume and
  `BLOB_DATA_DIR` pointed at it.

## Testing

`npm test` runs `node --test` over `test/`: the rules (round sequences, scoring, bid
authority, corrections, elections, ties), the real HTTP and SSE surface, the bots, and the
QR encoder against pinned reference output.

`test/bot.test.js` plays whole games through the reducer with the brain deciding, so an
illegal choice surfaces as a refusal rather than as a bad hand months later. Bot strength
is not asserted — it is noisy — but the ordering easy < medium < hard < impossible was
measured over 80 five-seat games and should hold; a change to the play policy that
inverts it is a bug, not a tuning preference.

Anything touching scoring or the round structure needs tests before it ships — a wrong
score is the one bug this app cannot afford, since settling arguments is its entire job.
Drive whole hands through the reducer rather than testing handlers in isolation; the
helpers at the top of `test/rules.test.js` make that cheap.

The repo is LF. On Windows, git warns about CRLF on checkout — harmless, and the diffs stay
clean.
