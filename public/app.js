import { h, fill, reducedMotion, buzz } from './ui.js';
import { mascot } from './mascot.js';
import { Net, LIVE, RETRYING, LOST, lastName } from './net.js';
import { keepAwake, releaseWake } from './wake.js';
import { applySize, currentSize, pinViewport } from './size.js';
import { play as sound, soundOn } from './sound.js';
import { askBeforeStart } from './prefs.js';
import { welcomeScreen, switchGameScreen } from './screens/welcome.js';
import { shelfScreen } from './screens/shelf.js';
import { sillyheadScreen, sillyheadWelcome } from './screens/sillyhead/index.js';
import { sevensScreen, sevensWelcome, sevensScreenKey } from './screens/sevens/index.js';
import { chaseScreen, chaseWelcome, chaseScreenKey } from './screens/chase/index.js';
import { cheatScreen, cheatWelcome, cheatScreenKey } from './screens/cheat/index.js';
import { gofishScreen, gofishWelcome, gofishScreenKey } from './screens/gofish/index.js';
import { applyGameTheme } from './games.js';
import { lobbyScreen } from './screens/lobby.js';
import { biddingScreen } from './screens/bidding.js';
import { playingScreen } from './screens/playing.js';
import { revealScreen } from './screens/reveal.js';
import { summaryScreen } from './screens/summary.js';
import { completeScreen } from './screens/complete.js';
import { historyScreen } from './screens/history.js';
import { electionOverlay } from './screens/election.js';
import { settingsSheet } from './screens/settings.js';
import { helpOverlay } from './screens/help.js';

/**
 * The app shell: one state object from the server, one render, one screen.
 *
 * There is no client-side game logic here at all. The server sends a snapshot,
 * this decides which screen that snapshot means, and draws it. Anything a
 * player does becomes a command; nothing is applied optimistically, because a
 * bid that appears to land and then does not would be far worse than a bid that
 * takes 40ms.
 */

const root = document.getElementById('app');

/**
 * Two hosts inside `#app`, and the second one is why.
 *
 * `render()` rebuilds everything it owns on every state the server pushes, which
 * is correct for a screen and wrong for a panel you are standing in. The
 * settings sheet has a 160ms slide-in on it, so a card being played anywhere at
 * the table re-ran the animation, threw away the scroll position and blinked the
 * whole thing — Seb reported it as the settings page refreshing every time a
 * card was played, which is exactly what it was doing.
 *
 * So the screen goes in one host and the standing overlays go in another, and
 * only the first is rebuilt on a push. The overlays are rebuilt when THEIR own
 * state changes and at no other time — see `overlayKey`.
 *
 * Both are `display: contents`, so neither shows up in `#app`'s flex layout and
 * `.screen` is still a direct flex child as far as the stylesheet is concerned.
 * They live inside `#app` rather than on `document.body` — which is where the
 * confetti goes — because `#app` carries the `zoom` that the size setting works
 * through, and a settings panel drawn at 1x over an app at 1.4x is worse than
 * the bug being fixed.
 */
const screenHost = h('div.app-screen');
const overlayHost = h('div.app-overlays');
root.append(screenHost, overlayHost);

const net = new Net();

/** Local, throwaway view state — never anything the game depends on. */
/**
 * A solo game is three opponents, which makes four round the table — the size
 * Oh Hell plays best at, and the size the seats were laid out for.
 *
 * Medium to start: Easy does not teach you anything and Hard is a rough
 * welcome. Whoever wants a different fight changes it in the lobby, which is
 * right there.
 */
const SOLO_BOTS = 3;
const SOLO_LEVEL = 'medium';

const ui = {
  // The shelf is the front door now that there is more than one game behind it.
  // Everything that arrives with a destination — a code, a link, a game already
  // in progress — skips it in `boot()`.
  route: 'shelf',
  /** Which game the app is currently wearing. */
  game: 'blob',
  name: lastName(),
  code: '',
  handSize: 7,
  /** Which way the game being created is played: 'table' or 'online'. */
  mode: 'table',
  bid: null,
  tricks: null,
  entering: false,
  takeover: null,
  addingOffline: false,
  offlineName: '',
  historyList: undefined,
  historyRecord: null,
  showCard: false,
  electionSeen: null,
  rematchPending: false,
  /** A code from a shared link that is for a game other than the one we are in. */
  pendingCode: null,
  /** Leaving a running game cannot be undone, so it is asked about first. */
  confirmLeave: false,
  /** The same question, asked from the settings sheet on the way to the shelf. */
  confirmShelf: false,
  /** Ending the game for everyone is asked about the same way. */
  confirmEnd: false,
  /** The Master is fixing a round that was scored wrong. */
  correcting: false,
  /** The corrected trick counts, kept if the request does not land. */
  correction: null,
  /** A starting hand the Master is still adjusting, before the server is told. */
  lobbyHandSize: null,
  /** The game whose win has already been celebrated, so it happens once. */
  confettiShownFor: null,
  /** Silly Head: the quick one-deck game, chosen before the game is created. */
  shQuick: false,
  /** Silly Head: the card picked up during the sort, waiting for a pile. */
  shPick: null,
  /** Silly Head: cards lifted out of your hand, waiting to go down together. */
  shChosen: null,
  /** Silly Head: the last check before you are dealt in. */
  shConfirmReady: false,
  /** Silly Head: stuck on your face-up cards, choosing which one you lose. */
  shGiveUp: false,
  /** Silly Head: cards tapped and still in flight, so the tap looks answered. */
  shSending: null,
  /** The settings sheet, which can be opened from any screen in a game. */
  settingsOpen: false,
  /** How to play: which step, which tab, and the conversation so far. */
  helpOpen: false,
  helpStep: 0,
  helpTab: 'steps',
  helpChat: null,
  helpDraft: '',
  helpThinking: false,
};

