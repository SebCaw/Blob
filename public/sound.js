/**
 * The noises a table makes.
 *
 * Synthesised on the spot with the Web Audio API rather than loaded as files:
 * no assets to cache, nothing to download on a pub wifi, and — the reason that
 * matters most here — no third-party anything, so the Content-Security-Policy
 * in `server/http.js` stays as tight as it is.
 *
 * They are short and quiet on purpose. This is the sound of cards being put
 * down, not a soundtrack: nobody wants a loop playing while they think about a
 * bid, and anything you would want to turn off after two hands should not have
 * been there in the first place. There is a switch in Settings all the same.
 */

const STORE_KEY = 'blob.sound';

/** Master level. Everything below is a fraction of this, so one number is loud. */
const VOLUME = 0.16;

/** @type {AudioContext|null} */
let audio = null;
/** @type {AudioBuffer|null} */
let noiseBuffer = null;

/** Is sound on? On unless it has been turned off — they were asked for. */
export function soundOn() {
  try {
    return localStorage.getItem(STORE_KEY) !== 'off';
  } catch {
    return true;
  }
}

/** @param {boolean} on */
export function setSound(on) {
  try {
    localStorage.setItem(STORE_KEY, on ? 'on' : 'off');
  } catch {
    /* storage unavailable — it will simply not be remembered */
  }
  if (on) play('card');
}

/**
 * The audio context, made on first use.
 *
 * Browsers refuse to start one until the page has been tapped, so it cannot be
 * built at load time — and a context created too early arrives `suspended` and
 * stays that way silently. Every sound here follows a tap, so by the time this
 * runs there has always been one.
 */
function context() {
  if (!soundOn()) return null;
  try {
    if (!audio) {
      const Ctor = window.AudioContext || window.webkitAudioContext;
      if (!Ctor) return null;
      audio = new Ctor();
    }
    if (audio.state === 'suspended') audio.resume();
    return audio;
  } catch {
    return null;
  }
}

/** A second of white noise, made once and re-used — the basis of every card sound. */
function noise(ctx) {
  if (noiseBuffer) return noiseBuffer;
  const frames = ctx.sampleRate;
  noiseBuffer = ctx.createBuffer(1, frames, ctx.sampleRate);
  const data = noiseBuffer.getChannelData(0);
  for (let i = 0; i < frames; i += 1) data[i] = Math.random() * 2 - 1;
  return noiseBuffer;
}

/**
 * One note.
 *
 * The gain ramps rather than switching, because a square edge on a gain node is
 * an audible click — which on a card game sounds exactly like a bug.
 */
function tone(ctx, { freq, at = 0, dur = 0.12, type = 'sine', gain = 1, glide = 0 }) {
  const osc = ctx.createOscillator();
  const amp = ctx.createGain();
  const start = ctx.currentTime + at;
  osc.type = type;
  osc.frequency.setValueAtTime(freq, start);
  if (glide) osc.frequency.exponentialRampToValueAtTime(glide, start + dur);
  amp.gain.setValueAtTime(0.0001, start);
  amp.gain.exponentialRampToValueAtTime(VOLUME * gain, start + 0.012);
  amp.gain.exponentialRampToValueAtTime(0.0001, start + dur);
  osc.connect(amp).connect(ctx.destination);
  osc.start(start);
  osc.stop(start + dur + 0.02);
}

/** A card moving: a filtered burst of noise, which is what card on baize is. */
function brush(ctx, { at = 0, dur = 0.09, gain = 1, freq = 2400 }) {
  const src = ctx.createBufferSource();
  const band = ctx.createBiquadFilter();
  const amp = ctx.createGain();
  const start = ctx.currentTime + at;
  src.buffer = noise(ctx);
  src.loop = true;
  band.type = 'bandpass';
  band.frequency.setValueAtTime(freq, start);
  band.Q.value = 0.9;
  amp.gain.setValueAtTime(0.0001, start);
  amp.gain.exponentialRampToValueAtTime(VOLUME * gain, start + 0.008);
  amp.gain.exponentialRampToValueAtTime(0.0001, start + dur);
  src.connect(band).connect(amp).connect(ctx.destination);
  src.start(start);
  src.stop(start + dur + 0.02);
}

/**
 * Every sound the game makes, by name.
 *
 * Kept in one table so the whole palette can be read at once — it is very easy
 * to add one more beep and end up with an app that chirps constantly.
 */
const SOUNDS = {
  /** A card going down, yours or anybody's. The one heard most, so the quietest. */
  card(ctx) {
    brush(ctx, { dur: 0.075, gain: 0.55, freq: 2600 });
    tone(ctx, { freq: 190, dur: 0.05, type: 'triangle', gain: 0.3 });
  },
  /** The deal: a run of cards off the top of the deck. */
  deal(ctx) {
    for (let i = 0; i < 6; i += 1) {
      brush(ctx, { at: i * 0.075, dur: 0.06, gain: 0.32, freq: 2200 + i * 120 });
    }
  },
  /** Somebody has taken the trick and is gathering the cards in. */
  trick(ctx) {
    brush(ctx, { dur: 0.2, gain: 0.4, freq: 1500 });
    tone(ctx, { freq: 392, at: 0.03, dur: 0.14, type: 'triangle', gain: 0.5 });
    tone(ctx, { freq: 587, at: 0.1, dur: 0.16, type: 'triangle', gain: 0.45 });
  },
  /** The table is waiting on you. Two soft notes, easy to ignore once you know it. */
  turn(ctx) {
    tone(ctx, { freq: 660, dur: 0.1, type: 'sine', gain: 0.5 });
    tone(ctx, { freq: 880, at: 0.09, dur: 0.12, type: 'sine', gain: 0.45 });
  },
  /** A bid going in. */
  bid(ctx) {
    tone(ctx, { freq: 520, dur: 0.1, type: 'triangle', gain: 0.5, glide: 780 });
  },
  /** You made it. */
  win(ctx) {
    [523, 659, 784].forEach((freq, i) => {
      tone(ctx, { freq, at: i * 0.07, dur: 0.18, type: 'triangle', gain: 0.5 });
    });
  },
  /** You did not. Short, and never comic — losing a hand is annoying enough. */
  lose(ctx) {
    tone(ctx, { freq: 330, dur: 0.16, type: 'sine', gain: 0.4, glide: 220 });
  },
};

/**
 * Make a noise, if sound is on and this browser can.
 *
 * Never throws and never awaits: a game must not depend on audio working, and
 * every call site treats it as decoration.
 *
 * @param {'card'|'deal'|'trick'|'turn'|'bid'|'win'|'lose'} name
 */
export function play(name) {
  const make = SOUNDS[name];
  if (!make) return;
  try {
    const ctx = context();
    if (ctx) make(ctx);
  } catch {
    /* audio is decoration; a table that makes no noise still works */
  }
}
