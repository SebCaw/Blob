# Kings Corner

The rules as the house plays them, settled with Seb before a line of the reducer
was written. This is the only place they are written down — read it before
touching `lib/kingscorner/`, and keep it current.

Seven on the shelf, and the first one that is not really about the other people
at the table. Nothing here passes between players and nothing anybody does can
make a card in your hand illegal. What everybody is competing for is **board**:
eight slots in the middle, and the good ones go to whoever gets there. It is
six people playing one patience at once.

One thing about it turned out to be the opposite of how it looks, and it was
measured rather than reasoned: **making room on the board is generous, not
clever.** A slot you free is used by everybody who plays before it comes round
to you again. See The bots.

Published as **Kings in the Corner**. The house calls it Kings Corner and that
is what goes on the tile.

---

## The game

Standard 52-card deck, jokers out — this app has no joker anywhere. **Two to
six players, and four is the game.** One deck, always; six hands of seven plus
the four turned for the cross is forty-six cards, so a second deck is never
needed and no card ever carries a copy tag.

**Aces are low.** The order is K-Q-J-10-9-8-7-6-5-4-3-2-A, which is the
opposite end from `lib/deck.js`, whose ace is high because a trick needs it to
be. This game keeps its own, the way Sevens does.

### The layout

Seven cards each. The rest go face down in the middle as the **stock**, and four
cards are turned off it into a cross around it. The four corners start empty.

```
        [corner]   [ N ]   [corner]
          [ W ]   [stock]   [ E ]
        [corner]   [ S ]   [corner]
```

**Eight slots, whatever the player count.** Two people and six people play the
same board, which is most of why four is the recommendation and six is a
scramble.

### Building

A pile is built **downward in rank and alternating in colour**. A red 3 goes on
a black 4. That is the only building rule in the game and it never changes: the
cross piles, the corner piles and a pile that has just been moved all take a
card the same way.

**Only a King opens a corner.** Nothing else may start one. Once it is open it
builds down like anything else, so a red queen goes under a black king and away
it goes.

**Both ends of a pile matter**, which is unusual and worth holding onto — every
other pile in this app is read from one end. The **lowest** card is what you
build onto. The **highest** card, the one at the head, is what decides whether
the whole pile can be picked up and moved.

### Your turn

Make as many moves as you like, in any order, including none. **Playing is
optional** — you may sit on a card that fits and nobody may make you put it
down.

Three moves:

- **A card from your hand onto a pile.** One rank lower, opposite colour.
- **A King from your hand into an empty corner.** Kings only.
- **A card from your hand into an empty cross slot.** Any card. *(This is the
  one line still waiting on Seb — see Open at the bottom.)*
- **A whole pile onto another pile.** The moving pile's **head** — its highest
  card, the one it was started with — must be one rank lower and the opposite
  colour to the target's **lowest** card. All of it moves or none of it; you
  cannot split a pile and you cannot take a card back off one.

The pile move is the interesting one. It is the only way a slot ever empties,
and an empty slot is the only place an unplayable card can go. It costs you
nothing — and it helps whoever is next as much as it helps you, which is the
whole tension, and which measured out even more one-sided than it reads. Free a
slot with three people still to play before your next turn and you have most
likely just handed one of them a discard.

### Ending your turn

**If no card left your hand this turn, you draw one from the stock, and your
turn is over instantly.** You do not get to play what you drew, however well it
fits.

**If a card did leave your hand, you do not draw at all.** This is the house
rule and it is the biggest departure from the published game, which deals a
draw at every turn. It changes the shape of the whole thing: the deck is a
punishment for a turn you could not use, not an income, so a hand only ever
grows when you are stuck and the game gets shorter every time somebody plays
well.

*Moving a pile around is not a card leaving your hand.* A turn spent
rearranging the board and nothing else is still a turn where you played
nothing, so you draw. *(Also on the Open list.)*

**Once the stock is empty, a turn with no play is simply a turn with no play.**
You are told there is nothing to draw and it passes to the next person. The
game does not stop.

### Going out, and how it ends

**Going out does not end the game.** Empty your hand and you are out, in the
place you earned — first, second, third — and everybody else plays on. The game
stops when **one person is left holding cards**, and that person is the loser.