let state = null;
let previousOrder = [];
let lastRoundIndex = -1;
let lastPhase = null;
let toastTimer = null;
/** The rematch id we have already tried to claim a seat in, so a later
 *  broadcast of the same pointer does not trigger a second attempt. */
let claimedRematchFor = null;

// -- The context every screen is handed --------------------------------------

const ctx = {
  ui,
  get state() {
    return state;
  },
  get previousOrder() {
    return previousOrder;
  },
  render,
  toast,
  /** Open a game from the shelf: put its colours on, then its front page. */
  openGame(id) {
    ui.game = id;
    applyGameTheme(id);
    ui.route = 'home';
    render();
  },
  go(route) {
    ui.route = route;
    if (route === 'history') ui.historyList = undefined;
    render();
  },
  /**
   * Send a command and say whether it landed.
   *
   * The boolean matters: a screen that moves on regardless would tell an
   * offline player "bid taken" when the server had refused it, or throw away
   * results the Master had just typed in because the network hiccupped.
   *
   * @returns {Promise<boolean>} true if the server accepted it
   */
  async send(command) {
    try {
      await net.send(command);
      return true;
    } catch (error) {
      toast(error.message);
      return false;
    }
  },
  async createGame(name, handSize, mode) {
    try {
      lastName(name);
      state = await net.createGame(name, handSize, mode);
      ui.route = 'game';
      net.connect();
      render();
    } catch (error) {
      toast(error.message);
    }
  },
  /**
   * A Silly Head game. No mode to choose — it deals, because the whole game is
   * cards nobody else can see and there is no score for a table version to keep.
   */
  async createSillyHead(name, quick) {
    try {
      lastName(name);
      state = await net.createGame(name, 0, 'online', { game: 'sillyhead', quick: Boolean(quick) });
      ui.route = 'game';
      net.connect();
      render();
    } catch (error) {
      toast(error.message);
    }
  },
  /**
   * Silly Head against three bots, in one tap.
   *
   * Three opponents makes four round the table, which is the size the game is
   * usually played at and the size one deck would seat. It lands in the
   * ordinary lobby rather than dealing straight away, because that is where the
   * difficulty and the length already live — no new screen, and none wanted.
   *
   * Each bot goes in on its own and a failure is survivable: a lobby with two
   * bots in it is still a game, so a wobbly connection costs a seat you can add
   * back by hand rather than the whole thing.
   */

  /** A Sevens game. Nothing to choose: the whole deck goes out to whoever turned up. */
  async createSevens(name) {
    try {
      lastName(name);
      state = await net.createGame(name, 0, 'online', { game: 'sevens' });
      ui.route = 'game';
      net.connect();
      render();
    } catch (error) {
      toast(error.message);
    }
  },
  /**
   * Sevens against three bots, in one tap.
   *
   * Three opponents makes four round the table, which is the smallest number
   * Sevens is worth playing at above its minimum. It lands in the ordinary lobby
   * rather than dealing straight away, because that is where the difficulty
   * already lives — no new screen, and none wanted.
   */
  /**
   * A Cheat game.
   *
   * Nothing to ask on the way in. How many decks depends on how many people
   * turn up, and one deck stops being legal at eight of them, so that question
   * belongs in the lobby where it can actually be answered.
   */
  async createCheat(name) {
    try {
      lastName(name);
      state = await net.createGame(name, 0, 'online', { game: 'cheat' });
      ui.route = 'game';
      net.connect();
      render();
    } catch (error) {
      toast(error.message);
    }
  },
  /**
   * Cheat against three bots, in one tap.
   *
   * Three is the minimum this game needs on top of you. It is a short game at
   * four - it stops with two people still holding cards - but a real one.
   */
  async playCheatSolo() {
    try {
      const name = (ui.name || '').trim() || lastName() || 'You';
      lastName(name);
      state = await net.createGame(name, 0, 'online', { game: 'cheat' });
      ui.route = 'game';
      net.connect();
      render();
      for (let i = 0; i < SOLO_BOTS; i += 1) {
        try {
          await net.send({ type: 'player/addBot', level: SOLO_LEVEL });
        } catch {
          /* the lobby has its own way to add one */
        }
      }
      render();
    } catch (error) {
      toast(error.message);
    }
  },
  /**
   * A Go Fish game.
   *
   * Nothing to ask on the way in. There is one deck and no variant, and how many
   * cards you start with follows from how many people turn up - so the front
   * page asks for a name and gets out of the way.
   */
  async createGoFish(name) {
    try {
      lastName(name);
      state = await net.createGame(name, 0, 'online', { game: 'gofish' });
      ui.route = 'game';
      net.connect();
      render();
    } catch (error) {
      toast(error.message);
    }
  },
  /**
   * Go Fish against three bots, in one tap.
   *
   * Three opponents makes four round the table, which is one above this game's
   * minimum and the size the deal is written for - five cards each and
   * thirty-two in the pool.
   */
  async playGoFishSolo() {
    try {
      const name = (ui.name || '').trim() || lastName() || 'You';
      lastName(name);
      state = await net.createGame(name, 0, 'online', { game: 'gofish' });
      ui.route = 'game';
      net.connect();
      render();
      for (let i = 0; i < SOLO_BOTS; i += 1) {
        try {
          await net.send({ type: 'player/addBot', level: SOLO_LEVEL });
        } catch {
          /* the lobby has its own way to add one */
        }
      }
      render();
    } catch (error) {
      toast(error.message);
    }
  },
  /** A Chase the Ace game. One deck or two, chosen on the way in. */
  async createChase(name, twoDecks) {
    try {
      lastName(name);
      state = await net.createGame(name, 0, 'online', { game: 'chase', decks: twoDecks ? 2 : 1 });
      ui.route = 'game';
      net.connect();
      render();
    } catch (error) {
      toast(error.message);
    }
  },
  /**
   * Chase the Ace against three bots, in one tap.
   *
   * Three is not a shortcut here, it is the minimum: this game needs four round
   * the table, so a solo game is exactly you and three.
   */
  async playChaseSolo() {
    try {
      const name = (ui.name || '').trim() || lastName() || 'You';
      lastName(name);
      state = await net.createGame(name, 0, 'online', { game: 'chase' });
      ui.route = 'game';
      net.connect();
      render();
      for (let i = 0; i < SOLO_BOTS; i += 1) {
        try {
          await net.send({ type: 'player/addBot', level: SOLO_LEVEL });
        } catch {
          /* the lobby has its own way to add one */
        }
      }
      render();
    } catch (error) {
      toast(error.message);
    }
  },
  async playSevensSolo() {
    try {
      const name = (ui.name || '').trim() || lastName() || 'You';
      lastName(name);
      state = await net.createGame(name, 0, 'online', { game: 'sevens' });
      ui.route = 'game';
      net.connect();
      render();
      for (let i = 0; i < SOLO_BOTS; i += 1) {
        try {
          await net.send({ type: 'player/addBot', level: SOLO_LEVEL });
        } catch {
          /* the lobby's own "+ Add a bot" is right there */
        }
      }
      render();
    } catch (error) {
      toast(error.message);
    }
  },
  async playSillyHeadSolo() {
    try {
      const name = (ui.name || '').trim() || lastName() || 'You';
      lastName(name);
      state = await net.createGame(name, 0, 'online', { game: 'sillyhead' });
      ui.route = 'game';
      net.connect();
      render();
      for (let i = 0; i < SOLO_BOTS; i += 1) {
        try {
          await net.send({ type: 'player/addBot', level: SOLO_LEVEL });
        } catch {
          /* the lobby's own "+ Add a bot" is right there */
        }
      }
    } catch (error) {
      toast(error.message);
    }
  },
  /**
   * A game against three bots, from the front door, in one tap.
   *
   * The whole point is that it costs nothing to start: no name to type, no
   * mode to choose, no code to share. It lands in the ordinary lobby rather
   * than dealing straight away, because that is where you change the
   * difficulty or the hand size — a screen that already exists, doing the job
   * it already does.
   *
   * The bots go in one at a time and a failure is survivable: a lobby with two
   * bots in it is a game you can still play, so a wobbly connection loses you a
   * seat rather than the whole thing.
   */
  async playSolo() {
    try {
      const name = (ui.name || '').trim() || lastName() || 'You';
      lastName(name);
      state = await net.createGame(name, ui.handSize || 7, 'online');
      ui.route = 'game';
      net.connect();
      render();
      // Each one is caught on its own: the game already exists and you are
      // already stood in its lobby, so a dropped request should cost a seat you
      // can add back by hand, not the game. `send` emits the new state, which
      // is what repaints the lobby as they arrive.
      for (let i = 0; i < SOLO_BOTS; i += 1) {
        try {
          await net.send({ type: 'player/addBot', level: SOLO_LEVEL });
        } catch {
          /* the lobby's own "+ Add a bot" is right there */
        }
      }
    } catch (error) {
      toast(error.message);
    }
  },
  async joinGame(code, name) {
    try {
      lastName(name);
      state = await net.joinGame(code, name);
      ui.route = 'game';
      net.connect();
      render();
    } catch (error) {
      toast(error.message);
    }
  },
  /** The Master starts a rematch. Everyone else is carried in automatically. */
  async rematch() {
    try {
      claimedRematchFor = state && state.rematchGameId; // it is ours - don't also auto-claim it
      state = await net.rematch();
      lastRoundIndex = state.roundIndex;
      lastPhase = state.phase;
      ui.route = 'game';
      ui.showCard = false;
      net.connect();
      render();
    } catch (error) {
      toast(error.message);
    }
  },
  leaveGame() {
    // In a lobby, leaving takes you out of the line-up. Once a game is running
    // it does not, because a game cannot lose a player mid-round without the
    // scores stopping making sense — you simply stop watching.
    if (state && state.phase === 'lobby' && state.you) {
      net.send({ type: 'player/remove', playerId: state.you.id }).catch(() => {});
    }
    disconnectFromGame();
    // Back to the shelf, not to the front page of the game you have just left.
    // Once there is more than one game, "out of this game" means the shelf —
    // sending people to Blob's front door was how Silly Head became unreachable
    // for anybody who had ever played anything.
    ui.resuming = null;
    ui.route = 'shelf';
    applyGameTheme(null);
    render();
  },
  /**
   * Leaving a game that has started is one-way: the session is cleared, and
   * player/join refuses once a game is running, so there is no way back in.
   * Worth a question — plenty of people will read the button as "pause".
   */
  askLeave() {
    ui.confirmLeave = true;
    render();
  },
  askEnd() {
    ui.confirmEnd = true;
    render();
  },
  cancelEnd() {
    ui.confirmEnd = false;
    render();
  },
  startCorrection() {
    ui.correcting = true;
    ui.correction = null;
    render();
  },
  cancelCorrection() {
    ui.correcting = false;
    ui.correction = null;
    render();
  },
  cancelLeave() {
    ui.confirmLeave = false;
    render();
  },
  /** Take the shared link that was asked about at boot, and leave the old game. */
  switchToPendingGame() {
    const code = ui.pendingCode;
    ui.pendingCode = null;
    // Not disconnectFromGame: joining replaces the session on success, and
    // until it does this phone still has a seat worth keeping.
    resetGameView();
    ui.code = code || '';
    ui.route = 'join';
    render();
  },
  /** Is there still a game to go back to? Drives the Back button on join. */
  hasSession() {
    return Boolean(net.session);
  },
  /** Back out of joining and pick up the game we never actually left. */
  returnToGame() {
    ui.code = '';
    ui.route = 'game';
    net.connect();
    render();
  },
  /** Keep the game we were already in and drop the link. */
  keepCurrentGame() {
    ui.pendingCode = null;
    ui.route = 'game';
    net.connect();
    render();
  },
  /**
   * A player who was not carried into a rematch automatically taps the code
   * on their own complete screen. This has to disconnect from the finished
   * game FIRST — its stream is still open and would otherwise push a
   * background 'state' update that snaps the screen straight back (the same
   * reason 'history' is the only route the state handler already lets stand
   * on its own — see the guard below).
   */
  joinDifferentGame(code) {
    disconnectFromGame();
    ui.code = code || '';
    ui.route = 'join';
    render();
  },
};

