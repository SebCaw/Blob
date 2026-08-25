# Chase the Ace

The fourth game. The rules as the house plays them, and the design agreed with
Seb before any code existed.

Read `ADDING-A-GAME.md` for the platform checklist — especially "What building
Sevens actually cost", which is the part written from scars — and `CLAUDE.md`
for the house conventions. **Keep this file current.** It is the only place the
house rules are written down.

Nothing here is built yet.

---

## A note on the name

The house calls this Chase the Ace, and that is what goes on the tile. It is
worth knowing that the game usually published under that name is a different one
— Chase the Ace, Ranter-Go-Round or Cuckoo is a one-card pass-or-keep game where
the lowest card loses a life.

What this file describes is the game usually called **Old Maid** (also Pass the
Lady, Black Peter, Schwarzer Peter), played with an odd ace instead of an odd
queen. The published names belong in the tile's `blurb`, the way Silly Head lists
Palace, Karma and Shed — so anybody who already knows it recognises it, and
nobody has to hear a name the family does not use.

`ADDING-A-GAME.md` described the pass-or-keep game under this heading. That entry
has been corrected, or a later session would have built the wrong thing.

---

## The rules

**The deck has one odd card and everything else pairs.** Aces are removed until
exactly one is left, so the ace is the odd card and everybody knows it. That is
the point: this is not a game of finding out what the odd card is, it is a game
of not being caught holding it.

**Deal the lot.** Every card goes out, hands are uneven, and that is fine.

**Pairs go in the middle.** Two cards of the same rank are a pair, whatever their
suit or colour. Hold three of a rank and you bin two and keep one; hold four and
you bin two pairs. This happens **on the deal, automatically** — with rank-only
pairs there is never a choice about what to discard, so it is not something to
tap through. Animate it; do not make it a phase.

**Then it goes round.** The player to your left takes one card from your hand.
They cannot see it — they pick a POSITION, not a card. If it pairs with something
they hold, that pair goes in the middle. Then the player to *their* left draws
from *them*, and so on round the table.

So play passes left, and each player draws from the player on their right.

**Empty your hand and you are out, and safe.** This is how the table shrinks. It
also breaks the chain: if the player on your right has gone, you draw from the
next one along.

**It ends when everybody but one is out.** That last player is holding the ace,
alone. They are the Chase the Ace.

No score. The shape is the order people went out in and the one left holding it,
which is the same shape as Silly Head and Sevens — so it reuses their end screen
rather than Blob's leaderboard.

---

## The two decks

| | Cards | Aces removed | Players |
|---|---|---|---|
| **One deck** | 49 | 3 of 4 | 3 to 8 |
| **Two decks** | 97 | 7 of 8 | 4 to 12 |

Both leave exactly one ace, which is the only thing that matters: 49 is 24 pairs
and an ace, 97 is 48 pairs and an ace.

A Master's choice in the lobby, the same shape as Silly Head's standard-or-quick
(`lib/sillyhead/game.js:71`, `:83`, `:394`). Card ids already carry which deck a
card came from — `10H#2`, stripped in `public/cards.js:parseCard` — so the
two-deck version needs no new id format.

**Open: the minimum for the one-deck version.** Seb specified four for two decks
and did not say for one. Three is written above because two-player Old Maid is
nearly deterministic once the hands are small — you can work out most of what the
other person holds — but this needs confirming.

---

## The mind games

This is the part that makes it worth building, and the two halves of it pull
against each other on purpose.

**You can rearrange your own hand, and everybody watches you do it.** The cards
visibly move. That is deliberate: an arrangement nobody can see is not a bluff,
it is just an arrangement. Moving a card in full view — and knowing they saw you
move it — is the game.

**And there is a shuffle button, in the corner, which scrambles the lot.** After
it, nobody can track anything, including anything they had worked out before.

The two are a real decision rather than one being strictly better:

- **Shuffling is the safe baseline.** It hands the drawer a flat chance and takes
  every read away from them.
- **Arranging is the gamble.** It cannot beat random odds by itself — it can only
  beat them by convincing somebody to pick wrong. Sometimes it will, which is why
  anybody would ever choose it over the button.