This is Seb's rule and it changes what the game is about. By the time somebody
has gone out, what is left at stake for everybody else is not winning; it is not
being last. That is the same shape as Sevens and Silly Head, and it is why the
end screen is an ORDER rather than a winner and a crowd.

Your turn ends the moment your last card lands — there is nothing left for you to
do — and the seat skips you from then on. No scoring and no rounds.

### The dead-board backstop

The stock is empty, every pile is headed by a card nothing can go under, every
corner is either open or spoken for, and nobody holds a King with a corner
free. Nothing legal exists anywhere and nobody can do a thing about it.

This is genuinely reachable, not a theoretical worry: an ace is the lowest card
in the deck, so a pile that has been built down to an ace can never be built on
again, and eight of those with an empty stock is a locked board. The escape
valve is that a dead pile can still be *moved* — its head is what matters, not
its tail — and moving it frees a slot. So a lock needs the pile moves to be
exhausted as well, which makes it rare rather than impossible.

**So: the stock is empty, and the table goes round twice with no card leaving
any hand and no pile moved. The game stops there.** Two rounds rather than one
because playing is optional, and one round of everybody choosing to pass is a
legal position rather than a stuck one.

Everybody still in is then placed by how few cards they are holding, which is
the nearest honest thing to the order they would have gone out in, and whoever
holds the most is the loser. Anybody already out keeps the place they earned.

**A tie stays a tie.** The list of places needs a total order and takes an
arbitrary tiebreak to get one, but the RESULT does not have to pretend:
somebody who actually went out wins outright, and only a board that died with
nobody out at all can be shared. If two people are level on the most cards,
nobody is named the loser. A coin toss for a title nobody agreed to play for is
worse than an honest draw.

Same shape as Go Fish's barren rule and it carries the same warning: measure it
in the soak rather than believing it. If it never fires in ten thousand games it
is still right to have, and if it fires often something else is wrong.

---

## What is public and what is not

The shortest boundary in the repo, shorter even than Go Fish's, and it is worth
saying why: **every card that reaches the board was turned face up in front of
the room and stays face up.** There is no pile anybody has to remember, no
claim to disbelieve, no answer to deduce. The game is played entirely in the
open except for the two obvious things.

**Secret:** the cards in each hand, and the cards in the stock. That is the
whole list.

**Public:** every card in every pile in order, top to bottom; which slots are
empty; how many cards each player is holding; how deep the stock is; and whose
turn it is.

Two things follow, and both are cheap:

- **`hiddenFrom` is two lines** — everybody else's hand, and the stock. There is
  no inversion like Blob's forehead round and no shared secret like Cheat's
  face-down pile.
- **A pile goes in the payload as a list of card ids**, all of them, because all
  of them are public. No redaction, no counts standing in for cards. The only
  reason to trim it would be payload size, and eight piles of at most thirteen
  cards is not a payload problem.

The stock is a **count**. Not the cards, not the order. The four cards turned
into the cross at the deal come off the stock and are public from that moment,
which needs no special handling — they are on the board.

---

## The screen

The board is the game, so the board gets the screen. The hand is what you read
to decide, so it gets the rest, and nothing else goes on there at all.

**The cross is a three-by-three grid and the stock is the middle of it.** That
is not a compromise for the phone — it is what the layout already is. Four cross
slots on the edges, four corners on the corners, stock in the centre, and it
comes out square, which is the one shape a 560px column has plenty of. Nine
cells at about 110px is 330 wide and fits a 375 phone with room either side.

**A pile shows both its ends, because both are load-bearing.** A tight downward
fan with the head card readable at the top and the lowest card fully visible at
the bottom, and the middle allowed to compress to nothing. What you must never
have to do is tap a pile to find out what it will take.

**Two things get lifted, and one of them is not a card.** Tap a card in your
hand to lift it and the slots it can go to light up. Tap a pile's head to lift
*the whole pile* and the piles it can land on light up. This is the first
selection in the app that is not a card in a hand, and it needs to look like
what it is: the pile lifts as one object, not as its top card.

**The server publishes every legal move and the client draws them.** For each
card in your hand, which slots take it; for each pile, which piles it can move
onto. The client works out nothing — invariant three, and here it would be
especially tempting to break because the rule is four words long.