/** The reset shared by every way of stepping away from the current game. */
function disconnectFromGame() {
  net.clearSession();
  resetGameView();
}

/**
 * Drop the live game from view without giving up the seat.
 *
 * Used when we are on our way to a DIFFERENT game but have not arrived yet:
 * throwing the session away first would strand anyone who backs out, or whose
 * new code turns out to be wrong, with no way back into the game they were in.
 */
function resetGameView() {
  net.disconnect();
  state = null;
  previousOrder = [];
  lastRoundIndex = -1;
  lastPhase = null;
  claimedRematchFor = null;
  ui.bid = null;
  ui.tricks = null;
  ui.entering = false;
  ui.takeover = null;
  ui.showCard = false;
  ui.confirmLeave = false;
  ui.confirmShelf = false;
  ui.confirmEnd = false;
  ui.correcting = false;
  ui.correction = null;
  ui.lobbyHandSize = null;
  ui.shPick = null;
  ui.shChosen = null;
  ui.shConfirmReady = false;
  ui.shGiveUp = false;
  ui.shSending = null;
  ui.settingsOpen = false;
  ui.helpOpen = false;
  ui.helpStep = 0;
  ui.helpChat = null;
  ui.helpDraft = '';
  releaseWake();
}

// -- State in ----------------------------------------------------------------

