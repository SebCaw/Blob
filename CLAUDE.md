# Working on Blob

The README explains what Blob is and how it fits together — read it first. This file is
about working *in* the code: the invariants that must not be broken, and the mistakes that
have actually been made here.

## Commands

```bash
node server.js     # http://localhost:4100 — no build step, no install needed
npm test           # node --test, 283 tests
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
name, tagline, hue, accent, the little icon beside the name, whether it is ready.
`screens/shelf.js` renders them and is the front door; picking one calls
`ctx.openGame(id)`, which puts that game's colours on and moves to its own front page. A
scanned code or a shared link skips the shelf in `boot()`, because nobody being handed a
code should have to pick a game first.

**The front page does not change.** The shelf is the first thing anybody sees after
tapping the link — every time, on every phone — and the ONLY change allowed to it is
**adding a section**: another game on the shelf, or a new block below the ones already
there. Not the wording, not the order, not the layout, not the colours, not what it does
when you arrive, and not tidying done while passing through. If a change to the front page
seems necessary, it needs the user to ask for it in those words first. A front page that
has moved since the last time you opened it is one you stop trusting, and this one is the
only screen every single player sees.

That extends to what happens *before* it: a phone with a game in its session paints the
shelf first and moves on once the server answers, so the front page is on the glass even
on the way somewhere else. It used to paint that game's own front page instead, which on a
sleeping instance is where you stayed — a mode picker for a game already running, in that
game's colours, with no way from it to anything else.

Adding a game is therefore one row in `games.js` and nothing else: it brings its own name,
colour and icon with it, and appears on the shelf without `shelf.js` being touched at all.

That sentence is about **the shelf tile**, and of the tile it is true. It is not true of
adding a game to the app, which also costs an engine entry, a rules module, a view module,
a screen folder, and a dozen shared files that still branch on a game id. **Read
`ADDING-A-GAME.md` before starting one** — the ordered checklist, the traps that only show
up on the glass, and the decisions still open. Keep it current as you go.

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

## Silly Head

The second game. The rules as the house plays them are in
[SILLY-HEAD.md](SILLY-HEAD.md) — read that before touching `lib/sillyhead/`, and
keep it current, because it is the only place the house rules are written down.

**One server, two engines.** `server/room.js` used to require Blob's rules
directly; it now asks `lib/engines.js` which rules this room is running, chosen
by `state.game`. An engine supplies `createGame`, `applyCommand`, `findPlayer`,
`viewFor`, `historyRecord`, `stallWatch` and `bots` (null if it has none) — and
nothing else, because nothing else differs. Rooms, sessions, the command queue,
presence, grace windows and Master elections are the same whatever is being
played, and they must stay that way: two command queues would be two things to
keep serialized, and two privacy boundaries would be two things to keep honest.

A state with no `game` field is Blob. That is what every game saved before the
shelf existed looks like, and the default has to keep being right.

**Silly Head has no rounds.** One shuffle, one deal, play until one person is
left holding cards. That is why it is a separate reducer rather than a third
mode: Blob's whole shape is a sequence of scored rounds, and none of
`lib/rounds.js` or `lib/scoring.js` applies. What it does reuse is
`lib/deck.js`'s seeded shuffle, the whole of `server/`, and on the client the
topbar, the lobby furniture, `cards.js`, `sound.js` and the table ring.

**A card id carries which deck it came from.** Silly Head deals one deck up to
four players and shuffles another in for every four after that, so past four
the same face turns up twice and `10H#2` is a different card from `10H#1`.
`public/cards.js` strips the tag when it draws, which is the only place that
knows about it — the copy number is bookkeeping and must never appear on a
card. Blob's ids are untagged and stay that way.

**Your own face-down cards are a secret from YOU.** This is the interesting half
of the privacy boundary and the one Blob had no equivalent of. `lib/sillyhead/
view.js` sends `downLeft` — how many are left, as booleans — and never the ids.
`test/sillyhead-server.test.js` asserts over a real socket that nothing
card-shaped reaches a phone beyond its own hand and everybody's face-up cards;
that test is load-bearing.

