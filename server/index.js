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
const STATIC_DIR = path.resolve(process.env.STATIC_DIR || path.join(__dirname, '..'));
const NO_STATIC = process.env.NO_STATIC === '1';
const TRUST_PROXY = process.env.TRUST_PROXY === '1'; // за Caddy/nginx: брать IP из X-Forwarded-For

/* Лимиты */
const MAX_CONN_PER_IP = Number(process.env.MAX_CONN_PER_IP || 20); // одновременных WS с одного IP
const MAX_NEW_CONN_PER_MIN = Number(process.env.MAX_NEW_CONN_PER_MIN || 60); // новых WS в минуту с одного IP
const MAX_MSG_PER_SEC = 30;
const MAX_URL_LEN = 2048;

const db = openDb(path.join(DATA_DIR, 'battleship.sqlite'));

/* Что вообще можно скачать: только файлы клиента. Всё остальное (server/, deploy/, .env, README) не отдаётся никогда. */
const STATIC_ALLOW = {
  files: new Set(['index.html', 'manifest.webmanifest', 'sw.js']),
  dirs: ['css/', 'js/', 'icons/'],
};
const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8',
};
const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'X-Frame-Options': 'DENY',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
};

const log = (...a) => console.log(new Date().toISOString(), ...a);

/* ---------- HTTP ---------- */
function sendJson(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { ...SECURITY_HEADERS, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*' });
  res.end(body);
}

function sendText(res, code, text) {
  res.writeHead(code, { ...SECURITY_HEADERS, 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(text);
}

/* Возвращает относительный путь к разрешённому файлу или null */
function resolveStatic(rawUrl) {
  if (typeof rawUrl !== 'string' || rawUrl.length > MAX_URL_LEN) return null;
  let p = rawUrl.split('?')[0].split('#')[0];
  try { p = decodeURIComponent(p); } catch (e) { return null; }
  if (p.includes('\0') || p.includes('\\')) return null;
  if (p === '' || p === '/') p = '/index.html';
  if (p.endsWith('/')) p += 'index.html';
  const rel = path.posix.normalize(p).replace(/^\/+/, '');
  if (rel.startsWith('..') || rel.includes('/../')) return null;
  const ok = STATIC_ALLOW.files.has(rel) || STATIC_ALLOW.dirs.some((d) => rel.startsWith(d) && rel.length > d.length && !rel.slice(d.length).includes('/..'));
  if (!ok) return null;
  const abs = path.resolve(STATIC_DIR, rel);
  if (!abs.startsWith(STATIC_DIR + path.sep)) return null;
  return { rel, abs };
}

function serveStatic(req, res) {
  const target = resolveStatic(req.url);
  if (!target) return sendText(res, 404, 'not found');
  fs.stat(target.abs, (err, st) => {
    if (err || !st.isFile()) return sendText(res, 404, 'not found');
    const ext = path.extname(target.abs).toLowerCase();
    if (!MIME[ext]) return sendText(res, 404, 'not found');
    const noCache = ext === '.html' || target.rel === 'sw.js' || target.rel === 'js/config.js';
    res.writeHead(200, {
      ...SECURITY_HEADERS,
      'Content-Type': MIME[ext],
      'Content-Length': st.size,
      'Cache-Control': noCache ? 'no-cache' : 'public, max-age=3600',
    });
    if (req.method === 'HEAD') return res.end();
    const stream = fs.createReadStream(target.abs);
    stream.on('error', () => { try { res.destroy(); } catch (e) { /* ignore */ } });
    stream.pipe(res);
  });
}

function handleHttp(req, res) {
  try {
    const rawUrl = req.url || '/';
    if (rawUrl.length > MAX_URL_LEN) return sendText(res, 414, 'uri too long');
    const url = rawUrl.split('?')[0];
    if (req.method !== 'GET' && req.method !== 'HEAD') return sendText(res, 405, 'method not allowed');
    if (url === '/healthz') return sendJson(res, 200, { ok: true, uptime: Math.round(process.uptime()) });
    if (url === '/api/stats') return sendJson(res, 200, { ...db.stats(), ...rooms.stats() });
    if (url === '/api/daily/top') {
      const q = new URL(rawUrl, 'http://x').searchParams;
      const date = q.get('date') || BS.todayKey();
      if (!daily.validDate(date)) return sendJson(res, 400, { error: 'bad_date' });
      const pid = (q.get('pid') || '').slice(0, 32);
      return sendJson(res, 200, { date, ...db.dailyBoard(date, /^[0-9a-f]{16}$/.test(pid) ? pid : null, 20) });
    }
    if (url.startsWith('/api/')) return sendJson(res, 404, { error: 'not_found' });
    if (NO_STATIC) return sendText(res, 404, 'not found');
    return serveStatic(req, res);
  } catch (e) {
    log('http error', e && e.message);
    try { sendText(res, 500, 'internal error'); } catch (e2) { /* ignore */ }
  }
}

const server = http.createServer(handleHttp);
server.headersTimeout = 15000;
server.requestTimeout = 30000;

/* ---------- WebSocket ---------- */
const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 8 * 1024, clientTracking: true });

function sendTo(client, msg) {
  if (client && client.ws && client.ws.readyState === 1) {
    try { client.ws.send(JSON.stringify(msg)); } catch (e) { /* ignore */ }
  }
}

const rooms = new RoomManager(db, sendTo);

function clientIp(req) {
  if (TRUST_PROXY) {
    const xff = req.headers['x-forwarded-for'];
    if (typeof xff === 'string' && xff.length) return xff.split(',')[0].trim().slice(0, 64);
  }
  return (req.socket && req.socket.remoteAddress) || 'unknown';
}

/* Учёт соединений по IP */
const ipState = new Map(); // ip -> { open, recent: [timestamps] }
function ipAllow(ip) {
  const now = Date.now();
  const st = ipState.get(ip) || { open: 0, recent: [] };
  st.recent = st.recent.filter((t) => now - t < 60000);
  if (st.open >= MAX_CONN_PER_IP || st.recent.length >= MAX_NEW_CONN_PER_MIN) { ipState.set(ip, st); return false; }
  st.open++;
  st.recent.push(now);
  ipState.set(ip, st);
  return true;
}
function ipRelease(ip) {
  const st = ipState.get(ip);
  if (!st) return;
  st.open = Math.max(0, st.open - 1);
  if (st.open === 0 && !st.recent.length) ipState.delete(ip);
}
setInterval(() => {
  const now = Date.now();
  for (const [ip, st] of ipState) { st.recent = st.recent.filter((t) => now - t < 60000); if (!st.open && !st.recent.length) ipState.delete(ip); }
}, 60000).unref();

/* управляющие и невидимые символы: C0/C1, zero-width, bidi, разделители строк */
const INVISIBLE_RE = new RegExp('[\\u0000-\\u001f\\u007f-\\u009f\\u200b-\\u200f\\u2028-\\u202f\\u2060-\\u206f\\ufeff]', 'g');

function cleanName(name) {
  const s = String(name || '').replace(INVISIBLE_RE, '').replace(/\s+/g, ' ').trim().slice(0, 16);
  return s || 'Капитан';
}

function identify(payload) {
  const name = cleanName(payload && payload.name);
  if (payload && typeof payload.pid === 'string' && typeof payload.token === 'string' && payload.pid.length <= 32 && payload.token.length <= 64) {
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
  const ip = clientIp(req);
  if (!ipAllow(ip)) { try { ws.close(1013, 'too many connections'); } catch (e) { /* ignore */ } return; }
  const client = { ws, ip, pid: null, name: null, msgs: 0, windowStart: Date.now(), identified: false };
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });

  const err = (code, message) => sendTo(client, { t: 'error', code, message });

  ws.on('message', (raw) => {
    try {
      const now = Date.now();
      if (now - client.windowStart > 1000) { client.windowStart = now; client.msgs = 0; }
      if (++client.msgs > MAX_MSG_PER_SEC) { ws.close(1008, 'rate'); return; }

      let msg;
      try { msg = JSON.parse(raw.toString()); } catch (e) { return err('bad_json'); }
      if (!msg || typeof msg !== 'object' || typeof msg.t !== 'string') return err('bad_msg');

      if (msg.t === 'hello') {
        if (client.identified) return err('already_identified');
        const id = identify(msg);
        client.pid = id.pid; client.name = id.name; client.identified = true;
        sendTo(client, { t: 'welcome', pid: id.pid, token: id.token, name: id.name, turnMs: TURN_MS });
        rooms.resume(client);
        return;
      }
      if (!client.pid) return err('not_identified', 'Сначала hello');

      const room = rooms.roomOf(client.pid);
      const k = room ? room.idx(client.pid) : -1;
      const inRoom = () => { if (!room || k === -1) { err('no_room'); return false; } return true; };

      switch (msg.t) {
        case 'ping': return sendTo(client, { t: 'pong', ts: typeof msg.ts === 'number' ? msg.ts : undefined });
        case 'create': { rooms.create(client); return; }
        case 'join': {
          const r = rooms.join(client, typeof msg.code === 'string' ? msg.code.slice(0, 16) : '');
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
          if (r.error) return err(r.error);
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
          const date = String(msg.date || '').slice(0, 10);
          const v = daily.verify(date, msg.shots);
          if (!v.ok) return err(v.error);
          db.submitDaily(date, client.pid, v.shots);
          return sendTo(client, { t: 'daily_board', date, ...db.dailyBoard(date, client.pid, 20) });
        }
        case 'daily_top': {
          const date = String(msg.date || BS.todayKey()).slice(0, 10);
          if (!daily.validDate(date)) return err('bad_date');
          return sendTo(client, { t: 'daily_board', date, ...db.dailyBoard(date, client.pid, 20) });
        }
        default: return err('unknown');
      }
    } catch (e) {
      log('ws error', client.pid, e && e.message);
      err('internal');
    }
  });

  ws.on('close', () => { ipRelease(ip); if (client.pid) rooms.onSocketClosed(client); });
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
heartbeat.unref();

/* уборка: анонимы без единой партии старше 30 дней */
const housekeeping = setInterval(() => {
  try { const n = db.purgeIdlePlayers(30); if (n) log('purged idle players:', n); } catch (e) { log('purge error', e.message); }
}, 6 * 3600 * 1000);
housekeeping.unref();

function start(port, host) {
  return new Promise((resolve) => {
    server.listen(port, host, () => {
      log(`battleship server on http://${host}:${server.address().port} static=${NO_STATIC ? 'off' : STATIC_DIR} data=${DATA_DIR} trustProxy=${TRUST_PROXY}`);
      resolve(server);
    });
  });
}

function shutdown() {
  log('shutting down');
  clearInterval(heartbeat);
  clearInterval(housekeeping);
  wss.close();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 3000).unref();
}

if (require.main === module) {
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
  process.on('uncaughtException', (e) => { log('uncaught', e && e.stack); process.exit(1); }); // Docker перезапустит
  process.on('unhandledRejection', (e) => { log('unhandled rejection', e && (e.stack || e)); });
  start(PORT, HOST);
}

module.exports = { start, server, wss, db, rooms, resolveStatic, cleanName };
