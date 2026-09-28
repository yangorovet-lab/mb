'use strict';
/* Хранилище: SQLite через встроенный node:sqlite (Node 22+) */
const path = require('path');
const fs = require('fs');
const { DatabaseSync } = require('node:sqlite');

function openDb(file) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = NORMAL;
    CREATE TABLE IF NOT EXISTS players (
      pid TEXT PRIMARY KEY,
      token TEXT NOT NULL,
      name TEXT NOT NULL,
      created INTEGER NOT NULL,
      last_seen INTEGER NOT NULL,
      games INTEGER NOT NULL DEFAULT 0,
      wins INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS daily (
      date TEXT NOT NULL,
      pid TEXT NOT NULL,
      shots INTEGER NOT NULL,
      ts INTEGER NOT NULL,
      PRIMARY KEY (date, pid)
    );
    CREATE INDEX IF NOT EXISTS daily_rank ON daily(date, shots, ts);
    CREATE TABLE IF NOT EXISTS games (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ts INTEGER NOT NULL,
      kind TEXT NOT NULL,
      p1 TEXT NOT NULL,
      p2 TEXT NOT NULL,
      winner TEXT,
      shots1 INTEGER NOT NULL DEFAULT 0,
      shots2 INTEGER NOT NULL DEFAULT 0,
      reason TEXT
    );
  `);

  const q = {
    getPlayer: db.prepare('SELECT * FROM players WHERE pid = ?'),
    insertPlayer: db.prepare('INSERT INTO players (pid, token, name, created, last_seen) VALUES (?, ?, ?, ?, ?)'),
    touchPlayer: db.prepare('UPDATE players SET last_seen = ?, name = ? WHERE pid = ?'),
    bumpPlayer: db.prepare('UPDATE players SET games = games + 1, wins = wins + ? WHERE pid = ?'),
    getDaily: db.prepare('SELECT shots, ts FROM daily WHERE date = ? AND pid = ?'),
    upsertDaily: db.prepare('INSERT INTO daily (date, pid, shots, ts) VALUES (?, ?, ?, ?) ON CONFLICT(date, pid) DO UPDATE SET shots = excluded.shots, ts = excluded.ts WHERE excluded.shots < daily.shots'),
    dailyTop: db.prepare('SELECT d.pid, p.name, d.shots, d.ts FROM daily d JOIN players p ON p.pid = d.pid WHERE d.date = ? ORDER BY d.shots ASC, d.ts ASC LIMIT ?'),
    dailyRank: db.prepare('SELECT COUNT(*) AS n FROM daily WHERE date = ? AND (shots < ? OR (shots = ? AND ts < ?))'),
    dailyCount: db.prepare('SELECT COUNT(*) AS n FROM daily WHERE date = ?'),
    insertGame: db.prepare('INSERT INTO games (ts, kind, p1, p2, winner, shots1, shots2, reason) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'),
    stats: db.prepare('SELECT (SELECT COUNT(*) FROM players) AS players, (SELECT COUNT(*) FROM games) AS games, (SELECT COUNT(*) FROM daily) AS daily'),
    purgeIdle: db.prepare('DELETE FROM players WHERE last_seen < ? AND games = 0 AND pid NOT IN (SELECT pid FROM daily) AND pid NOT IN (SELECT p1 FROM games) AND pid NOT IN (SELECT p2 FROM games)'),
  };

  return {
    db,
    getPlayer: (pid) => q.getPlayer.get(pid) || null,
    createPlayer(pid, token, name) { const now = Date.now(); q.insertPlayer.run(pid, token, name, now, now); return { pid, token, name }; },
    touchPlayer: (pid, name) => q.touchPlayer.run(Date.now(), name, pid),
    recordGame(kind, p1, p2, winner, shots1, shots2, reason) {
      q.insertGame.run(Date.now(), kind, p1, p2, winner, shots1, shots2, reason || null);
      if (p1) q.bumpPlayer.run(winner === p1 ? 1 : 0, p1);
      if (p2) q.bumpPlayer.run(winner === p2 ? 1 : 0, p2);
    },
    submitDaily(date, pid, shots) {
      const now = Date.now();
      q.upsertDaily.run(date, pid, shots, now);
      const row = q.getDaily.get(date, pid);
      return row;
    },
    dailyBoard(date, pid, limit) {
      const top = q.dailyTop.all(date, limit || 20).map((r, i) => ({ rank: i + 1, pid: r.pid, name: r.name, shots: r.shots }));
      let me = null;
      const mine = pid ? q.getDaily.get(date, pid) : null;
      if (mine) me = { rank: q.dailyRank.get(date, mine.shots, mine.shots, mine.ts).n + 1, shots: mine.shots };
      return { top, me, total: q.dailyCount.get(date).n };
    },
    stats: () => q.stats.get(),
    purgeIdlePlayers(days) { return Number(q.purgeIdle.run(Date.now() - days * 86400000).changes || 0); },
  };
}

module.exports = { openDb };