**The sort is the only phase where more than one player acts at once.** Everybody
tidies their table at the same time and draws from one shared stock, so
"whoever grabs the top card gets it" is settled by the command queue rather than
by anything in the reducer. That is the whole reason it is safe.

**The run rule lives in one place.** Four of a number in a row sacks the pile,
however they got there, and a play that would push a run past four is refused
rather than truncated. `lib/sillyhead/rules.js` owns that and knows nothing
about players or turns; the reducer owns everything about whose go it is. Keep
the two apart — the specials are where this game lives, and they are only
testable one at a time because of it.

**Nothing special-cases the 2's reset.** A 2 is the lowest card in the deck, so
"equal or higher than a 2" already means "anything". If you find yourself adding
a branch for it, the ordering is doing the job already.

### The Silly Head bots

Four levels, same names as Blob's, and the same one rule underneath: a bot is
handed `viewFor(state, botId)` and nothing else. `lib/sillyhead/bot.js` cannot
reach `state`, so it cannot see a hand, and it cannot see its own three
face-down cards either. `test/sillyhead-bot.test.js` pins the private seed the
way Blob's does.

**A bot sorts, one command at a time.** It has to go through the same door a
phone does, so `nextSortMove` returns one move and the engine keeps asking.
Three things make it terminate, and all three were bugs first:

- It only ever swaps a card off a pile holding ONE card. Pull apart a stacked
  pair and step 3 puts it straight back, for ever.
- It fills an empty pile with its BEST card, never its worst — otherwise it puts
  back exactly what it just took off.
- It stacks a pair and stops. Without that cap a bot keeps matching and drawing
  until the stock is in its hand.

**"Being refilled" is not "the deck has cards".** You only draw back up to
three, so the moment a hand is bigger than that the deck stops replacing
anything — and it can sit at thirty-nine cards, untouched, for the rest of the
game. Everything about how freely a bot spends hangs off `beingRefilled(view)`,
not off `view.stock`. Getting this wrong livelocked games with a nearly full
deck: both bots thought their cards were free and traded whole sets for ever.

**A set goes down as a set.** There was a rule here that put one card down at a
time once the deck was dead, written against a real deadlock: dumping all three
of your aces sheds nothing if the next player cannot beat them, takes the pile
and hands all three back. Measured again, it is not what holds that up — 2000
games with it gone, heads-up and four-handed at every level, none failed to
finish, and they came out about a quarter shorter. What actually prevents the
ace trade is that a bot plays its LOWEST legal card, so it never leads with an
ace while it holds anything else. What the rule cost was a bot that put one 5
down, waited, and put the other 5 down next turn, which nobody watching reads as
caution.

The clamp that stays is the legal one: never more of a number than the pile will
take, since four in a row sacks it and a fifth is not a legal play.

**There is a deliberate breakout, and it is load-bearing.** Once a bot is not
being refilled it has a small chance of taking a pile it could have beaten. The
chance falls as the pile grows and rises the longer the game has gone on. It is
there because two players holding the last low cards with every 2 and 10 sacked
can trade the same handful for ever — a 9 on the pile blocks everything above it
— and no bot can see that it is going in a circle. Measured: without it, about 1
game in 250 never ended.

**Impossible counts the cards, and everything it counts is public.** Every card
in the pile went down face up in front of the room; so did every sacked card
before it went; the face-up cards are face up; and a pile somebody picks up is
watched by everybody as they take it. `view.pile.cards`, `view.sackedCards` and
`players[].knownCards` carry exactly that and nothing more — a card drawn from
the deck is unseen and never appears in `knownCards`. `countCards()` subtracts
the lot from the full deck to get what is unaccounted for. It is memory, not
X-ray vision, and there is a test that changing a hidden hand cannot change the
count.

**What the counting is FOR, and what it is not for.** The obvious use — work out
what the next player cannot follow and put them under — is worth almost nothing,
and that is measured, not assumed: it took Impossible from 53% against Hard to
50%, dead level. Making somebody pick up hands them an EMPTY pile and the lead,
which is the best seat at the table. What the count is actually worth is the
other direction: knowing when one of your own cards has quietly become
unbeatable. Once both aces are gone a king is as good as a 2, and a card like
that is an escape worth keeping for the moment you are stuck. That took it to
56%. `unbeatableness()` is the term that earns its place; the stranding term is
kept small and only fires against somebody about to go out.

