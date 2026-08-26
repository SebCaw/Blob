# Go Fish

The rules as the house plays them, settled with Seb before a line of the reducer
was written. This is the only place they are written down — read it before
touching `lib/gofish/`, and keep it current.

Six on the shelf. The one before it was Cheat, and the two games are opposites
worth holding side by side: in Cheat you say something and nobody may check it;
here you ask something and everybody hears the answer. Cheat hides a shared
object from the whole room. Go Fish hides nothing at all except what is in a
hand and what is in the pool, and spends the entire game making people say true
things out loud.

---

## The game

Standard 52-card deck, jokers out — this app has no joker anywhere. **Three to
six players**, one deck.

**Seven cards each at three players, five each at four or more.** The rest go
face down in the middle as the pool. At four that is twenty out and thirty-two
down; at six it is thirty out and twenty-two down.

You are collecting **books of four**. Most books at the end wins.

### Your turn

You **ask one named player for one named rank**, and **you must already hold at
least one card of that rank**. That single rule is what the whole game hangs
off. Asking is a public act about a private hand: say "Kate, any sevens?" and
the entire table has just learned you hold a seven. Every question is
information you give away in order to get information back, which is the reason
this is a game and not a lottery.

**They have some** — they hand over **all** of them, and **you go again**. Not
one, not the ones they feel like: every card of that rank they are holding.

**They have none** — they say **go fish**, you take one card from the pool, and
your turn ends.

**You never show a card you fished.** Seb was explicit: no matter what.

**Therefore fishing always ends your turn**, even when the card you drew is the
one you asked for. This is the one place the house rules depart from the game as
usually published, and it is forced rather than chosen: the usual rule says a
lucky draw lets you go again, but going again would tell the whole table exactly
what you drew. The two rules cannot both stand, and Seb confirmed which one
goes.

**Once the pool is empty, go fish means nothing happens.** You are told no, and
your turn ends. There is nothing to draw.

### Books

Four of a rank is a book. **You put it down yourself** — it does not go down on
its own. That is a deliberate choice and it costs you if you dawdle: a book
sitting in your hand can still be asked for, and four sevens handed over is four
sevens gone.

The one thing you may not do is book the rank somebody is asking you for at that
moment. The question is already on the table and you have to answer it.

You may lay a book at any time you hold four, on your turn or not. In practice
the only way to gain a card is on your own turn, so it is nearly always your
turn anyway.

### Going out

**Empty your hand and you are out**, keeping every book you have already laid
down. Pool or no pool — you do not draw back in. That is Seb's call and it is
not the usual rule, so it has a consequence worth being honest about: cards can
be left stranded in the pool and the last few books may never get made.

That is fine. It also settles how the game stops.

### How it stops

Three ways, and the first is the ordinary one.

- **All thirteen books are made.** Nothing left to play for.
- **Fewer than two players are still holding cards.** With one hand left at the
  table there is nobody to ask, so it is over. The same shape as Cheat stopping
  at two, and for the same honest reason: the position simply cannot continue.
- **The table has gone barren.** A backstop, described below.

**Most books wins.** Level, and it is a shared win with both names on it — a
coin toss for a title nobody agreed to play for is worse than an honest draw.

### The barren backstop

The pool is empty, two or more people still hold cards, and every ask fails. No
card moves, nothing is drawn, and the table goes round again. It is possible:
three sevens in one hand and three eights in another, with each player asking
for the rank the other does not have, for ever.

It is unlikely — with an empty pool and nobody out holding cards, every rank not
yet booked has all four of its cards in somebody's hand, so a correct ask always
exists. Finding it is the game. But nothing forces anybody to find it, so after
**three full turns of the table with no card moving and nothing drawn**, the
game stops and the books that are down are the books that count.

This is the same shape as Silly Head's deliberate breakout, and like that one it
should be measured rather than assumed. See the note in `lib/gofish/game.js`.

---

## What is public and what is not

Shorter than any other game in this app, and that is worth saying plainly.

**Secret:** the cards in each hand, and the pool. That is the whole list.

**Public:** how many cards everybody holds, every book that has been laid down
and whose it is, how deep the pool is, and every question and answer since the
deal — who asked whom for what, and what came back.

**No card id ever leaves its owner's hand.** Not to another player, not to a
spectator, not in the log. The one exception is the beat where cards physically
cross the table, and it is not really an exception: at a real table you watch
two sevens change hands, so those two card ids ride along in `lastEvent` for one
event so the screen can animate them honestly. They do not persist. A beat later
they are somebody's hand again and remembering them is your job.

Suits are irrelevant to this game — you ask by rank and you book by rank — so
nothing is given away by that beat that the rank and the count had not already
given away.

**A book is sent as a rank, not as four cards.** The four cards of a book are
fully determined by the rank, so sending them would be four card ids doing the
work of one letter.

---

## The memory, and why it is the game

Everything anybody knows comes out of the log, and the log is the same for
everybody. Three kinds of thing go in it and each is a deduction waiting to be
made:

- **An ask.** The asker holds at least one of that rank. Guaranteed — it is the
  rule.
- **Go fish.** The target held none of that rank at that moment.
- **A handover.** Exactly how many of that rank moved, and to whom.

That is enough to play very well, and it is the whole of the bot ladder. See
`lib/gofish/bot.js`: the easy one has no memory at all, and the top one has used
every line of it since the deal.

The transcript is on the screen because it was said out loud at a real table and
because a game that punishes you for a bad memory is not the game Seb described.
What the app does not do is derive from it for you. Nothing on any seat says
"known to hold two sevens" — Cheat does that and it is right there, because
Cheat's revealed cards are a rare event you would genuinely remember. Here
handovers are most of what happens, and a seat annotated with everything it has
been given would be the app playing the game.

---

## The screen

The asking is the game, so the asking is the screen. Two taps for a whole turn:
a rank off your own hand, and a player off the table.

The moment worth building for is the **answer**. When you are asked, everybody
looks at you, and the app must not resolve it before you have said anything —
so the target taps, and only the target is told what the button will say. To
everybody else the table is simply waiting on Kate, and that is exactly what it
is at a real table.

**Both answers are one control in one place.** It reads HAND THEM OVER or GO
FISH depending on what you actually hold, and it never moves. There is no
choice in it: you cannot lie in Go Fish, and the app does not offer you the
chance to try.

**Cards travel.** Handing over animates across the table, and so does a book
going down. This is the game where things physically change hands, and it is
the one Seb asked for animations on by name.

**No clock anywhere.** Nothing here is time-critical. Unlike Cheat, nobody is
racing a window, so this engine has no `deadline` hook and wants none. Waiting
on a person who has gone missing is what `stallWatch` is for, and here it has to
watch two people rather than one: whoever's turn it is, and whoever is being
asked. A vanished target holds the table up exactly as hard as a vanished
player.

---

## Colour

**Hue 228, a deep ocean.** Accent **`#3dd8ff`**, a surf cyan; deep
**`#149fd7`**.

The accent **breaks the house rule on purpose**, and the reasoning is recorded
here rather than left to be rediscovered. The rule in `ADDING-A-GAME.md` is that
an accent is the complement of the hue at S100 L62. Every blue ground produces a
warm complement, and the warm end of the shelf is full: Blob has lime, Silly
Head amber, Sevens orange. A rule-derived accent here would have landed on top
of one of the three.

Sevens is also already a blue, at 205, which is why this one had to go deep to
228 — the tiles sit side by side on the shelf, each carrying its own hue and its
own accent, and two blues a few degrees apart are one blue to anybody looking at
a phone.

This is the second documented departure, after Chase the Ace's.