net.on('state', (next) => {
  // A phone that reconnects into a game, or follows a shared link, learns which
  // game it is only when the first state lands — so the colours go on here as
  // well as at boot.
  if (next.game && next.game !== ui.game) {
    ui.game = next.game;
    applyGameTheme(next.game);
  }
  if (next.game === 'sillyhead') return onSillyHeadState(next);
  if (next.game === 'sevens') return onSevensState(next);
  if (next.game === 'chase') return onChaseState(next);
  if (next.game === 'cheat') return onCheatState(next);
  if (next.game === 'gofish') return onGoFishState(next);

  const roundChanged = next.roundIndex !== lastRoundIndex;
  const phaseChanged = next.phase !== lastPhase;

  // Keep the previous leaderboard order so the board can animate a climb.
  if (state && next.phase === 'summary' && lastPhase !== 'summary') {
    previousOrder = state.leaderboard.map((entry) => entry.id);
  }

  if (roundChanged) {
    ui.bid = null;
    ui.tricks = null;
    ui.entering = false;
    ui.takeover = null;
  }
  if (phaseChanged && next.phase !== 'reveal') ui.entering = false;
  if (phaseChanged || roundChanged) {
    ui.confirmLeave = false;
    ui.confirmEnd = false;
    // A correction belongs to the round it was opened on. Carrying a half-typed
    // one into the next round would put those numbers against the wrong hand.
    ui.correcting = false;
    ui.correction = null;
    ui.lobbyHandSize = null;
  }

  const startingRound = next.phase === 'bidding' && (roundChanged || lastPhase === null || lastPhase === 'lobby');

  /*
   * The phone buzzes for the three moments it is waiting on you, and for
   * nothing else — a new hand, your bid, your card. Anything more and people
   * stop noticing it, which defeats the point.
   */
  const wasYourTurn = Boolean(state && state.you && state.you.yourTurn);
  if (startingRound) {
    buzz([14, 70, 14]); // a new hand, for everybody
    if (next.mode === 'online') sound('deal');
  } else if (next.phase === 'bidding' && next.you && !next.you.hasSubmitted && phaseChanged) {
    buzz([14, 70, 14]);
  }
  if (next.phase === 'playing' && next.you && next.you.yourTurn && !wasYourTurn) {
    buzz(12);
    sound('turn');
  }

  // The Master has started a rematch, and it isn't the one we (as Master)
  // already switched into ourselves — everyone else carried in automatically
  // discovers their seat this way, without touching a code.
  const carriedIntoRematch =
    next.rematchGameId &&
    next.rematchGameId !== claimedRematchFor &&
    next.you &&
    next.you.id !== next.masterId;

  state = next;
  lastRoundIndex = next.roundIndex;
  lastPhase = next.phase;
  arrived(next);
  // Cards are on the table for minutes at a time — the phone must not lock in
  // the middle of a round. A finished game has no reason to hold the screen.
  if (next.phase === 'complete') releaseWake();
  else keepAwake();

  if (startingRound && next.round) showRoundIntro(next.round);
  if (phaseChanged && next.phase === 'summary') {
    const made = Boolean(next.you && next.you.madeBid);
    buzz(made ? [14, 50, 14] : 30);
    sound(made ? 'win' : 'lose');
  }
  render();

  if (carriedIntoRematch) claimRematchSeat(next.rematchGameId, next.masterName);
});

/**
 * Silly Head's snapshots.
 *
 * Its own handler rather than a pile of conditionals in Blob's: there are no
 * rounds, no bids and no score, so almost none of what that one does applies.
 * What it shares is the part that matters — the state lands, the screen is
 * redrawn, and nothing is decided on this phone.
 */
/**
 * A Chase the Ace state landing.
 *
 * The one thing worth clearing is the lifted card: it is an index into a hand
 * that may no longer be the same hand. Somebody drawing from you shifts every
 * position after the one they took, so a selection kept across that would move
 * the wrong card - and it would do it silently, which is the worst kind.
 */
