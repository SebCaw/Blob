# Silly Head

The second game on the shelf, and it is built. This file is the agreed
specification: the rules as they are played in the house, the decisions taken,
and what is still open. It was written before any of the game was built, so that
nothing agreed in conversation lives only in a conversation — and it is kept
current, because it is the only place the house rules are written down.

For working *in* the code, see the Silly Head section of `CLAUDE.md`.

Silly Head is the family-friendly name for the game usually called Shithead, and
also published as Palace, Karma and Shed. The house name is the one on the tile;
the other names belong in the blurb so anybody who knows the game recognises it.

---

## What it is

A shedding game. There is no score. You get rid of your cards, and the last
person still holding any is the Silly Head. **The first person out wins.**

This matters structurally: **Silly Head has no rounds.** One shuffle, one deal,
play until one person is left. Blob is built around a sequence of rounds with a
running total carried between them, and none of that applies — which is why this
is a separate reducer rather than a third mode of Blob.

---

## The deck

The deck is **shared by everybody and shuffled once, at the very beginning**.

Two decks is the standard game. More players means more decks, scaled rather
than asked about:

| Players  | Decks |
| -------- | ----- |
| 2 to 8   | 2     |
| 9 to 12  | 3     |
| 13 to 16 | 4     |

One deck per four players, minimum two.

A **quick game** is one deck, 2 to 4 players, and no more — one deck will not
stretch further once nine cards each have gone out.

Two decks means **duplicate cards**: two identical seven of hearts in play is
expected and fine. Card ids therefore carry a copy number (`10H#1`, `10H#2`),
which is never shown to anybody and exists only so two identical cards can be
told apart when one of them is played.

---

## The deal

Nine cards each:

- **three face-down**, which you never see until you play them
- **three face-up**, sitting on the face-down three
- **three in hand**

Whatever is left is the stock.

---

## The sort

Before play, everybody arranges their table at the same time. This is a house
rule and it is the most unusual part of the game.

- You **bin any 3s**. Only during the sort — once play starts a 3 is just a card.
- The binned 3s do not leave the game: they **start the pile in the middle**.
  - If **four 3s** end up there, the pile is sacked before anyone plays.
  - Otherwise the first player simply plays on top of them.
  - If somebody picks the pile up before it is sacked, they get the 3s too.
- You **stack pairs** on your piles. Two 5s go one on top of the other.
  - Stacking is **temporary**. Its whole purpose is to let you draw more cards
    from the stock and fish for something better to finish with.
  - Stacking leaves you a pile short, so you put a card from hand down to keep
    three piles, then refill your hand to three from the stock.
  - You may stack a card you have just drawn.
  - As built, a card may be stacked from your hand **or** from another pile, and
    every action refills your hand to three. Both routes end in the same place —
    one more card drawn per pair — and doing it from the hand is the same move a
    person makes at a table when the pair spans their hand and their table.
  - It ends when nothing can be doubled any more. (Rare.)
- You **swap** by tapping a card in your hand and then tapping one that is
  already face up: the two trade places. It is one command on the server
  (`sort/swap`) rather than a take followed by a place, so the pile is never
  briefly empty, the screen never nags you to fill it, and a request that goes
  missing cannot leave you a card short. A swap is card-neutral, so it earns no
  draw — stacking a pair is what does that.
- Then **every pair comes off** and goes to your hand, leaving exactly **three
  single face-up cards**. They do not have to be different ranks — two 10s and a
  king is a fine finish. You take them off yourself: the app refuses to start
  while anything is still stacked, rather than unstacking for you, because which
  card you leave showing is the decision the whole sort exists to make.
- You start the game holding **more than three cards**, and that is normal.

The stock is shared, so the sort is a scramble: **whoever grabs the top card
gets it.** The server's command queue already serialises everything, so the
first request in genuinely wins and two people can never take the same card. It
only bites at the very tail of the stock, and with two decks that is a long way
off.

If the stock runs dry during the sort, the sort simply ends.

---

## Play

Turns go round the table. The **first leader is random**.

