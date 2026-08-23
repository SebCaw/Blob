/**
 * Talking to the server.
 *
 * Push comes down one Server-Sent Events stream; commands go up as ordinary
 * POSTs. The browser retries an EventSource on its own, which covers the
 * common case (a phone locking, a lift, a moment of no signal) with no code —
 * what is added here is a session that survives a refresh, backoff for the
 * cases the browser gives up on, and an immediate retry when the player brings
 * the app back to the front.
 */

const SESSION_KEY = 'blob.session';
const MINE_KEY = 'blob.games';

/** Connection states the UI reacts to. */
export const LIVE = 'live';
export const CONNECTING = 'connecting';
export const RETRYING = 'retrying';
export const LOST = 'lost';

/** The server sends a heartbeat every 10 seconds. */
const WATCHDOG_MS = 4000;
/** Two missed heartbeats and a bit: long enough not to be twitchy about it. */
const SILENCE_LIMIT_MS = 25000;

export class Net {
  constructor() {
    /** @type {{gameId:string, playerId:string, token:string, code:string}|null} */
    this.session = readSession();
    /** @type {EventSource|null} */
    this.source = null;
    this.status = CONNECTING;
    this.attempts = 0;
    this.retryTimer = null;
    this.lastMessageAt = 0;
    this.watchdog = null;
    /** @type {{state:Function[], status:Function[], gone:Function[]}} */
    this.handlers = { state: [], status: [], gone: [] };

    // A phone that has been asleep often has a stream the server has long since
    // given up on. Coming back to the app is the moment to check.
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden && this.status !== LIVE) this.connect();
    });
    window.addEventListener('online', () => {
      if (this.status !== LIVE) this.connect();
    });
    // The phone knowing it is offline is the fastest signal there is - far
    // quicker than waiting for a heartbeat to go missing.
    window.addEventListener('offline', () => {
      if (this.session && this.status === LIVE) this.setStatus(RETRYING);
    });
  }

  /** @param {'state'|'status'|'gone'} event */
  on(event, handler) {
    this.handlers[event].push(handler);
    return this;
  }

  emit(event, payload) {
    this.handlers[event].forEach((handler) => handler(payload));
  }

  // -- Session ---------------------------------------------------------------

  setSession(session) {
    this.session = session;
    writeSession(session);
    if (session) rememberGame(session);
  }

  clearSession() {
    this.session = null;
    writeSession(null);
    this.disconnect();
  }

  // -- Joining ---------------------------------------------------------------

  /** @returns {Promise<object>} the first state */
  async createGame(name, handSize, mode, extra = {}) {
    const data = await post('/api/games', {
      name,
      handSize,
      mode: mode === 'online' ? 'online' : 'table',
      // Which game off the shelf, and its own options. A server that predates
      // the shelf ignores both and deals Blob, which is the right fallback.
      game: extra.game || 'blob',
      quick: Boolean(extra.quick),
    });
    this.setSession(pickSession(data));
    return data.state;
  }

  /** @returns {Promise<object>} the first state */
  async joinGame(code, name) {
    const data = await post(`/api/games/${encodeURIComponent(code)}/join`, { name });
    this.setSession(pickSession(data));
    return data.state;
  }

  /** Is there a game behind this code? Used to fail fast on the join screen. */
  async lookup(code) {
    const res = await fetch(`/api/games/${encodeURIComponent(code)}`);
    if (!res.ok) throw await asError(res);
    return res.json();
  }

  /**
   * The Master starts a rematch of the game that just finished — a fresh
   * lobby, same starting hand size, with everyone reachable carried straight
   * in. Swaps this phone onto the new session and returns its first state.
   * @returns {Promise<object>}
   */
  async rematch() {
    if (!this.session) throw new Error('You are not in a game.');
    const { gameId, playerId, token } = this.session;
    const data = await post(`/api/games/${encodeURIComponent(gameId)}/rematch`, { playerId, token });
    this.setSession(pickSession(data));
    return data.state;
  }

  /**
   * For everyone but the Master: once the finished game announces a rematch,
   * each player fetches their own seat in it, proving who they are with their
   * OLD session. Throws a 404-flavoured error for a player who was not
   * reachable when the rematch was created — the caller should treat that as
   * "no automatic seat" and fall back to the public join code, not as a fault.
   * @returns {Promise<object>}
   */
  async claimRematchSession() {
    if (!this.session) throw new Error('You are not in a game.');
    const { gameId, playerId, token } = this.session;
    const data = await post(`/api/games/${encodeURIComponent(gameId)}/rematch-session`, { playerId, token });
    this.setSession(pickSession(data));
    return data.state;
  }

  // -- Commands --------------------------------------------------------------

  /**
   * Send a command. Every one carries a generated id, so a retry — whether the
   * player's or the network's — can never apply the same action twice.
   *
   * @param {{type:string,[k:string]:any}} command
   * @returns {Promise<object>} the state as the server sees it after applying
   */
  async send(command) {
    if (!this.session) throw new Error('You are not in a game.');
    const body = {
      gameId: this.session.gameId,
      playerId: this.session.playerId,
      token: this.session.token,
      cmdId: `${this.session.playerId}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      command,
    };
    const res = await fetch('/api/command', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const error = await asError(res);
      if (res.status === 401 || res.status === 404) this.emit('gone', error);
      throw error;
    }
    const data = await res.json();
    if (data.state) this.emit('state', data.state);
    return data.state;
  }

  // -- The stream ------------------------------------------------------------

  connect() {
    if (!this.session) return;
    this.disconnect();
    this.setStatus(this.attempts ? RETRYING : CONNECTING);

    const { gameId, playerId, token } = this.session;
    const url = `/api/stream?gameId=${encodeURIComponent(gameId)}&playerId=${encodeURIComponent(
      playerId
    )}&token=${encodeURIComponent(token)}`;

    const source = new EventSource(url);
    this.source = source;

    source.addEventListener('state', (event) => {
      this.noteMessage();
      try {
        this.emit('state', JSON.parse(event.data));
      } catch {
        // A malformed frame is not worth troubling the player with; the next
        // snapshot will put things right.
      }
    });

    // The server's heartbeat, which has to be answered: SSE only pushes, so a
    // pong is the only way the server can tell this phone is still here.
    source.addEventListener('ping', () => {
      this.noteMessage();
      this.pong();
    });

    source.onopen = () => this.noteMessage();

    source.onerror = () => {
      if (source !== this.source) return;
      // CONNECTING means the browser is already retrying for us. CLOSED means
      // it has given up — usually a rejected session or a game that has gone.
      if (source.readyState === EventSource.CONNECTING) {
        this.setStatus(RETRYING);
        return;
      }
      this.disconnect();
      this.attempts += 1;
      if (this.attempts > 6) {
        this.setStatus(LOST);
        return;
      }
      this.setStatus(RETRYING);
      const wait = Math.min(1000 * 2 ** (this.attempts - 1), 15000);
      this.retryTimer = setTimeout(() => this.connect(), wait);
    };
  }

  /** Answer the server's heartbeat. Failures are ignored; the next one will do. */
  pong() {
    if (!this.session) return;
    const { gameId, playerId, token } = this.session;
    fetch('/api/ping', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ gameId, playerId, token }),
      keepalive: true,
    }).catch(() => {});
  }

  /** Something arrived, so the stream is definitely alive. */
  noteMessage() {
    this.lastMessageAt = Date.now();
    this.attempts = 0;
    this.setStatus(LIVE);
    this.armWatchdog();
  }

  /**
   * A mobile connection can go away without either end being told — the socket
   * stays open and nothing ever arrives. The server's heartbeat is what makes
   * that visible: if one goes missing, the stream is treated as dead and
   * rebuilt, rather than sitting on a connection that will never speak again.
   */
  armWatchdog() {
    if (this.watchdog) clearInterval(this.watchdog);
    this.watchdog = setInterval(() => {
      if (!this.session || this.status !== LIVE) return;
      const silence = Date.now() - this.lastMessageAt;
      if (silence < SILENCE_LIMIT_MS) return;
      this.setStatus(RETRYING);
      this.connect();
    }, WATCHDOG_MS);
    if (this.watchdog.unref) this.watchdog.unref();
  }

  disconnect() {
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
    if (this.source) {
      this.source.close();
      this.source = null;
    }
  }

  /** Try again right now, after the player taps "Try again". */
  retryNow() {
    this.attempts = 0;
    this.connect();
  }

  setStatus(status) {
    if (this.status === status) return;
    this.status = status;
    this.emit('status', status);
  }
}

// -- Helpers ------------------------------------------------------------------

async function post(url, body) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw await asError(res);
  return res.json();
}

/**
 * Turn a failed response into an error a player can read. The server always
 * sends a friendly message; this is the fallback for when it cannot.
 */
async function asError(res) {
  let message = 'Something went wrong. Please try again.';
  try {
    const data = await res.json();
    if (data && data.error && data.error.message) message = data.error.message;
  } catch {
    /* not json - keep the friendly default */
  }
  const error = new Error(message);
  error.status = res.status;
  return error;
}

function pickSession(data) {
  return {
    gameId: data.gameId,
    playerId: data.playerId,
    token: data.token,
    code: data.code,
    // Which game this seat is in. Kept so that reopening the app knows what it
    // is reconnecting to BEFORE the first state arrives — otherwise it wears
    // the wrong colours for a moment and, if the connection is slow or the game
    // has gone, shows the wrong game's front page entirely.
    game: data.game || (data.state && data.state.game) || 'blob',
  };
}

function readSession() {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && parsed.gameId && parsed.playerId && parsed.token ? parsed : null;
  } catch {
    return null;
  }
}

function writeSession(session) {
  try {
    if (session) localStorage.setItem(SESSION_KEY, JSON.stringify(session));
    else localStorage.removeItem(SESSION_KEY);
  } catch {
    // Private browsing can refuse storage. The game still works for as long as
    // the tab stays open, which is better than refusing to start.
  }
}

/** Remember which games this phone played, so history can show yours first. */
function rememberGame(session) {
  try {
    const list = myGames();
    if (!list.includes(session.gameId)) {
      list.unshift(session.gameId);
      localStorage.setItem(MINE_KEY, JSON.stringify(list.slice(0, 60)));
    }
  } catch {
    /* storage unavailable */
  }
}

/** @returns {string[]} game ids this phone has taken part in */
export function myGames() {
  try {
    const raw = localStorage.getItem(MINE_KEY);
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

/** The name this phone used last, so returning players do not retype it. */
export function lastName(value) {
  try {
    if (value === undefined) return localStorage.getItem('blob.name') || '';
    localStorage.setItem('blob.name', value);
  } catch {
    /* storage unavailable */
  }
  return value || '';
}