function onChaseState(next) {
  const phaseChanged = next.phase !== lastPhase;
  const wasYourTurn = Boolean(state && state.you && state.you.isTurn);
  const handChanged =
    state && state.you && next.you && (state.you.hand || []).length !== (next.you.hand || []).length;

  if (phaseChanged || handChanged) ui.chasePick = null;
  if (phaseChanged) ui.confirmLeave = false;

  if (phaseChanged && next.phase === 'playing') {
    buzz([14, 70, 14]);
    sound('deal');
  }
  if (next.you && next.you.isTurn && !wasYourTurn) {
    buzz(12);
    sound('turn');
  }
  // A card changing hands, by anybody. The one sound the table makes while it is
  // somebody else's go, so you can hear the game moving without watching it.
  if (state && next.lastEvent && next.lastEvent.kind === 'draw') {
    const before = state.lastEvent ? state.lastEvent.at : null;
    if (next.lastEvent.at !== before) sound('card');
  }
  if (phaseChanged && next.phase === 'complete') {
    const lost = next.you && next.loserId === next.you.id;
    buzz(lost ? 30 : [14, 50, 14]);
    sound(lost ? 'lose' : 'win');
  }

  state = next;
  lastPhase = next.phase;
  lastRoundIndex = -1;
  arrived(next);
  if (next.phase === 'complete') releaseWake();
  else keepAwake();
  render();
}

/**
 * A Cheat state landing.
 *
 * The same job as the others: clear what this phone was holding that belongs to
 * the moment just left, make a noise at the points the game is actually waiting
 * on you, and hand over to `render()`.
 *
 * The thing worth clearing is the selection. Cards you had picked out to put
 * down belong to one turn — carrying them into the next would leave a hand
 * looking half-played, and carrying them across a pickup would show cards ticked
 * that are no longer even the same hand.
 *
 * The claim opening is the one moment this game genuinely demands your
 * attention, and it is on a clock, so it buzzes. A claim you cannot call — your
 * own — does not.
 */
function onCheatState(next) {
  const phaseChanged = next.phase !== lastPhase;
  const wasYourTurn = Boolean(state && state.you && state.you.isTurn);
  const hadClaim = Boolean(state && state.claim);
  const handChanged =
    state && state.you && next.you && (state.you.hand || []).length !== (next.you.hand || []).length;

  if (phaseChanged || handChanged || !next.you || !next.you.canClaim) ui.cheatPick = [];
  if (phaseChanged) ui.confirmLeave = false;

  if (phaseChanged && next.phase === 'playing') {
    buzz([14, 70, 14]);
    sound('deal');
  }
  if (next.you && next.you.isTurn && !wasYourTurn && !next.claim) {
    buzz(12);
    sound('turn');
  }
  // A window opening on somebody else's claim. Short, because it is a nudge to
  // look up rather than a summons — but it is on a clock, and a missed window is
  // a decision made for you.
  if (next.claim && !hadClaim) {
    sound('card');
    if (next.you && next.you.canCall) buzz(10);
  }
  // Cards turned over. The loudest moment in the game either way, and the only
  // one where the table finds out something it could not work out.
  if (next.lastEvent && next.lastEvent.kind === 'call') {
    const before = state && state.lastEvent ? state.lastEvent.at : null;
    if (next.lastEvent.at !== before) {
      buzz(next.lastEvent.honest ? 12 : [10, 40, 10]);
      sound(next.lastEvent.loserId === (next.you && next.you.id) ? 'lose' : 'card');
    }
  }
  if (phaseChanged && next.phase === 'complete') {
    const lost = next.you && next.loserId === next.you.id;
    buzz(lost ? 30 : [14, 50, 14]);
    sound(lost ? 'lose' : 'win');
  }

  state = next;
  lastPhase = next.phase;
  lastRoundIndex = -1;
  arrived(next);
  if (next.phase === 'complete') releaseWake();
  else keepAwake();
  render();
}

/**
 * A Sevens state landing.
 *
 * The same job as Silly Head's: clear anything this phone was holding that
 * belongs to the phase just left, make a noise at the two or three moments the
 * game is actually waiting on you, and then hand over to `render()`. Nothing is
 * decided here.
 *
 * Sevens has almost nothing to clear, because it has almost no local UI state —
 * you tap a card and it goes, so there is no selection to strand.
 */
function onSevensState(next) {
  const phaseChanged = next.phase !== lastPhase;
  const wasYourTurn = Boolean(state && state.you && state.you.isTurn);

  if (phaseChanged) ui.confirmLeave = false;

  if (phaseChanged && next.phase === 'playing') {
    buzz([14, 70, 14]);
    sound('deal');
  }
  if (next.you && next.you.isTurn && !wasYourTurn) {
    buzz(12);
    sound('turn');
  }
  // A card going down, played by anybody. The one sound the table makes while it
  // is somebody else's go, so you can tell the game is moving without watching.
  if (state && next.lastEvent && next.lastEvent.kind === 'play') {
    const before = state.lastEvent ? state.lastEvent.at : null;
    if (next.lastEvent.at !== before) sound('card');
  }
  if (phaseChanged && next.phase === 'complete') {
    const won = next.finished && next.finished.length && next.you && next.finished[0].id === next.you.id;
    buzz(won ? [14, 50, 14] : 30);
    sound(won ? 'win' : 'lose');
  }

  state = next;
  lastPhase = next.phase;
  lastRoundIndex = -1;
  arrived(next);
  if (next.phase === 'complete') releaseWake();
  else keepAwake();
  render();
}

