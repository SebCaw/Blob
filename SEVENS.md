# Sevens

Also played as Fan Tan, Domino or Parliament. The third game.

The rules as the house plays them, and the screen design agreed with Seb before
any code existed. Read `ADDING-A-GAME.md` for the platform checklist and
`CLAUDE.md` for the house conventions. **Keep this file current** — it is the
only place the house rules are written down.

**Built, not yet looked at.** The engine, the privacy boundary, the bots and all
four screens exist and a whole game runs end to end through the reducer. What has
NOT happened is `npm test` and a browser — Seb asked to hold off, so every claim
below about how it looks on a phone is a claim about the code, not about the
glass. The first thing anybody picking this up should do is the two browser
checkpoints in `ADDING-A-GAME.md`.

---

## The rules

One standard deck, dealt out entirely between three and eight players. Hands are
uneven when the deck does not divide, and that is fine.

**The sevens are the spine.** Each suit starts when its seven is played, and from
there builds outward in **both directions independently**: eight, nine, ten
upward toward the king, and six, five, four downward toward the ace. A suit whose
seven is not yet down cannot be touched at all.

**The seven of diamonds leads.** Whoever holds it plays it first, and play passes
left.

**You must play if you can.** If you hold a legal card you play it. You pass only
when you genuinely have nothing, and the app decides that for you rather than
offering it as a choice — see The pass button below.

**Ace is low.** The downward run ends three, two, ace. This matters more than it
sounds: `lib/deck.js:19` orders `RANKS` with the ace **high**, so Sevens cannot
reuse the shared rank ordering the way Silly Head does. It needs its own.

**No score.** First to shed everything wins, play continues to settle the order,
and the last player still holding cards gets the spoon. This reuses Silly Head's
end-screen shape rather than Blob's leaderboard — Blob is the scored game and the
app does not need two.

**Three to eight players.** Two works mechanically and is a poor game.

---

## The screen

Agreed from mockups. The table is **vertical columns, not rows** — one per suit,
every seven sitting on one shared baseline, kings growing up and aces growing
down.

This was Seb's call and it is load-bearing rather than cosmetic. A completed suit
is thirteen cards; laid horizontally that needs about 306px against roughly 281px
of usable width at the Largest size setting, so **a finished suit overflows, and
in Sevens every suit finishes** — it is the normal end state, not an edge case.
Vertically the same thirteen cards are 327px deep at `card-face--lg` and four
columns are only 248px across, which the phone has. Height was never the
constraint here; width was.

**Details that came out of the mockups:**

- **Suit order, left to right: hearts, spades, diamonds, clubs.** Red, black, red,
  black. The hand uses the same order so the two read together.
- **The hand sorts** by that suit order, ascending within each suit.
- **Ranks sit in the top-left** so an overlapped card can still be read. Already
  solved in the card component — commit `5fac688`, "Numbers in the top left, so an
  overlapped hand can be read".
- **The end card of each column also carries a large centred rank**, because it is
  the only card in the column not overlapped by another, and it is the card that
  matters — it is what the suit will accept next.
- **A suit with no seven yet** shows a dashed empty slot with its seven greyed in
  it. That teaches the rule without a help screen.
- **A completed suit stays as a full column.** An earlier mockup folded it back to
  a single stack; Seb rejected that.
- **The felt takes the slack.** The felt is `flex: 1` with the columns centred
  inside it, so leftover height becomes space around the cards and redistributes
  itself at every text size. Do not push the hand down with a spacer div — that
  was the first mockup's mistake, and it is the same fault as item 11 on Silly
  Head's list: a stack that hopes to fit rather than one told how to distribute.
- **The hand is fanned, not filed.** Cards sit at slight angles, roughly -11 to
  +11 degrees, with the lift on playable cards varied a pixel or two so they do
  not line up on a ruler. Seb asked for this specifically: it should look like
  cards someone is holding. It also happens to lift each top-left index clear of
  its neighbour.
- **Every card needs its edge.** `.card-face` already carries
  `2px solid rgba(0,0,0,0.18)` and a drop shadow (`styles.css:1658`). Without it,
  overlapping white cards merge into one white sheet with numbers on it — which
  happens in the columns as readily as in the hand.

### The header

Seb wanted the top doing work, the way Blob's does — it is what makes the screen
feel like a family game rather than a board. Blob's grammar, carrying Sevens'
facts:

