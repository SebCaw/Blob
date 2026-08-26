# Silly Head: what is left

This started as twelve items from Seb playing real games and screenshotting what
was wrong. **Seven of them are done.** They are listed anyway, briefly, so that
nobody re-opens a settled question or re-fixes something already fixed.

Everything here is UI and UX. The rules, the reducer, the privacy boundary and
the bots all work and are not in scope unless an item says so.

Read `CLAUDE.md` for the house conventions and `SILLY-HEAD.md` for the rules as
this family plays them. `ADDING-A-GAME.md` covers the platform.

`npm test` is `node --test`. Run it before you start so you know the baseline is
clean, and again before you commit.

---

## Done, do not redo

1. **The confirm screen heading** now reads first instead of sitting under a
   spacer that centred it on a tall phone. `sillyhead/sort.js`.
2. **Swapping a face-up card during the sort** — `sort/swap` exists in
   `lib/sillyhead/game.js` as one atomic command, rather than the client firing
   take-then-place and flashing the empty-pile state in between.
3. **The Sound line in Settings** branches per game (`screens/settings.js:36`).
   It used to promise tricks and bids to a game that has neither.
6. **Selected no longer looks the same as playable.** A chosen card is lifted out
   of the fan, not merely outlined — a border is invisible exactly where cards
   overlap, which is where a chosen one sits.
7. **Tapping a card selects every one of that number**, capped by how much room
   is left in the run, and further taps add or drop them one at a time.
   `sillyhead/table.js:772`.
11. **The table screen's height.** All four causes dealt with: your own table is
    no longer drawn twice, the ring's box no longer claims height it does not use
    (`.sh-play .table__ring { aspect-ratio: auto }`), and seats are clamped so
    none falls off a narrow screen (`ringX = Math.min(RING_X, ...)`).
12. **The wooden spoon no longer parks centre** with the loser's name shoved
    against the edge — the `margin: 0 auto` that caused it is gone. The rest of
    item 12 is still open, below.

---

## Still open

### 4. Seat face-up cards are too small and do not scale

`sillyhead/table.js:307`. Hardcoded to `size: 'xs'` regardless of how many people
are playing. With three players there is room for them to be much bigger; with
eight there is not. Scale to the seat width, the way `seatWidthPct` already
scales the seat itself.

### 5. The Silly Head table has no measured scroll hatch

`styles.css:186` still carries `html[data-size] .screen--fixed { overflow-y: auto }`,
which is keyed on the TEXT SIZE somebody picked rather than on whether the screen
actually overflows. So at Normal the table clips instead of scrolling, and
raising the size silently turns a screen that is meant to always fit into a
scrolling one.

The pattern to copy already exists twice — `spillIfNeeded` in
`screens/chase/table.js` and `screens/cheat/table.js`. It measures after paint
and only then adds `screen--spill`. The Silly Head table has neither.

### 8, 9, 10. Cards never travel

There are three keyframes in the whole game — `sh-land`, `sh-sack-pop` and
`sh-wanted` — and none of them moves a card from one place to another. So you
cannot tell who played, and a pile being picked up or sacked just blinks out of
existence. Wanted:

- a card flying from the player's seat into the middle pile
- the whole pile flying to whoever picks it up
- the whole pile sweeping off to the sack pile

Seats carry `data-player-id`, which is how you find the start and end points.
Two traps that have already bitten in this codebase:

- Every state the server pushes rebuilds the whole screen, so anything keyed on
  "this render is different" replays on every repaint. Gate on a key plus a time
  window — `freshEvent` in `screens/cheat/table.js` is the current shape of it.
- Measuring happens in screen pixels, but transforms inside the zoomed subtree
  are in its own pixels. Divide by `uiZoom()` from `public/size.js`.

Honour `prefers-reduced-motion`.

### 12 (the rest). The loser row is painted as an error

`.sh-loser` at `styles.css:3391` is still `outline: 2px solid var(--bad)` over a
red tint. Blob already made this call the other way — `board-row--spoon` is a
warm brown, on the stated grounds that a wooden spoon is a joke among friends —
so the app currently contradicts itself.

**This now affects Cheat too.** `screens/cheat/over.js` reuses `.sh-loser`, as do
Sevens and Chase the Ace, so fixing it here fixes all four.

Still outstanding alongside the colour: the loser gets no place number and no
initials badge while every row above gets both, so they do not read as part of
the same list; and the spoon is 24x30, smaller than the name beside it, so the
gag barely lands.

---

## Not on the list, but do not lose

- **Bots appeared to stop playing once, and a refresh fixed it.** Never
  reproduced. A refresh fixing it points at a dropped SSE stream rather than
  stalled bots, so do not go hunting speculatively. If Seb hits it again, the
  question that splits the two cases is whether the OTHER players' cards keep
  moving while his do not.
- **Stacking during the sort is uncapped and stays that way.** Seb confirmed 3x
  and 4x are both fine.
- **The medium-to-hard bot rung is nearly a coin toss** — 53.4% over 1200 duels.
  Real, measured, and written up in `SILLY-HEAD.md`. Not a bug, but it is why the
  ladder test no longer asserts that rung.
- **The app still needs a name.** It is a card site now and Blob is one game of
  five. House Rules, Card Table, Felt and Kitty have been offered. The Render URL
  stays as it is until there is a paid instance and a custom domain, so a rename
  touches the app only.

---

## Before you commit

Run the tests, look at every screen you touched in a real browser at all three
size settings, and check the console. Most of this list only exists on the glass,
so a green test run proves very little about it.