function onSillyHeadState(next) {
  const phaseChanged = next.phase !== lastPhase;
  const wasYourTurn = Boolean(state && state.you && state.you.isTurn);

  if (phaseChanged) {
    ui.shPick = null;
    ui.shChosen = null;
    ui.shConfirmReady = false;
    ui.shGiveUp = false;
    ui.shSending = null;
    ui.confirmLeave = false;
  }
  // The three moments the game is waiting on you, and nothing else: the cards
  // arriving, and your go.
  if (phaseChanged && next.phase === 'sort') {
    buzz([14, 70, 14]);
    sound('deal');
  }
  if (next.you && next.you.isTurn && !wasYourTurn) {
    buzz(12);
    sound('turn');
  }
  if (phaseChanged && next.phase === 'complete') {
    const won = next.finished && next.finished.length && next.you && next.finished[0].id === next.you.id;
    buzz(won ? [14, 50, 14] : 30);
    sound(won ? 'win' : 'lose');
  }

  state = next;
  lastPhase = next.phase;
  lastRoundIndex = -1;
  arrived(next);
  if (next.phase === 'complete') releaseWake();
  else keepAwake();
  render();
}

/**
 * A state has landed: put its colours on and show the game it belongs to.
 *
 * Two screens it must NOT drag you off, and they are the two you can only be on
 * deliberately. The history is somebody reading last week's scores while a game
 * runs on in another room. A game's own front page is somebody who went to the
 * shelf and tapped the other tile — a bot moving in the game they left should
 * not throw them back into it mid-tap.
 */
function arrived(next) {
  ui.resuming = null;
  const chosen = ui.route === 'history' || ui.route === 'home' || ui.route === 'create';
  if (chosen) return;
  if (ui.route !== 'game') applyGameTheme(next.game || 'blob');
  ui.route = 'game';
}

net.on('status', renderConnection);

net.on('gone', (error) => {
  toast(error.message || 'That game has finished.');
  ctx.leaveGame();
});

/** Out of whatever this is, and back to the shelf to pick something else. */
ctx.backToShelf = () => {
  if (state) {
    disconnectFromGame();
  }
  ui.settingsOpen = false;
  ui.resuming = null;
  ui.route = 'shelf';
  // The shelf shows the games in their own colours, so it wears neither.
  applyGameTheme(null);
  render();
};

// -- Render ------------------------------------------------------------------

/**
 * A Go Fish state landing.
 *
 * The same job as the others: drop what this phone was holding that belongs to
 * the moment just left, make a noise at the points the game is genuinely waiting
 * on you, and hand over to `render()`.
 *
 * The thing worth clearing is the rank you had picked. It belongs to one turn,
 * and carrying it across a handover would leave cards lifted that are no longer
 * the same hand - or worse, leave a rank selected that you have just given away.
 *
 * **Being asked is the one moment this game demands your attention**, so that is
 * the one that buzzes. Nothing here is on a clock, but a table of four people
 * looking at you is its own kind of deadline.
 */
function onGoFishState(next) {
  const phaseChanged = next.phase !== lastPhase;
  const wasYourTurn = Boolean(state && state.you && state.you.isTurn);
  const wasAsked = Boolean(state && state.you && state.you.answering);
  const handChanged =
    state && state.you && next.you && (state.you.hand || []).length !== (next.you.hand || []).length;

  if (phaseChanged || handChanged || !next.you || !next.you.isTurn || next.ask) ui.gfRank = null;
  if (phaseChanged) ui.confirmLeave = false;

  if (phaseChanged && next.phase === 'playing') {
    buzz([14, 70, 14]);
    sound('deal');
  }
  // Somebody has asked you a question and the table is looking at you.
  if (next.you && next.you.answering && !wasAsked) {
    buzz([10, 40, 10]);
    sound('turn');
  }
  if (next.you && next.you.isTurn && !wasYourTurn && !next.ask) {
    buzz(12);
    sound('turn');
  }
  // A card changing hands, by anybody. The sound the table makes while it is
  // somebody else's go, so you can hear the game moving without watching it.
  if (state && next.lastEvent && (next.lastEvent.kind === 'give' || next.lastEvent.kind === 'fish')) {
    const before = state.lastEvent ? state.lastEvent.at : null;
    if (next.lastEvent.at !== before) sound('card');
  }
  // A book going down is the only thing in this game that scores.
  if (state && next.lastEvent && next.lastEvent.kind === 'book') {
    const before = state.lastEvent ? state.lastEvent.at : null;
    if (next.lastEvent.at !== before) {
      sound(next.lastEvent.playerId === (next.you && next.you.id) ? 'win' : 'card');
      if (next.lastEvent.playerId === (next.you && next.you.id)) buzz(14);
    }
  }
  if (phaseChanged && next.phase === 'complete') {
    const won = next.you && (next.winners || []).some((w) => w.id === next.you.id);
    buzz(won ? [14, 50, 14] : 20);
    sound(won ? 'win' : 'lose');
  }

  state = next;
  lastPhase = next.phase;
  lastRoundIndex = -1;
  arrived(next);
  if (next.phase === 'complete') releaseWake();
  else keepAwake();
  render();
}