- **Four suit pips** where Blob has round pips, lit once that suit's seven is
  down and dim while it is closed. The dark clubs pip tells you at a glance why
  that column is empty.
- **A large card count** on the left, exactly like Blob's "3 cards".
- **Two pills**: cards played, and players still holding.
- **A status line** in the accent colour, where Blob says "You lead this hand".

### The pass button

There is no button while you have a legal move — you tap the card and it goes.
When you have nothing, every card dims (the existing `card-face--blocked`
treatment, `styles.css:1979`) and a **Pass** button takes the action row.

So Pass is never a choice, it is the app telling you there is nothing to do. That
is what must-play buys: a voluntary-pass rule would need the button present on
every turn, where it tempts people during turns they could play, and the dimming
would stop meaning "you cannot" and start meaning "you probably should not".

---

## Animations

**Seb asked for animation throughout, from the first commit.** Take that
seriously: items 8, 9 and 10 on Silly Head's list are three animations that were
wanted, never built, and are now a separate job on a screen that is already too
tall. Cards that never travel mean you cannot tell what just happened or who did
it.

What needs to move:

- **The deal** — cards out to each player at the start.
- **A card played** — travels from the player's seat or hand into its place in the
  column. The seat elements carry `data-player-id`; that is how you find the start
  point.
- **A suit opening** — the dashed slot fills as the seven lands, and its header
  pip lights.
- **The column growing** — the stack extends and the large centred rank moves to
  the new end card.
- **The hand closing up** — when a card leaves, the fan re-flows into the gap
  rather than jumping. Measure first, move second.
- **A pass** — visible, or a passed turn looks like nothing happened.
- **A player going out** — their last card leaving, and their name settling into
  the finishing order.
- **A suit completing** — small, once, and not a whole-screen event; four of them
  happen every game.
- **The end screen** — the order, and the spoon.

### The traps, all of which have already bitten this codebase

- **Every state the server pushes rebuilds the whole screen**, so anything keyed
  on "this render differs from the last" replays on every repaint. Gate on a
  remembered key **plus a time window** — copy `screenKey` with `ENTER_MS`
  (`app.js:625-643`) or `LAND_MS` in `sillyhead/table.js`. One action renders
  three times: the tap, the state landing, the request settling.
- **Measuring happens in screen pixels; transforms inside the zoomed subtree are
  in its own.** Divide by `uiZoom()` from `public/size.js`. `fitSeats` and
  `fitFan` both do this.
- **`requestAnimationFrame` does not fire in a hidden tab**, and every fitter is
  scheduled that way. Nothing load-bearing may sit behind one.
- **Honour `prefers-reduced-motion`.**

---

## Before the code

- **The fan rotation is not in the app today.** `.hand__card` sets `margin-left`
  and a vertical lift only (`styles.css:1966`), and `.hand` is shared with Blob
  and Silly Head. Make the rotation an opt-in `.hand--fanned` rather than changing
  the base — most of Silly Head's list came from shared CSS written for one game,
  and Blob's forehead round uses that same hand.
- **Rotation widens a card's bounding box**, so `fitFan` (`common.js:96`) will
  measure slightly narrow and the squeeze will engage later than it should. Shows
  up with eight cards on a narrow phone.
- **The upward and downward halves of a column need opposite z-order.** Going
  down, each new card sits on top offset downward and shows its own top-left
  index — the ordinary tableau. Going up, that is backwards: a higher card on top
  would cover the index of the card below it, so the upward half draws in reverse,
  card nearest the seven frontmost, each higher card peeking out above. Same look
  both directions, opposite z-order, and easy not to notice until a column is six
  deep.
- **Sevens has no hidden information beyond hands.** The tableau is entirely
  public — no face-down cards, no claims, no bluffs. That makes it the right first
  game of the five: it exercises the whole path (room, join, turn order, SSE,
  reconnect) while putting the simplest possible load on the privacy boundary. It
  validates the cross-engine privacy harness without stressing it. Cheat is the
  opposite and comes after.
- **Hue: 205.** Clear of Blob's 265 and Silly Head's 148, and inside the usable
  arc — see the hue budget in `ADDING-A-GAME.md`. The accent should derive from
  the hue rather than being hand-picked; that decision is open and recorded there.