- The leader plays anything. Everybody after plays **equal or higher**, ace high.
  You do not have to go one up — skip as far as you like.
- You may play **any number of cards of the same rank at once**, up to four.
- **You draw back up to three after your turn while the stock lasts.** More than
  three in hand is fine; fewer is not.
- **If you cannot go you pick up the whole pile**, and your turn ends instantly.
- **You may also pick the pile up on purpose**, when it is worth having.

### The special cards

| Card   | What it does |
| ------ | ------------ |
| **2**  | Plays on anything. Resets the pile — the next player plays anything. The pile stays underneath. |
| **10** | Plays on anything. **Sacks** the pile: gone from the game for good. You go again on a clean slate. |
| **9**  | Plays **in order**, like any other card. But the next card placed must be **9 or lower** — except a 2 or a 10, which always go. The restriction applies to the next card only; normal rules resume from whatever lands. |
| **3**  | Nothing special. It is simply the lowest card, so it only lands on a 2, a 3, a 9, or an empty pile. |

**Four of one number sacks the pile**, whether one person lays all four or they
accumulate in a row across several turns — two 4s, then a 4, then a 4. Whoever
completes the four goes again on a clean slate.

**A run never goes past four.** You hold three 4s and two 4s are already on top:
you may play one, which is the fourth, which sacks. You may never play five or
more of a number.

A sacked pile is out of the game entirely. The house calls it **the sacked pile**.

### When somebody picks up

The pile is empty, so the player to the **left of whoever picked up** leads the
next card, and may lead anything.

---

## The endgame

The six cards on the table are ignored until the **stock is fully used up**.

Once the stock is gone and your hand is empty:

1. **Your three face-up cards.** Play them like a hand. If you cannot go, you
   take the pile **plus one of your face-up cards** into your hand, and play from
   hand until it is empty again.
2. **Your three face-down cards.** On your turn you turn one over. If it beats
   the pile it is played. If it does not, you take it and the pile into your hand.

**Combining hand and table:** only your genuinely last hand card may be played
together with matching face-up cards. Holding a 5 and a 6 you cannot; play the 6
first and then, holding only the 5 with three 5s showing, you may play all four —
which is four of a number, so it sacks and you go again.

Players who shed everything are **out for good**. Play carries on until one
person is left holding cards. That person is the Silly Head.

---

## Decisions taken

- **Voluntary pick-up never costs you a face-up card.** Losing one is the penalty
  for being stuck. The server knows whether you had a legal move, so it can tell
  the difference and nobody can dodge the penalty by claiming they chose to.
- **Bots at four levels: Easy, Medium, Hard, Impossible.** Driven from
  `viewFor(state, botId)` — the same redacted payload a phone gets — so a bot
  cannot see anyone's hand, and cannot see its own three face-down cards either.
  Structural, not a promise. They sort their own table through the same commands
  a phone sends.
- **Impossible remembers every card that has been played.** The pile, the
  sacked cards and anything the room watched somebody pick up are all public —
  they went face up in front of everybody — so it works out exactly what is
  left. It is memory, not X-ray vision: a card drawn from the deck is unseen and
  stays unseen.
- **What it does with that is keep its escapes.** Putting the next player under
  turns out to be worth almost nothing, because they pick up and then lead an
  empty pile, which is the best position in the game. Knowing that both aces
  have gone and your king is now unbeatable — that is worth something, and it is
  what the counting is spent on.
- **The other three levels differ by how often they slip.** Same policy,
  followed more reliably the further up you go. Measured over several thousand
  head-to-head games: Easy loses to Medium 79% of the time, Medium to Hard 60%,
  Hard to Impossible 56%.
- **No table mode.** Silly Head is online only, with the app dealing. There is no
  score to keep, so a mode where you deal real cards would have nothing to do.

---

## How it looks

- **Hue 148** — deep green, with the amber accent. Set in `public/games.js`; the
  game gets a hue, never a hand-picked palette. See `CLAUDE.md`.