function pickScreen() {
  if (ui.pendingCode) return switchGameScreen(ctx);
  if (ui.route === 'history') return historyScreen(ctx);
  if (!state && ui.route === 'shelf') return shelfScreen(ctx);
  if (!state || ui.route !== 'game') {
    // Silly Head has its own front page and its own new-game form, and it gets
    // them for every route except joining — a code and a name is the same job
    // whatever is being played.
    //
    // Listed as the exception rather than as the two routes that qualify. It
    // was the other way round, which meant a route that was neither — a phone
    // reopening into a Silly Head game the server no longer has, which on the
    // free instance is every game after it has slept — fell through to BLOB's
    // front page wearing Silly Head's green, with no Silly Head anywhere on it.
    const shared = ui.route === 'join' || ui.route === 'nudge';
    if (ui.game === 'sillyhead' && !shared) return sillyheadWelcome(ctx);
    if (ui.game === 'sevens' && !shared) return sevensWelcome(ctx);
    if (ui.game === 'chase' && !shared) return chaseWelcome(ctx);
    if (ui.game === 'cheat' && !shared) return cheatWelcome(ctx);
    if (ui.game === 'gofish' && !shared) return gofishWelcome(ctx);
    return welcomeScreen(ctx);
  }
  if (state.game === 'sillyhead') return sillyheadScreen(ctx);
  if (state.game === 'sevens') return sevensScreen(ctx);
  if (state.game === 'chase') return chaseScreen(ctx);
  if (state.game === 'cheat') return cheatScreen(ctx);
  if (state.game === 'gofish') return gofishScreen(ctx);
  // Handing the phone to someone else outranks the phase. Their bid is often
  // the one that locks the round, and without this the phone would jump
  // straight to the revealed bids while they were still holding it - losing
  // the "pass it back" step, and showing them the reveal first.
  if (ui.takeover) return biddingScreen(ctx);
  if (state.phase === 'lobby') return lobbyScreen(ctx);
  if (state.phase === 'bidding') return biddingScreen(ctx);
  if (state.phase === 'playing') return playingScreen(ctx);
  if (state.phase === 'reveal') return revealScreen(ctx);
  if (state.phase === 'summary') return summaryScreen(ctx);
  if (state.phase === 'complete') return completeScreen(ctx);
  return welcomeScreen(ctx);
}

/**
 * Which screen this is, for deciding whether arriving at it is a new arrival.
 *
 * Every state the server pushes rebuilds the whole screen, so the entry
 * animation has to be told the difference between arriving somewhere and
 * repainting where you already are — otherwise the screen twitches every time
 * anybody plays a card.
 */
function screenKey() {
  if (ui.pendingCode) return 'switch';
  if (ui.route === 'history') return `history:${ui.historyRecord ? 'one' : 'list'}`;
  if (!state && ui.route === 'shelf') return 'shelf';
  if (!state || ui.route !== 'game') return `welcome:${ui.game}:${ui.route}`;
  if (state.game === 'sillyhead') return `sillyhead:${state.phase}:${ui.shConfirmReady ? 'ready' : ''}`;
  if (state.game === 'sevens') return sevensScreenKey(state);
  if (state.game === 'chase') return chaseScreenKey(state);
  if (state.game === 'cheat') return cheatScreenKey(state);
  if (state.game === 'gofish') return gofishScreenKey(state);
  if (ui.takeover) return 'takeover';
  return `game:${state.phase}:${ui.correcting ? 'fix' : ''}`;
}

let lastScreenKey = null;
let enteredAt = 0;
/** How long an arrival stays an arrival, in ms — the entry animation's length. */
const ENTER_MS = 280;

/**
 * Everything the standing overlays are drawn from, and nothing else.
 *
 * The whole point is what is ABSENT: no version, no turn, no hand, nothing that
 * moves when somebody plays a card. If the settings sheet ever starts showing
 * something live, it goes in here — and if it shows something live that changes
 * every second, it does not belong in a sheet.
 *
 * The help draft is in here because typing has to repaint the field, which is
 * how it already worked; `render()` puts the caret back afterwards.
 */
function overlayKey() {
  if (!ui.settingsOpen && !ui.helpOpen) return 'none';
  return [
    ui.settingsOpen ? 'settings' : '',
    ui.confirmShelf ? 'confirm' : '',
    ui.helpOpen ? 'help' : '',
    ui.helpTab || '',
    ui.helpStep || 0,
    ui.helpThinking ? 'thinking' : '',
    (ui.helpChat || []).length,
    ui.helpDraft || '',
    ui.game,
    (state && state.game) || '',
    state ? 'in-game' : 'no-game',
    currentSize(),
    soundOn() ? 'sound' : 'quiet',
    askBeforeStart() ? 'ask' : 'no-ask',
  ].join('|');
}

let lastOverlayKey = null;

/** Rebuild the standing overlays, but only when they have actually changed. */
function renderOverlays() {
  const key = overlayKey();
  if (key === lastOverlayKey) return;
  lastOverlayKey = key;
  fill(overlayHost, settingsSheet(ctx), helpOverlay(ctx));
}

function render() {
  // Keep whatever the player was typing in, and where their cursor was.
  const active = document.activeElement;
  const focusKey = active && active.dataset ? active.dataset.focusKey : null;
  const caret = focusKey && 'selectionStart' in active ? active.selectionStart : null;

  const screen = pickScreen();
  const key = screenKey();
  const arriving = key !== lastScreenKey;
  if (arriving) {
    lastScreenKey = key;
    enteredAt = Date.now();
  }
  // A command usually lands twice — once as its reply, once as the pushed state
  // — and the second render would otherwise wipe the animation off a screen that
  // had only just started playing it.
  if (arriving || Date.now() - enteredAt < ENTER_MS) screen.classList.add('screen--enter');
  // The election overlay stays with the screen on purpose: votes arriving IS
  // the content of it, so it is the one overlay that has to repaint on a push.
  const overlay = state ? electionOverlay(ctx) : null;
  fill(screenHost, screen, overlay);
  renderOverlays();

  // Searches the whole of `#app`, so it covers the screen and the overlays alike.
  if (focusKey) {
    const restored = root.querySelector(`[data-focus-key="${focusKey}"]`);
    if (restored) {
      restored.focus();
      if (caret !== null && 'setSelectionRange' in restored) {
        try {
          restored.setSelectionRange(caret, caret);
        } catch {
          /* not a text field after all */
        }
      }
    }
  }
}

/**
 * "Round 6 / 2 cards", briefly, before the bidding pad. It is the beat that
 * makes a new hand feel like an event rather than a form reappearing.
 */
