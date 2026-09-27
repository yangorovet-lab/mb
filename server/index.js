'use strict';
/* Сервер «Морского боя»: статика + WebSocket-игра + таблица лидеров вызова дня */
const http = require('http');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');
const { openDb } = require('./db');
const { RoomManager, TURN_MS } = require('./rooms');
const daily = require('./daily');
const BS = require('../js/util.js');

const PORT = Number(process.env.PORT || 8080);
const HOST = process.env.HOST || '0.0.0.0';
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const STATIC_DIR = process.env.STATIC_DIR || path.join(__dirname, '..');
const NO_STATIC = process.env.NO_STATIC === '1';

const db = openDb(path.join(DATA_DIR, 'battleship.sqlite'));

const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8', '.map': 'application/json',
};

const log = (...a) => console.log(new Date().toISOString(), ...a);

/* ---------- HTTP ---------- */
function sendJson(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*' });
  res.end(body);
}

function serveStatic(req, res) {
  let urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
  if (urlPath.endsWith('/')) urlPath += 'index.html';
  const file = path.normalize(path.join(STATIC_DIR, urlPath));
  if (!file.startsWith(path.normalize(STATIC_DIR + path.sep)) || file.includes(`${path.sep}server${path.sep}`) || file.includes(`${path.sep}.git`)) {
    res.writeHead(403); res.end('forbidden'); return;
  }
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end('not found'); return; }
    const ext = path.extname(file).toLowerCase();
    const isHtml = ext === '.html';
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Content-Length': st.size,
      'Cache-Control': isHtml || file.endsWith('sw.js') || file.endsWith('config.js') ? 'no-cache' : 'public, max-age=3600',
    });
    fs.createReadStream(file).pipe(res);
  });
}

const server = http.createServer((req, res) => {
  const url = (req.url || '/').split('?')[0];
  if (url === '/healthz') return sendJson(res, 200, { ok: true, uptime: Math.round(process.uptime()) });
  if (url === '/api/stats') return sendJson(res, 200, { ...db.stats(), ...rooms.stats() });
  if (url.startsWith('/api/daily/top')) {
    const q = new URL(req.url, 'http://x').searchParams;
    const date = q.get('date') || BS.todayKey();
    if (!daily.validDate(date)) return sendJson(res, 400, { error: 'bad_date' });
    return sendJson(res, 200, { date, ...db.dailyBoard(date, q.get('pid') || null, 20) });
  }
  if (NO_STATIC) { res.writeHead(404); res.end(); return; }
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); res.end(); return; }
  serveStatic(req, res);
});

/* ---------- WebSocket ---------- */
const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 8 * 1024 });

function sendTo(client, msg) {
  if (client && client.ws && client.ws.readyState === 1) {
    try { client.ws.send(JSON.stringify(msg)); } catch (e) { /* ignore */ }
  }
}

const rooms = new RoomManager(db, sendTo);

function cleanName(name) {
  const s = String(name || '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 16);
  return s || 'Капитан';
}

function identify(payload) {
  const name = cleanName(payload && payload.name);
  if (payload && typeof payload.pid === 'string' && typeof payload.token === 'string') {
    const row = db.getPlayer(payload.pid);
    if (row && row.token.length === payload.token.length && crypto.timingSafeEqual(Buffer.from(row.token), Buffer.from(payload.token))) {
      db.touchPlayer(row.pid, name);
      return { pid: row.pid, token: row.token, name };
    }
  }
  const pid = crypto.randomBytes(8).toString('hex');
  const token = crypto.randomBytes(24).toString('hex');
  db.createPlayer(pid, token, name);
  return { pid, token, name };
}

wss.on('connection', (ws, req) => {
  const client = { ws, pid: null, name: null, msgs: 0, windowStart: Date.now() };
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });

  const err = (code, message) => sendTo(client, { t: 'error', code, message });

  ws.on('message', (raw) => {
    // простейшее ограничение частоты
    const now = Date.now();
    if (now - client.windowStart > 1000) { client.windowStart = now; client.msgs = 0; }
    if (++client.msgs > 40) { ws.close(1008, 'rate'); return; }

    let msg;
    try { msg = JSON.parse(raw.toString()); } catch (e) { return err('bad_json'); }
    if (!msg || typeof msg.t !== 'string') return err('bad_msg');

    if (msg.t === 'hello') {
      const id = identify(msg);
      client.pid = id.pid; client.name = id.name;
      sendTo(client, { t: 'welcome', pid: id.pid, token: id.token, name: id.name, turnMs: TURN_MS });
      rooms.resume(client);
      return;
    }
    if (!client.pid) return err('not_identified', 'Сначала hello');

    const room = rooms.roomOf(client.pid);
    const k = room ? room.idx(client.pid) : -1;
    const inRoom = () => { if (!room || k === -1) { err('no_room'); return false; } return true; };

    switch (msg.t) {
      case 'ping': return sendTo(client, { t: 'pong', ts: msg.ts });
      case 'create': { rooms.create(client); return; }
      case 'join': {
        const r = rooms.join(client, msg.code);
        if (r.error) return err(r.error);
        return;
      }
      case 'quick': { rooms.quick(client); return; }
      case 'leave': { rooms.leave(client); sendTo(client, { t: 'left' }); return; }
      case 'place': {
        if (!inRoom()) return;
        const r = room.place(k, msg.ships);
        if (r.error) return err(r.error);
        return;
      }
      case 'shot': {
        if (!inRoom()) return;
        const r = room.shot(k, msg.i);
        if (r.error) return err(r.error, undefined);
        return;
      }
      case 'react': { if (!inRoom()) return; room.react(k, msg.e); return; }
      case 'rematch': {
        if (!inRoom()) return;
        const r = room.requestRematch(k);
        if (r.error) return err(r.error);
        return;
      }
      case 'state': { if (!inRoom()) return; sendTo(client, room.snapshot(k)); return; }
      case 'daily_submit': {
        const v = daily.verify(String(msg.date || ''), msg.shots);
        if (!v.ok) return err(v.error);
        db.submitDaily(msg.date, client.pid, v.shots);
        return sendTo(client, { t: 'daily_board', date: msg.date, ...db.dailyBoard(msg.date, client.pid, 20) });
      }
      case 'daily_top': {
        const date = String(msg.date || BS.todayKey());
        if (!daily.validDate(date)) return err('bad_date');
        return sendTo(client, { t: 'daily_board', date, ...db.dailyBoard(date, client.pid, 20) });
      }
      default: return err('unknown', msg.t);
    }
  });

  ws.on('close', () => { if (client.pid) rooms.onSocketClosed(client); });
  ws.on('error', () => { /* закроется сам */ });
});

/* heartbeat: рвём мёртвые соединения */
const heartbeat = setInterval(() => {
  for (const ws of wss.clients) {
    if (ws.isAlive === false) { ws.terminate(); continue; }
    ws.isAlive = false;
    try { ws.ping(); } catch (e) { /* ignore */ }
  }
}, 30000);

server.listen(PORT, HOST, () => log(`battleship server on http://${HOST}:${PORT} static=${NO_STATIC ? 'off' : STATIC_DIR} data=${DATA_DIR}`));

function shutdown() {
  log('shutting down');
  clearInterval(heartbeat);
  wss.close();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 3000).unref();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
