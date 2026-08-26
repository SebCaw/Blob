# Cheat

Game five. Also played as Bullshit, I Doubt It, or Bluff.

Read `CLAUDE.md` for the house conventions and `ADDING-A-GAME.md` for what a new
game has to supply. This file is the rules as Seb's house plays them, the
decisions that were settled before any code was written, and the things that
were got wrong first.

---

## The rules, as settled

The whole deck goes out. Everybody holds their cards hidden. **First person to
empty their hand wins.**

On your turn you put **one or more cards face down** in the middle and say what
they are — always one rank. "Two nines." You do not have to be telling the
truth, and nothing in the app checks.

**The rank moves one step, either way.** Say the same rank as the last player,
one above, or one below. The king joins back round to the ace, so the ring has
no ends: after kings you may say queens, kings or aces. This is the house
difference from the usual strictly-ascending version, and it changes the game —
the pressure comes from what you are holding rather than from the rank marching
away from you. "The same again" is always legal, so nobody is ever forced to lie
by the rule itself.

**The first play of a round can be anything.** That covers the start of the game
and every restart after a challenge.

**No maximum.** Put down as many as you like. There is a natural ceiling nobody
had to impose: with one deck there are four of each rank, so "five kings" is a
lie anybody can prove without holding a card.

**Anybody still holding cards can call it.** Not just the next player.

**When it is called, only the cards just played get turned over.** Never the
pile underneath. If the claim was a lie the claimer picks up everything; if it
was honest the caller does. Either way the whole pile goes with it, and only the
person picking it up ever sees what was in there.

**The winner of the challenge starts the next round**, on any rank they like.
Call correctly and you lead; call wrongly, pick up, and the person you wrongly
accused leads. Better than the usual carry-on-regardless, because it makes a
good call worth something beyond not having to pick up.

**Jokers are out.**

**You cannot go out on a lie that gets called.** Your last play sits in the
window like any other, and being caught on it puts every one of those cards back
in your hand.

---

## Two rules the app had to decide

### The window

At a table, calling is a shout and the loudest person wins. On a screen that
would hand it to whoever has the fastest connection, which is not a game.

So a claim sits open for **four seconds** with a bar running down, and the next
player cannot start until it shuts. Any eligible caller ends it instantly. It
closes early when there is nobody left who might call — which on a table of bots
is immediately, so a solo game never sits through the silence.

It is also the beat the animations need. Without it, a card would land and be
gone before anybody registered whose it was.

**It began at three, and the claim was hard to find.** It was set as a 24px line
under a row of card backs, and Seb reported the bar running out while he was
still working out what had been said — one second doing two jobs, reading and
reacting. So the claim now gets the size of the only thing in this game anybody
has to react to: the count as a large numeral, because "3" is read at a glance
and "three" has to be read. The extra second was the cheap half of that fix.

**Nothing shows who is mid-decision.** Each seat used to say "deciding" and clear
as each bot answered, which meant three seats changing under your eyes during the
seconds you are trying to read a claim. Somebody else's deliberation is not
yours to act on, and watching it churn made the screen look like it was
reloading.

**The call button is always on screen**, live or not. It used to appear only
while a claim was open, which made the one control in this game that is on a
clock also the one that moved.

**The bar is drawn, not counted.** A CSS animation describes the whole window
and a negative delay fast-forwards it to wherever the claim actually is. That
means a repaint mid-window lands it back where it was rather than restarting it,
and no clock on the phone has to agree with the server's.

### It ends at two, not one

**Heads-up Cheat cannot end.** "The same rank" is always a legal claim, so two
players can pass one pile back and forth for ever with neither ever forced into
a position they cannot hold. Seb spotted this before a line of it was written.

So the game stops when two players are still holding cards. Of those two,
**whoever holds more loses**. Level, and there is no single loser and the end
screen says so — an honest draw beats a coin toss for the wooden spoon. Measured
over thirty bot games, a tie happened zero times, so that path is defensive
rather than common.

The cost is that at three players it is over the moment anybody goes out. That is
still a game — first out wins, biggest hand loses — but four is where it starts
being worth playing. The minimum is three, which is a decision that can be
revisited.

---

## Decks and table size

Everybody needs **seven cards** or there is nothing to bluff with — you get one
legal claim and no room to move.

| Players | Decks offered | Hands |
|---|---|---|
| 3 | one or two | 17 each, one gets 18 |
| 4 | one or two | 13 each |
| 5 | one or two | 10 each, two get 11 |
| 6 | one or two | 8 each, four get 9 |
| 7 | one or two | 7 each, three get 8 |
| 8 | two or three | 13 each on two |
| 10 | two or three | 10 each on two, four get 11 |
| 12 | two or three | 8 each on two, eight get 9 |

One deck stops being offered at eight players because it cannot give everybody
seven. Three decks is never forced — it is there for a longer, gentler game, and
it genuinely plays differently: with twelve of each rank in the pack, a big
honest claim stops being unbelievable.

Capped at twelve to match Chase the Ace, so the two big-table games seat the
same number. Two decks would stretch to fourteen if that is ever wanted.

The lobby shows the actual hand size against every option, because "two decks"
means nothing to anybody and "eight each, four of you get nine" is the thing
people want to know.

---

## The privacy boundary

The hardest one in the repo, and the reason the cross-engine privacy test was
worth building before this game was written.

**The pile is absent from every payload there is** — including the one sent to
the person who put the top card on it. It is the only object in this app hidden
from every viewer at once. `pileCount` goes out because you can see the height of
a pile across a table; not one card id ever does.