If shuffling were the only option the game would be pure chance; if arranging
were the only option the better tracker would always win. Both, and it is a game.

### The rules that make it fair

**Your fan locks the moment it becomes the drawer's turn.** You arrange in the
window before that, not during. Without this there is a race between your reorder
and their tap that the command queue settles arbitrarily, and whichever way it
lands somebody feels cheated.

**A shuffle must be randomised on the SERVER.** `lib/` is pure, so the randomness
arrives through `ctx` like every other shuffle in this repo. A client-side
shuffle would put the permutation on the phone that asked for it, which is
exactly the phone that must not be trusted with it.

**A shuffle is broadcast as a shuffle, not as a permutation.** A deliberate move
sends "the card at 3 went to 0" — no identity, and trackable, which is the point.
A shuffle sends only that it happened. Even though the end state is random, an
animated card-by-card mapping would be followable frame by frame, and that would
quietly undo the one thing the button is for.

---

## The privacy boundary

Stricter than Sevens, and the strictest so far in this app.

**Positions are public. Faces are not.** Everybody can see how many cards you
hold and therefore how many slots there are to pick from. Nobody but you learns
what is in any of them.

**The drawer must never receive card ids for the hand they are drawing from.**
Not hidden by the screen — absent from the payload. This is the whole game: a
leak here means an opponent's client can simply avoid the ace, and no amount of
UI makes that safe.

What IS public, because the room watched it happen:

- how many cards each player holds
- that a card was taken, and from which position
- any pair that went into the middle, both cards
- that somebody rearranged, and which slot moved to which
- that somebody shuffled

What is never public:

- any card in anybody else's hand
- which permutation a shuffle produced

The one deliberate widening, as in Sevens: **at `complete` the hands are shown.**
The game is over, and seeing that the loser was sat on the ace for five turns is
the end screen's whole job. Phase-gated, key absent before then.

---

## The bots

More interesting here than in any game so far, because **the public move log is
real information** — moves are visible by design, so a bot that pays attention
has something honest to reason from.

- **easy** — takes a position at random, never shuffles.
- **medium** — random position, shuffles now and then.
- **hard** — avoids the slot a card was just moved to or added at, and shuffles
  when it is holding the ace.
- **impossible** — follows the visible moves properly, keeps a belief about where
  the ace is likely to be, and shuffles the moment it picks the ace up.

Same rule as everywhere: a bot is driven from `viewFor(state, botId)` and sees
exactly what a phone sees. "Impossible" must mean *tracks well*, never *sees the
hand* — and here that is a genuinely strong strategy rather than a consolation.

---

## What still needs deciding

- The one-deck minimum: three players, or two.
- Whether a bot's shuffle should be visible as a shuffle in the same way a
  player's is. It should, or watching a bot tells you less than watching a
  person, which reads as the bot cheating even when it is not.
- Whether to show a small marker on the slot a card was just added to. It is
  public information either way — the question is whether making it easy is
  making it too easy.
- Whether the arranging window needs a visible countdown, or whether "locks when
  they start drawing" is enough on its own.

---

## Before the code

- **Rank-only pairs, and the ace is identifiable from the start.** Nobody has to
  deduce what the odd card is, and the app must not pretend otherwise.
- **Hand ORDER is server state, not a client preference.** Every other game in
  this app treats hand order as presentation — `sortHand` runs on the server for
  tidiness, and nothing depends on it. Here the order is the game, so it is
  authoritative, and reordering is a command.
- **This is the first game where a player acts on somebody else's cards.** Every
  existing command touches only the actor's own hand. Expect the reducer's
  guards to need more care than Sevens', not less: whose turn, whose hand, which
  slot, and is that slot still there.
- **Termination is guaranteed** — every draw either moves a card or removes a
  pair, and the deck only shrinks — but a guard on the loop is still worth
  having, the way `advanceAutoPlays` has one.
- **Hue: not yet chosen.** See the hue budget in `ADDING-A-GAME.md`; Blob has
  265, Silly Head 148, Sevens 205. Pick from the usable arc, and pick the
  remaining ones in a single pass rather than one game at a time.