**Do not dim what you cannot play.** Sevens learned this and Kings Corner is
worse: with eight piles built down and a hand of ten, two legal cards is an
ordinary turn, and dimming would grey out almost the entire hand. Cards stay
normal, and an unplayable one **says what it is waiting for** when you press it
— a black 6 wants a red 7. An inert control that gives nothing back gets
reported as a broken hitbox, and that has already cost a session once.

**One button, always in the same place, and its label is what will happen.**
`END TURN` when you have played something, `DRAW AND PASS` when you have not,
`PASS` when the stock is empty. Never three controls appearing and disappearing
under the thumb.

**But it is only FILLED when there is nothing else you could do.** Seb played it
and reported pressing it while still holding a playable card, which is exactly
what a big solid button in the accent colour asks you to do — it was the loudest
thing on the screen whether or not it was the right move. It is an outline while
you still have a move and goes solid the moment it becomes the only thing left.
Same button, same place, same words: only the shouting moves.

**The board takes the height going spare.** The nine cells stretch and the cards
stay exactly the size they were, which is the rule in `CLAUDE.md` — a bigger
screen gets a bigger layout, not bigger type. Capped, because a laptop window is
tall enough to make nine cells look like nine paddocks.

### Hints, which are the Master's call

**"Show what you can play" is a lobby setting**, on by default, and everybody
plays under the same one — a table where one person is being shown the answers
and the others are not is two different games. With it off, the screen stops
ringing your playable cards, stops lighting up the slots a lifted card fits, and
stops marking which piles can be moved.

**What it does NOT do is stop the screen answering you.** An unplayable card
still says what it is waiting for when you press it, and a slot still says why
it will not take what you are holding. That is deliberate: a control that gives
nothing back when pressed reads as broken, which has already cost this project a
wrong diagnosis once. Turning the hints off should make the game harder, not
make the app feel faulty.

It is a convenience rather than a secret, so the legal moves still ride in the
view. Nothing about the privacy boundary changes.

**The gold ring goes on your hand block for as long as the game is waiting on
you.** Silly Head's mechanism exactly — `outline` and `box-shadow`, never a
border and never padding, because the fitter measures that block after paint and
a turn that resized it would resize every card on the table each time it came
round.

**A star on the card you drew.** You draw at most one card a turn, you cannot
play it, and it files itself into a sorted hand where it is invisible. Go Fish's
`markWhatArrived` is the pattern and the three cases that must come out as
nothing-is-new are the same three: the deal, a reconnect, and a hand that only
shrank.

**The screen key is the phase and nothing else.** Not the lifted card, not the
lifted pile. Chase the Ace and Cheat both got this wrong with comments claiming
the opposite, and both times Seb reported it as the screen reloading.

**No clock of its own.** Nothing here is time-critical, so there is no
`deadline` hook and none wanted. `stallWatch` watches one person — whoever's
turn it is — because a turn is taken by exactly one player, unlike Go Fish's.

### At the largest text size

Two problems, and they are separate.

**The board.** At 1.4 the grid wants about 460px, which the column still holds,
so the board is fine and the hand is what runs out of room. `fitFan` tightens
the fan, `splitHand` takes it to two rows if the hand has grown past nine, and
the piles shrink their cards only after both of those. Never shrink a card
first. The screen takes `screen--fits` plus a measured spill, not `--fixed`,
because there is a button that must be reachable — and `flex: 0 0 auto`, which
is the fix three screens have now had to rediscover.

**The shelf, which is a seventh tile on a screen with eleven pixels spare.**
Six tiles plus the code box end at 801px in an 812px viewport at `huge`, and a
seventh is another 112. **At `huge` only, the tiles become a two-column grid** —
four rows instead of seven, about 450px, which fits with room to spare and keeps
every game on one screen. Scrolling was the other option and it is worse: the
failure it produces is somebody never finding half the games, which is exactly
the failure the height budget exists to prevent. The taglines are already
dropped at that size, so a tile at half width is an icon and a name, which
survives it. **Measure it rather than believing this paragraph** — the failure
is silent and happens at one text setting only.

---

## The bots

Four levels, same names as everywhere else, and one policy underneath. The
prediction at the top of this file was that the ladder would come out **flat**
rather than inverted. It came out worse than that, and the measuring is the only
reason anybody knows.

**What shipped, measured at a mixed four-seat table with the seats rotated,
3200 games, against a 25% baseline:**

