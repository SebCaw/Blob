# Blob

A companion app for the physical card game **Blob**. It handles the bidding,
the scoring and the arguments; the cards stay on the table.

The app knows nothing about trumps, suits or tricks. It runs the bidding, locks
it, takes the results the Master types in, and keeps the leaderboard.

```
node server.js          # http://localhost:4100
```

No build step and no dependencies — Node's standard library and static files.
`npm install` is not needed; `package.json` exists only so hosts (Railway,
Render, etc.) auto-detect this as a Node app and know how to start it.

## The game

Everyone secretly bids how many tricks they will win, before every round. The
hand size counts down from the starting size to one and back up again, so a
7-card game is 13 rounds: `7 6 5 4 3 2 1 2 3 4 5 6 7`.

You score **only** if you win exactly what you bid, and then you get
`10 + tricks won`. Missing by one is worth the same as missing by five: nothing.

## How it fits together

```
lib/          the rules, pure and testable  (no I/O, no clock, no network)
server/       rooms, the command queue, SSE, persistence, HTTP
server.js     the entry point
public/       the app: vanilla ES modules, no framework
test/         node:test
```

**`lib/` is the game and nothing else.** `applyCommand(state, command, ctx)`
returns a new state or a refusal, with `now` and `newId` injected — so the rules
can be driven at speed in tests, and a future digital-cards mode could reuse the
file unchanged.

**`server/` is what makes it safe with several phones on it.** Each game has a
serialized command queue, so two bids landing at the same instant are applied
one after the other and the round locks exactly once. Every command carries an
id, so a double-tapped button is a no-op rather than a second round.

**`public/` draws whatever the server says.** There is no game logic in the
client at all, and nothing is applied optimistically: a bid that appeared to
land and then did not would be far worse than one that takes 40ms.

## Real-time

Push is **Server-Sent Events**; commands go up as ordinary POSTs.

WebSockets would buy sub-100ms duplex latency this app never uses. SSE gives
push with browser-native reconnection, copes with phone networks and proxies,
and needs no dependency. The server sends a heartbeat every 10 seconds as a real
event (not an SSE comment) so the client can tell a quiet game from a connection
that has silently died — the case that actually bites on mobile.

**The client answers each heartbeat with a `POST /api/ping`, and that pong is
load-bearing.** SSE only pushes, so a phone that drives into a tunnel leaves the
connection half-open and the server's writes keep succeeding into a socket
nobody is reading — for minutes. Without the pong the Master would never be
offered a dropped player's bid, and a vanished Master would never trigger an
election. A closed socket is still the fast signal; the missing pong is the
backstop. (Which is why the presence timeout must stay comfortably longer than
the heartbeat: set it shorter and every phone is dropped in the gap between two
beats. The server raises anything too low rather than obeying it.)

The server broadcasts a **full snapshot** on every change rather than deltas.
Games are a few KB, and it means reconnecting is just "here is the current
state" — you always land on the right screen, whatever you were doing.

### What each phone is allowed to see

`lib/view.js` is the privacy boundary. While bidding is open, other players' bid
*values* are not merely hidden in the UI — **they never leave the server**. The
Master sees who has submitted, never what. Election votes work the same way.

## Disconnections

| What happened | What the app does |
|---|---|
| A phone drops out | 45 seconds to come back. A submitted bid is never lost. |
| It does not come back | The Master may enter that player's bid, marked **Entered by Master**. |
| The **Master** drops out | After the same window, the remaining players vote for a new one. |
| A tied vote | A runoff between the tied players. |
| A runoff that cannot narrow | Two eligible voters, neither able to vote for themselves, tie forever — so an unchanged runoff resolves on seniority instead of looping. |
| One player left | Promoted outright; there is nobody to choose between. |
| The Master returns before any vote is cast | They keep it. A 45-second blip should not cost them the game. Once a vote is cast, the election stands. |
| The server restarts | Games in progress are read back off disk and the phones reconnect themselves. |

A Master election is deliberately **not** a phase — it is a parallel object. The
Master can vanish after the results are in but before the round moves on, and
the round underneath has to survive that.

## Players without a phone

The Master adds them in the lobby. When it is their turn to bid, the Master
hands the phone over: the offline player picks their own bid in private and
hands it back. The Master never chooses it for them — that distinction is
enforced in the reducer, not just the UI, and it is recorded in the history.

## Rematches

**"Play again" on the Master's complete screen carries the group straight into
a new game — nobody but the Master touches a code.** A fresh lobby is created
with the same starting hand size, and everyone still reachable is seated in it
automatically:

- Every connected player's phone is redirected on its own, with a short
  "X started a new game!" beat before the swap.
- A no-phone player travels with the Master, exactly as before.
- A player who had disconnected before the rematch was started cannot be
  reached — nothing is listening on their behalf — so they are left off. Their
  own screen shows the new game's code with a one-tap Join, for whenever they
  come back.

The mechanics: the finished game's state carries a public `rematchGameId` /
`rematchCode` (never a token — that would be a bearer credential broadcast to
everyone in the room). Each carried-over player fetches their **own** seat via
`POST /api/games/:id/rematch-session`, proving who they are with their old
session, the same authentication every other action here uses. A double-tapped
"Play again" is idempotent — the same rematch is handed back, not a second one.

## Configuration

| Variable | Default | |
|---|---|---|
| `BLOB_PORT` | `4100` | |
| `BLOB_HOST` | `0.0.0.0` | |
| `BLOB_DATA_DIR` | `data` | live snapshots and finished games |
| `BLOB_GRACE_MS` | `45000` | reconnection window |
| `BLOB_ELECTION_MS` | `60000` | how long a ballot waits for stragglers |
| `BLOB_HEARTBEAT_MS` | `10000` | how often the server pings each phone |
| `BLOB_PRESENCE_MS` | `25000` | silence before a phone counts as gone (raised to 2.5× the heartbeat if set lower) |

## Tests

```
node --test          # or npm test
```

Covers the rules (round sequences, scoring, bid authority, elections, ties) and
the real HTTP and SSE surface — simultaneous bids, duplicate submissions,
disconnection and takeover, elections, restart recovery, and the fact that a
hidden bid never appears in anyone else's payload.

The QR encoder in `public/qr.js` is written out rather than pulled in as a
dependency, so it was checked against a reference encoder across 639 random
strings covering every version it supports. That found two real defects: the
format bits were being laid down in reverse, and version 10's wider character
count was still being written as 8 bits. `test/qr.test.js` pins the verified
output so neither can come back.

## Not built, on purpose

No digital cards, dealing, trump or trick detection, and no landscape mode. The
physical game handles all of that. `lib/` is structured so a future digital mode
could reuse the players, rounds, bidding, scoring and multiplayer plumbing, but
none of that shapes the app today.