**A claim is public, its cards are not.** Everybody is told immediately that Dex
put three cards down and called them nines. Nobody is told what they are, Dex
included — his own screen gets the count and the rank like everybody else's,
because a claim redacted for some viewers and not others leaks the moment
somebody opens two tabs.

**A reveal is retrospective and permanent.** Cards turned face up in a challenge
go into somebody's hand and stay public there, as `publicCards`. That is the same
mechanic Silly Head calls `publicHand`: the room watched them, so the room may
remember them. They stop being public the moment they are played again, because
nobody can see what goes face down.

**Revealed cards live in `lastEvent`, never in the log.** The log outlives the
moment and those same cards can be back in the face-down pile three turns later.
Putting them in the log would have been a leak with a delay on it.

---

## The bots, and three things that were measured

The ladder was built twice on intuition and came out **inverted both times**.
The numbers are in `lib/cheat/bot.js`; the short version is here because it is
the most transferable thing this game produced.

**Calling is expensive.** Get it wrong and you pick up everything on the table.
So a call is only worth making when the claim is more likely than not to be a
lie — and across 120 measured four-handed games, **only 19% of all claims are
lies**. A bot that calls on a hunch loses. The first version scaled suspicion by
how keen a level was, so the better bots called more: easy won 43% of games and
impossible won 3%.

**A big claim is not a suspicious claim.** Measured lie rates by size: one card
16%, two 16%, three 47%, four **15%** — below the base rate. Nobody makes up a
lie that big. The second version of the bot treated size as the main tell and was
anti-correlated with lying, because an honest bot plays two or three cards and a
lying one plays a single card.

**What actually predicts a lie is being cornered.** The claimer down to two cards
and still claiming two or more: 59%, the only signal above even money. Their last
cards going down: 47%. Exactly three cards: 47%, and that one is an artefact of
how these bots bluff, which is a fair tell for the same reason a person's habits
are.

Two tells were measured and thrown away: the same rank twice running (37%) and a
pile of fifteen or more (no measurable effect). Both are things a person would
swear by. Both sit below the line a call has to clear.

So the ladder is **what a level can see**, not how keen it is, and every thinking
level acts on the same even-money threshold. The top level is not better at
doubting — there was nothing left worth doubting on. It is better at being
doubted: it names the rank with the most copies still unaccounted for, and it
never leaves a bluff sitting at three cards.

**Every level calls an arithmetically impossible claim.** Not tuned and not
optional: with no cap on how many cards go down, a table that let those stand
would hand anybody a free win by dumping their whole hand and naming a rank.

Measured over 160 games, one bot of each level per table:

| Level | Won | Spooned | Mean place |
|---|---|---|---|
| easy | 2% | 49% | 3.64 |
| medium | 32% | 20% | 2.49 |
| hard | 35% | 14% | 2.17 |
| impossible | 31% | 12% | 2.17 |

Monotonic, and the top step is thin — hard and impossible are level on mean
place and separated only by spoon rate. Worth another look if anybody wants a
harder top end.

---

## Double speed

Once **every player still holding cards is a bot**, the Master gets an `x2` chip
that halves both the bot thinking and the window. Watching four bots think at a
person's pace is not pace, it is a wait.

It is gated on who is still holding cards rather than who is at the table,
because once you are out you are watching. It turns itself off the moment a
person reconnects into it.

---

## Things that went wrong, so they do not go wrong twice

**The bots ran a four-thousand-step game without anybody going out.** A bot hid a
passenger card inside a claim of all four of a rank, producing "five kings" — an
impossible claim, called on sight, every time. Any claim size now has the pack
size as a ceiling.

**The reducer refused a claim naming the same card twice.** The passenger was
picked from the whole hand including the cards already going down.

**The countdown bar drew as already finished on every claim but the first.** The
view sent `closesAt` and `windowMs` but not `openedAt`, so the key the client
compares never changed and the elapsed time was measured from the first claim of
the game for ever after. Nothing in a test could have caught it; it took thirty
seconds in a browser.

**`repeatsOf` counted `claim` and `stands` events and halved.** Those come in
pairs only when nobody calls — and a called claim never gets its `stands`, which
is exactly the play worth remembering.

**An `aria-` attribute passed to `cardFace` is silently dropped.** It builds its
own attributes and passes nothing else through. Worse than not setting one,
because it looks done.

---

## The colour

Hue 30, a dark tobacco ground, with a sky-blue accent at `#3d9eff`.

It was pencilled in at 305 in `ADDING-A-GAME.md`, a purple-pink, and moved
because Seb pointed out that sits too close to Blob's 265 to tell apart on a
phone in a dim room — which is the entire point of giving each game its own hue.

Moving it also solved a problem that had been written down as unavoidable. At
305 the rule produced a green accent, which reads as "correct" in a game about
lying, and the plan was to break the rule. At 30 the complement is blue, so the
rule holds and Cheat has the first **cool** accent in the app: Blob is lime,
Silly Head amber, Sevens orange, Chase the Ace mint. It is the one thing on the
shelf nothing else can be mistaken for.

Solitaire is still pencilled at 20, which is close to 30 and should move.

---

## Still open

- **Twelve players on three decks has never been in a browser.** It terminates in
  the engine and the seats go three-across given the width, but nobody has looked
  at it.
- **Cheat has no tests of its own**, beyond its fixture in the cross-engine
  privacy test. So do Sevens and Chase the Ace.
- **The minimum of three** makes for a very short game, since it ends the moment
  one person goes out. Four might be the better floor.
- **The top of the bot ladder is thin.** Hard and impossible are level on mean
  place.