| level | wins |
| --- | --- |
| easy | 8.4% |
| medium | 34.1% |
| hard | 27.3% |
| impossible | 30.2% |

**Only `easy` is a real rung.** It puts one card down and stops, and it is
repeatably terrible. The other three differ only in how often they take a worse
option than the one they found, and they sit within a few points of each other
with **no stable ordering**. Three separate instruments disagreed about which
was strongest. This is the game's one open item and it is written down rather
than papered over.

**Four heuristics were built, measured, and thrown away for making the bots
worse.** They are listed in `lib/kingscorner/bot.js` so nobody adds them back on
intuition. The one worth repeating here is the big one:

**Freeing a slot before you are stuck is a gift, not a good play.** It is the
move this game appears to be about, and at a four-handed table the slot you open
is used by the three people who play before it comes round to you again. Bots
that did it proactively lost about ten points. It genuinely pays heads-up — and
that difference is the finding, because it means the two are different games.

**Counting the deck is worth less than nothing here**, which is the sharpest
result of the lot. A bot that knows which piles are dead and which of its own
cards can never be played again is a bot with real extra knowledge — the same
KIND that earns Go Fish its top rung. A field of counters was markedly EASIER to
beat than a field without (46% against 24%). The knowledge is real; what it
informs is a shared resource, so acting on it helps everybody at the table
equally. That is a genuinely new lesson for this repo, and it generalises: **the
value of information depends on whether the thing it tells you about is yours.**

### The two instruments that lied

Both gave confident wrong answers and both are recorded in `tools/kc-ladder.js`.

**Heads-up is invalid.** In a mirror match between two competent bots, whoever
leads wins **100%** of the time. With seats swapped every other game every rung
therefore reports exactly 50.0%, which looks like a beautifully balanced
measurement and is measuring the seat.

**One challenger against three of a kind is invalid too**, because of the
free-riding above. It produced the flatly contradictory pair "hard beats a field
of mediums" AND "medium beats a field of hards". Both were true and neither said
anything about which plays better.

So the tool now sits one bot of each level at one table and rotates the seats.

### A turn cannot go round for ever, and it is structural

A bot takes many moves in one turn, one command at a time through the same door
a phone uses, which is Silly Head's `nextSortMove` shape. That function needed
three separate rules to make it terminate. This one needs none, and the reason
is worth keeping: **a pile may only land on another pile, never in an empty
slot**, so every pile move reduces the number of occupied slots by exactly one.
The piles cannot be shuffled back and forth. Refilling a slot is the only way to
make another move available and that costs a card from a hand that never grows
mid-turn.

`MAX_TURN_MOVES` in the reducer is a backstop under that argument rather than a
fix for anything anybody has seen, and there is a test pinning the property it
rests on.

## Colour

**Hue 178, a teal.** Accent **`#ff3d47`**, a coral; deep **`#d71420`**.

The accent follows the house rule for once — the complement of the hue at S100
L62, deep at S83 L46 — and it lands somewhere genuinely unused. Blob has lime,
Silly Head amber, Sevens orange, Chase mint, Go Fish cyan, Cheat a blue. Nothing
on the shelf is red.

**The ground is the risk, not the accent.** 178 sits between Silly Head's 148
and Sevens' 205, thirty degrees off one and twenty-seven off the other, and all
three are cool. `ADDING-A-GAME.md` predicted this cluster by name and called it
the pair most likely to need separating once seen. So the test is the one Cheat
was moved by: **put the three tiles side by side on a phone in a dim room and
see whether you can tell them apart.** If you cannot, the answer is re-spacing
the cool end in one pass, not nudging this one by five degrees.

The icon is a crown in the corner of a frame — the name of the game and its only
special rule, in one mark.

---

## Open

One line, waiting on Seb.

**What may go into an empty cross slot?** The published rule is any card from
your hand, and everything above is written assuming that. The alternative is
that it takes a King like a corner does, which would make the pile move almost
pointless, or that it stays empty for good, which would make it pointless
entirely. Any-card is almost certainly right; it is written down here because
assuming it silently is how a reducer gets unpicked.

**And the half-question under it:** a turn where you only moved piles around and
played nothing from your hand — do you draw? Written above as yes, on the
grounds that the rule is about a card leaving your hand and no card left it.
