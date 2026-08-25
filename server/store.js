'use strict';

const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const { engineById, DEFAULT_ENGINE } = require('../lib/engines');

/**
 * Persistence for Blob.
 *
 * Two kinds of file, with different jobs:
 *   live/<gameId>.json     a snapshot of a game in progress, so a server restart
 *                          does not lose a table full of people mid-round.
 *   history/<gameId>.json  the permanent record of a finished game.
 *
 * Deliberately a narrow interface (`saveLive`, `loadAllLive`, `saveHistory`,
 * `listHistory`, `readHistory`) so the JSON files could be swapped for a
 * database later without anything above this file noticing.
 */
class Store {
  /** @param {string} dir */
  constructor(dir) {
    this.dir = dir;
    this.liveDir = path.join(dir, 'live');
    this.historyDir = path.join(dir, 'history');
    /** @type {Map<string, NodeJS.Timeout>} */
    this.pending = new Map();
  }

  init() {
    fs.mkdirSync(this.liveDir, { recursive: true });
    fs.mkdirSync(this.historyDir, { recursive: true });
  }

  /**
   * Write a live snapshot, coalescing bursts. A round of bidding fires several
   * state changes in a second and none of them need their own disk write.
   * @param {string} gameId
   * @param {() => object} snapshot called at flush time, so it writes the latest
   * @param {number} [delay]
   */
  saveLiveDebounced(gameId, snapshot, delay = 400) {
    if (this.pending.has(gameId)) clearTimeout(this.pending.get(gameId));
    const timer = setTimeout(() => {
      this.pending.delete(gameId);
      this.saveLive(gameId, snapshot()).catch((err) => {
        console.error('[blob] could not save game', gameId, err.message);
      });
    }, delay);
    if (timer.unref) timer.unref();
    this.pending.set(gameId, timer);
  }

  /** Flush any pending write for a game right now. */
  async flush(gameId, snapshot) {
    if (this.pending.has(gameId)) {
      clearTimeout(this.pending.get(gameId));
      this.pending.delete(gameId);
    }
    await this.saveLive(gameId, snapshot);
  }

  /** @param {string} gameId @param {object} data */
  async saveLive(gameId, data) {
    await writeAtomic(path.join(this.liveDir, `${gameId}.json`), data);
  }

  /** @param {string} gameId */
  async dropLive(gameId) {
    if (this.pending.has(gameId)) {
      clearTimeout(this.pending.get(gameId));
      this.pending.delete(gameId);
    }
    await fsp.rm(path.join(this.liveDir, `${gameId}.json`), { force: true });
  }

  /**
   * Every game that was in progress when the server last stopped. Unreadable
   * files are skipped with a warning rather than taking the server down with
   * them — one corrupt game must not stop everyone else playing.
   * @returns {Promise<object[]>}
   */
  async loadAllLive() {
    const out = [];
    let names;
    try {
      names = await fsp.readdir(this.liveDir);
    } catch {
      return out; // nothing saved yet, which is not a problem
    }
    for (const name of names) {
      if (!name.endsWith('.json')) continue;
      try {
        out.push(JSON.parse(await fsp.readFile(path.join(this.liveDir, name), 'utf8')));
      } catch (err) {
        console.warn('[blob] skipping unreadable game file', name, err.message);
      }
    }
    return out;
  }

  /** @param {object} record a finished game, from view.historyRecord */
  async saveHistory(record) {
    await writeAtomic(path.join(this.historyDir, `${record.id}.json`), record);
  }

  /**
   * Finished games, newest first.
   * @param {number} [limit]
   * @returns {Promise<object[]>} lightweight summaries
   */
  async listHistory(limit = 50) {
    let names;
    try {
      names = await fsp.readdir(this.historyDir);
    } catch {
      return []; // no games finished yet
    }
    const records = [];
    for (const name of names) {
      if (!name.endsWith('.json')) continue;
      try {
        const record = JSON.parse(await fsp.readFile(path.join(this.historyDir, name), 'utf8'));
        // Ask the game that wrote the record what its own line should say. Only
        // it knows its shape, and reaching into a record for fields that belong
        // to a different game is how Silly Head's finished games disappeared
        // from this list: `record.rounds.length` threw, the catch below logged
        // "unreadable history file", and the game was never seen again. A game
        // with no summariser still lists — it just lists thinly.
        const engine = engineById(record.game || DEFAULT_ENGINE);
        const summary = typeof engine.historySummary === 'function' ? engine.historySummary(record) : null;
        records.push({
          id: record.id,
          code: record.code,
          game: record.game || DEFAULT_ENGINE,
          playedAt: record.playedAt,
          completedAt: record.completedAt,
          startHandSize: record.startHandSize,
          // Games played before online mode existed have no mode recorded, and
          // every one of them was round a table.
          mode: record.mode || 'table',
          rounds: Array.isArray(record.rounds) ? record.rounds.length : 0,
          players: summary
            ? summary.players
            : (record.players || []).map((p) => ({ id: p.id, name: p.name, total: p.total })),
          winners: summary ? summary.winners : record.winners || [],
          detail: summary ? summary.detail : null,
        });
      } catch (err) {
        console.warn('[blob] skipping unreadable history file', name, err.message);
      }
    }
    records.sort((a, b) => (b.completedAt || 0) - (a.completedAt || 0));
    return records.slice(0, limit);
  }

  /** @param {string} gameId @returns {Promise<object|null>} */
  async readHistory(gameId) {
    if (!/^[a-zA-Z0-9_]+$/.test(gameId)) return null; // never build a path from unchecked input
    try {
      return JSON.parse(await fsp.readFile(path.join(this.historyDir, `${gameId}.json`), 'utf8'));
    } catch {
      return null;
    }
  }
}

/** Write via a temp file + rename, so a crash mid-write can't leave a half file. */
async function writeAtomic(file, data) {
  const tmp = `${file}.${process.pid}.tmp`;
  await fsp.writeFile(tmp, JSON.stringify(data), 'utf8');
  await fsp.rename(tmp, file);
}

module.exports = { Store };