**The rest of the ladder is slip rate, not cleverness.** Every other heuristic
worth having is in the one policy, and the levels differ by how often they
ignore it (`SLIP`). Reading opponents' face-up cards, hoarding specials harder,
spending a 9 to block, sharper openings — all tried, all measured, all made
Impossible worse. Over several thousand duels the ladder runs easy → medium 79%,
medium → hard 60%, hard → impossible 56%. If you change the policy, re-measure
HEAD TO HEAD: a five-way game is far too noisy to tell medium from impossible in
a few hundred games, and that is how the ordering got shipped upside down the
first time.

**Bots are lobby-only and never Master.** `eligibleForMaster` and `nextMaster`
both skip them, `conn/set` leaves them alone, and the stall machinery never
fires for them — they have no phone to lose.

**The ring stops at eight.** Past that `screens/sillyhead/table.js` switches to
two compact rows, because sixteen seats round one circle are too small to read
whatever the arithmetic says. Both paths keep the middle exactly where it is.

**The middle is usable here, and only here.** In Blob nothing small survives in
the centre of the table because every seat's played card lands within 28px of
it. Silly Head plays nothing to a seat, so the centre carries the deck and the
pile — and the pile is a button: on your turn it says "Take the pile", and when
you have nothing legal it is the only thing on screen you can tap.

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

Silly Head has its own set, in `HANDLERS` in `lib/sillyhead/game.js`. The two
lists never mix: a command aimed at the wrong engine comes back
`unknown-command` rather than doing something surprising, and there is a test
for that.

```
player/join  player/remove  game/setQuick  game/start  game/end  game/rematchStarted
sort/bin  sort/stack  sort/place  sort/take  sort/swap  sort/done
play/cards  play/takePile  play/flip  play/stalled  play/skipTurns
conn/set  conn/takeover
election/start  election/vote  election/resolve
```

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

### Hearing about errors

A phone that throws posts to `/api/oops`, and the server writes a line beginning
`[blob] a phone reported an error`. That happens always and needs no setup.

Emailing them as well is optional, and off unless BOTH of the first two are set.
Half-configured counts as off on purpose — an address with no key would fail on every
send and log a failure each time:

- `BLOB_ALERT_EMAIL` — where alerts go.
- `BLOB_ALERT_KEY` — a [Resend](https://resend.com) API key. Their free tier is far more
  than this needs.
- `BLOB_ALERT_FROM` — optional. Defaults to Resend's shared test sender, which works with
  no verified domain but may land in spam; set a real one once there is a domain.

**Emails are gathered for two minutes and then nothing is sent for half an hour**, and
that is the design rather than a tunable detail. The failure most worth being told about —
a render loop, a bad deploy — is exactly the one that throws hundreds of times a minute,
and one email each would turn the most useful signal this app has into something you
filter away. See `server/alerts.js`.
- **The free tier has no disk.** Games in progress and all history are lost on every
  redeploy and after ~15 minutes idle. Fixing this means a paid instance with a volume and
  `BLOB_DATA_DIR` pointed at it.

## Testing

`npm test` runs `node --test` over `test/`: Blob's rules (round sequences, scoring, bid
authority, corrections, elections, ties), the real HTTP and SSE surface, the bots, and the
QR encoder against pinned reference output.

`test/sillyhead.test.js` and `test/sillyhead-server.test.js` do the same for the
second game: the pile rules one special at a time, the sort, the endgame, the
privacy boundary over a real socket, and a soak test that deals twelve
four-player games and plays every one of them out. `test/sillyhead-bot.test.js`
plays whole games with every seat driven by a brain, routed through the same
engine `server/room.js` uses, so a scheduling mistake surfaces there too. That last one is there for
deadlocks — a turn that never moves, or a player who is out and still dealt one
— which would otherwise surface as a hang in a pub rather than as a red test.

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