- **The middle of the table is usable here.** In Blob nothing small survives in
  the centre, because every seat's played card lands within 28px of it. In Silly
  Head nothing is played to a seat — it all goes to one pile — so the centre is
  free for the first time.
- **A neat pile and a messy pile.** The stock sits as a neat pile; the played pile
  sits messily to its right, carrying **a count of how many cards are in it**,
  always visible. You cannot decide whether to take the pile without knowing what
  you are taking.
- **The pile is the button.** On your turn it reads "Take the pile" and tapping it
  picks up. With no legal move it is the only thing on screen you can tap, so it
  stops being a decision — which is right, because then it is not one.
- **Cards travel.** A played card flies out of the seat that played it, a pile
  that somebody takes flies to them, and a sacked pile sweeps off to the count in
  the corner. Without it the middle simply changes and you cannot tell who did
  it. The server writes down what happened — who, which cards, how many — and all
  of it is public, because the room watched every one of those cards go down.
- **A tap takes all of a number.** Tap an 8 and every 8 in your hand comes up
  together; tap a lifted one to drop it back. One card with nothing to add to it
  simply goes, so the button underneath only appears for a pair or more, where
  the count is worth reading before you commit.
- **Sixteen seats.** Blob's ring maxes out at eight. Silly Head keeps the ring up
  to eight and switches to two compact rows above and below the pile beyond that,
  so four families of four can play.

---

## What was built

1. **The rules, pure and tested.** `lib/sillyhead/deck.js` (multi-deck dealing
   and the seeded shuffle), `rules.js` (the pile, the specials, the run rule) and
   `game.js` (the reducer: the sort, turn order, pick-ups, the hand to face-up to
   face-down progression, going out, and the last one left).
2. **The server, made game-agnostic.** `lib/engines.js` picks the rules from
   `state.game`; `server/room.js` no longer requires Blob's directly. Both games
   share rooms, sessions, SSE, the command queue, presence and Master election.
   `lib/sillyhead/view.js` is the privacy boundary.
3. **The screens.** `public/screens/sillyhead/` — the front page, the lobby, the
   sort, the table and the end. The shelf row is switched on at hue 148. Bots
   are added in the lobby, and "On your own" deals you three of them in one tap.
4. **The tidying.** New modules in `SHELL` in `public/sw.js`, Ask Blob taught the
   rules in `public/screens/help-sillyhead.js`, `README.md` and `CLAUDE.md`
   updated.

**Tests:** `test/sillyhead.test.js` (the rules, the sort, the endgame, the
privacy boundary, and a soak test that plays twelve dealt games out to a Silly
Head), `test/sillyhead-server.test.js` (creation, joining and the deal over the
real HTTP and SSE surface, with the redaction asserted on the wire) and
`test/sillyhead-bot.test.js` (whole games with every seat driven by a brain, the
bot seed never leaving the server, and the ladder pointing the right way).

---

## Still open

- **Hard and Impossible are close.** 56% over more than a thousand duels, which
  you may still feel as "about the same". Making Impossible genuinely frightening
  needs a brain that looks ahead rather than another rule of thumb; seven of
  those were tried and only one of them helped.
- **A game can, very rarely, go round in circles.** Two players holding the last
  low cards with every 2 and 10 already sacked can trade the same handful
  indefinitely, because a 9 on the pile blocks everything above it. This is a
  property of the game, not of the app — a real table could hit it too. The bots
  break out of it deliberately (see `CLAUDE.md`), so a game against them always
  ends; four humans in that position would have to agree something themselves.
- **The name of the app.** It is called Blob, but Blob is now one game of
  several. The shelf is titled "Card games" and nothing has been renamed. Blob
  keeps its name as a *game*; only the app around it would change. Under
  consideration: House Rules, Card Table, Felt, Kitty. The user is thinking about
  it.
- **The Render URL** (`blob-nm9h.onrender.com`) is deliberately **not** part of any
  rename. Changing it breaks every QR code and link already shared, and the Replit
  mirror. The moment to change it is when a paid instance and a proper domain
  arrive — one move instead of two.
