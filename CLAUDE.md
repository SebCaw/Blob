# Working on Blob

The README explains what Blob is and how it fits together — read it first. This file is
about working *in* the code: the invariants that must not be broken, and the mistakes that
have actually been made here.

## Commands

```bash
node server.js     # http://localhost:4100 — no build step, no install needed
npm test           # node --test, 86 tests
node --check <f>   # quick syntax check on a single file
```

There are **no dependencies**. `package.json` exists so hosts detect a Node app and know
how to start it. Keep it that way — a dependency needs a real argument, and the QR encoder
in `public/qr.js` was written out by hand rather than pulled in.

Run a local server on a spare port with its own data directory, never the default:

```bash
BLOB_PORT=4200 BLOB_DATA_DIR=/tmp/blob-scratch node server.js
```

## The three invariants

**1. `lib/` is pure.** `applyCommand(state, command, ctx)` returns a new state or a
refusal. No I/O, no clock, no network, no randomness — `now` and `newId` arrive through
`ctx`. This is what makes the rules testable at speed, and every test depends on it. If
something in `lib/` needs the time or a random number, inject it through `ctx`; do not
reach for `Date.now()` or `Math.random()`.

**2. `lib/view.js` is the privacy boundary.** A value that a player is not allowed to see
must be **absent from the payload**, not merely hidden by the UI. Bid values while bidding
is open, and election votes, already work this way. `test/server.test.js` asserts that a
hidden bid never appears in anyone else's payload — that test is load-bearing, and any new
secret needs its equivalent.

**3. The client draws what the server says.** `public/` holds no game logic and applies
nothing optimistically: a bid that appeared to land and then did not would be far worse
than one that takes 40ms.

There is exactly **one** deliberate exception, in `public/screens/lobby.js`: the starting
hand size moves locally while the Master is tapping and the server is told once the tapping
stops. It is a lobby setting rather than anything scored, only the Master can change it,
and a refusal puts it straight back. Do not widen this exception without the same
reasoning.

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

**`h()` in `public/ui.js` takes text, never markup.** `text:` sets `textContent`; there is
no way to inject HTML, which is what keeps a player called `<script>` uninteresting.
Props starting with `on` become `addEventListener`. Inputs keep their focus across renders
via `data-focus-key`.

## Adding a command

Commands live in `HANDLERS` in `lib/game.js`. The current set:

```
player/join  player/addOffline  player/remove
game/setHandSize  game/acknowledgeDeck  game/start  game/end  game/rematchStarted
bid/submit  results/submit  results/amend  round/next
conn/set  conn/takeover
election/start  election/vote  election/resolve
```

Every refusal message is shown to a player as-is, so write it in plain English. Give a
`code` only when the client needs to branch on it. Commands that could be double-tapped
must be idempotent — a second tap is a no-op, not an error.

## Things that are easy to get wrong

- **Add new client modules to `SHELL` in `public/sw.js`.** Caching is network-first so a
  miss is survivable, but the shell should list every module.
- **Leaving a running game is one-way.** `leaveGame()` clears the session and
  `player/join` refuses once a game has started, so there is no way back in. Anything that
  discards a session mid-game needs to ask first.
- **A player's seat is worth keeping until it is replaced.** Do not clear a session on the
  way to joining a different game — only once the new join has landed.
- **A one-card round still has trumps.** No-trumps only happens when a deal consumes the
  whole deck and there is no card left to turn.
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
authority, corrections, elections, ties), the real HTTP and SSE surface, and the QR encoder
against pinned reference output.

Anything touching scoring or the round structure needs tests before it ships — a wrong
score is the one bug this app cannot afford, since settling arguments is its entire job.
Drive whole hands through the reducer rather than testing handlers in isolation; the
helpers at the top of `test/rules.test.js` make that cheap.

The repo is LF. On Windows, git warns about CRLF on checkout — harmless, and the diffs stay
clean.