function showRoundIntro(round) {
  const existing = document.querySelector('.round-intro');
  if (existing) existing.remove();

  const intro = h(
    'div.round-intro',
    { role: 'status' },
    h(
      'div',
      h('div.round-intro__round', { text: `Round ${round.number} of ${round.totalRounds}` }),
      h('div.round-intro__cards.tabular', { text: String(round.handSize) }),
      h('div.round-intro__label', { text: round.handSize === 1 ? 'card' : 'cards' })
    )
  );
  document.body.appendChild(intro);
  setTimeout(() => intro.remove(), reducedMotion() ? 1500 : 1950);
}

/**
 * Everyone but the Master lands here automatically when a rematch starts: a
 * brief "X started a new game" beat, the same idea as the round intro, then a
 * swap onto the new lobby with nothing for them to type. A player who was not
 * reachable when the rematch was created (never connected, or dropped before
 * it started) gets a friendly 404 here — not a fault, just no automatic seat
 * — and their own complete screen already shows the public code as the way
 * back in, so there is nothing further to do for them.
 */
async function claimRematchSeat(rematchGameId, masterName) {
  claimedRematchFor = rematchGameId;

  const intro = h(
    'div.round-intro',
    { role: 'status' },
    h(
      'div.stack.center',
      mascot('cheer', { size: 'lg' }),
      h('div.round-intro__label', { text: `${masterName || 'The Master'} started a new game!` })
    )
  );
  document.body.appendChild(intro);

  try {
    const newState = await net.claimRematchSession();
    // Give the beat a moment to land before the screen changes under them —
    // an instant swap reads as a glitch, a short pause reads as intentional.
    await new Promise((resolve) => setTimeout(resolve, reducedMotion() ? 200 : 1300));
    state = newState;
    lastRoundIndex = newState.roundIndex;
    lastPhase = newState.phase;
    ui.route = 'game';
    ui.showCard = false;
    net.connect();
    render();
  } catch (error) {
    if (error.status !== 404) toast(error.message);
  } finally {
    intro.remove();
  }
}

// -- Connection and errors ---------------------------------------------------

const connection = h('div.conn', { role: 'status', 'aria-live': 'polite' });
const toastEl = h('div.toast', { role: 'status', 'aria-live': 'polite' });
document.body.append(connection, toastEl);

/**
 * Connection trouble is stated in plain language and never as an error the
 * player has to act on — right up until it genuinely needs them to.
 */
function renderConnection(status) {
  connection.className = 'conn';
  if (status === LIVE || !net.session) {
    connection.classList.remove('conn--show');
    return;
  }
  connection.classList.add('conn--show');

  if (status === LOST) {
    connection.classList.add('conn--bad');
    fill(
      connection,
      h('span', { text: "Can't reach the game." }),
      h('button.btn.btn--small', {
        text: 'Try again',
        type: 'button',
        style: { background: '#fff', color: 'var(--ink-dark)', 'min-height': '32px', padding: '6px 12px' },
        onClick: () => net.retryNow(),
      })
    );
    return;
  }

  fill(
    connection,
    h('span.conn__dot'),
    h('span', { text: status === RETRYING ? 'Connection lost. Reconnecting…' : 'Connecting…' })
  );
}

function toast(message) {
  toastEl.textContent = message;
  toastEl.classList.add('toast--show');
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove('toast--show'), 3600);
}

// Anything that gets this far is a bug, not something a player should read raw.
window.addEventListener('error', () => toast('Something went wrong. We are putting it right.'));
window.addEventListener('unhandledrejection', (event) => {
  event.preventDefault();
  toast('Something went wrong. Please try that again.');
});

// -- Boot --------------------------------------------------------------------

function boot() {
  // A session remembers which game it is in, so a phone reopening into a game
  // knows which one it is asking the server about.
  const saved = net.session;
  if (saved && saved.game) ui.game = saved.game;

  // Both before the first paint, so nobody sees the default size or the default
  // colours flash past.
  applySize(currentSize());
  applyGameTheme(ui.game);

  // A scanned QR or a shared link lands on /?c=4827 with the code filled in.
  const params = new URLSearchParams(location.search);
  const code = (params.get('c') || '').replace(/\D/g, '');
  const session = net.session;
  if (code) history.replaceState(null, '', location.pathname);

  if (code && !session) {
    ui.code = code;
    ui.route = 'join';
  } else if (code && session && session.code !== code) {
    // A link for a game we are not in. Ignoring it silently would drop the
    // player straight back into their old game with no hint of why, so ask
    // instead — and stay disconnected until they choose, so the old game's
    // stream cannot push a state update over the question.
    ui.pendingCode = code;
  } else if (session) {
    // The front door is the shelf, even with a game to go back to.
    //
    // The state cannot possibly have arrived yet — it is a round trip away —
    // so SOMETHING is drawn first, and it used to be the front page of the game
    // in the session: a mode picker, for a game already in progress, wearing
    // that game's colours. When the state landed a moment later it was gone
    // again and nobody noticed. When the state did NOT land — the free instance
    // asleep, no signal, a game the server has since forgotten — that was the
    // screen you were left on, with no way to reach the other game from it.
    //
    // The shelf is a better thing to be left on: it is the front door, it says
    // what the app is, and both games are one tap away. The game you were in
    // sits at the top of it and opens itself the moment the server answers, so
    // a phone picked up mid-hand still goes straight back to the table.
    ui.route = 'shelf';
    ui.resuming = { game: session.game || null, code: session.code || null };
    applyGameTheme(null);
    net.connect();
  }

  render();
  renderConnection(net.status);

  // How tall the app may be, measured now that there is something to measure,
  // and again whenever the window changes shape — which on a phone is the
  // browser's own bar sliding in and out as much as it is anybody turning
  // their phone over.
  pinViewport();
  window.addEventListener('resize', pinViewport);
  window.addEventListener('orientationchange', pinViewport);

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').catch(() => {
      // A missing service worker costs offline caching, nothing else.
    });
  }
}

boot();

export { ctx, net };
