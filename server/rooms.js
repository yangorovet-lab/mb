'use strict';
/* Комнаты и матчмейкинг. Сервер — единственный источник правды по доскам и ходам. */
const BS = require('../js/util.js');
require('../js/engine.js');
const { Board, FLEET, SHOT, SIZE } = BS;

const TURN_MS = 45000; // время на ход
const GRACE_BATTLE_MS = 90000; // сколько ждём вернувшегося в бою
const GRACE_LOBBY_MS = 60000; // сколько ждём в лобби/расстановке
const OVER_TTL_MS = 10 * 60000; // сколько живёт комната после конца партии (реванш)
const LOBBY_TTL_MS = 30 * 60000; // пустая комната без второго игрока
const MAX_TIMEOUTS = 3; // подряд просроченных ходов до техпоражения

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function makeCode(len) {
  let s = '';
  for (let i = 0; i < len; i++) s += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  return s;
}

function normalizeCode(code) {
  return String(code || '').toUpperCase().replace(/[^A-Z0-9]/g, '').replace(/0/g, 'O').replace(/1/g, 'I').slice(0, 8);
}

function buildBoard(ships) {
  if (!Array.isArray(ships) || ships.length !== FLEET.length) return null;
  const b = new Board();
  for (const s of ships) {
    if (!s || !Number.isInteger(s.r) || !Number.isInteger(s.c) || !Number.isInteger(s.len)) return null;
    if (!b.place(s.r, s.c, s.len, !!s.horiz)) return null;
  }
  if (!b.isComplete()) return null;
  return b;
}

class Room {
  constructor(manager, code, kind) {
    this.m = manager;
    this.code = code;
    this.kind = kind; // friend | quick
    this.players = [null, null];
    this.phase = 'lobby'; // lobby | placing | battle | over
    this.turn = 0;
    this.deadline = 0;
    this.turnTimer = null;
    this.timeouts = [0, 0];
    this.stats = [{ shots: 0, hits: 0, sunk: 0 }, { shots: 0, hits: 0, sunk: 0 }];
    this.autoMarked = [new Set(), new Set()];
    this.winner = null;
    this.reason = null;
    this.rematch = [false, false];
    this.created = Date.now();
    this.updated = Date.now();
    this.cleanupTimer = null;
  }

  idx(pid) { return this.players.findIndex((p) => p && p.pid === pid); }
  other(k) { return this.players[1 - k]; }
  full() { return !!(this.players[0] && this.players[1]); }

  send(k, msg) {
    const p = this.players[k];
    if (p && p.conn) this.m.sendTo(p.conn, msg);
  }
  broadcast(msg) { this.send(0, msg); this.send(1, msg); }
  who(k, viewer) { return k === viewer ? 'you' : 'opp'; }

  /* ---------- вход/выход ---------- */
  addPlayer(client) {
    const k = this.players[0] ? 1 : 0;
    this.players[k] = { pid: client.pid, name: client.name, conn: client, board: null, connected: true, offlineSince: 0, graceTimer: null };
    this.m.byPid.set(client.pid, this);
    this.touch();
    this.send(k, this.roomMsg(k));
    if (this.full()) {
      this.phase = 'placing';
      this.send(0, { t: 'opp_joined', name: this.players[1].name });
      this.send(1, { t: 'opp_joined', name: this.players[0].name });
      if (this.cleanupTimer) { clearTimeout(this.cleanupTimer); this.cleanupTimer = null; }
    } else {
      this.cleanupTimer = setTimeout(() => this.m.destroyRoom(this, 'lobby_ttl'), LOBBY_TTL_MS);
    }
    return k;
  }

  roomMsg(k) {
    const opp = this.other(k);
    return { t: 'room', code: this.code, role: k === 0 ? 'host' : 'guest', kind: this.kind, phase: this.phase, opp: opp ? opp.name : null };
  }

  /* игрок сам вышел */
  leave(k) {
    const p = this.players[k];
    if (!p) return;
    if (this.phase === 'battle') {
      this.finish(1 - k, 'left');
      this.detach(k);
      return;
    }
    this.detach(k);
    const o = this.other(k);
    if (o) {
      this.send(1 - k, { t: 'opp_left', phase: this.phase });
      if (this.phase === 'over') { this.rematch = [false, false]; }
      else {
        // в лобби/расстановке без соперника комната сбрасывается
        this.m.detachPlayer(o.pid);
        this.m.destroyRoom(this, 'opp_left');
      }
    } else {
      this.m.destroyRoom(this, 'empty');
    }
  }

  detach(k) {
    const p = this.players[k];
    if (!p) return;
    if (p.graceTimer) clearTimeout(p.graceTimer);
    this.m.byPid.delete(p.pid);
    this.players[k] = null;
  }

  /* обрыв связи */
  onDisconnect(k) {
    const p = this.players[k];
    if (!p) return;
    p.conn = null;
    p.connected = false;
    p.offlineSince = Date.now();
    this.send(1 - k, { t: 'opp_offline' });
    const grace = this.phase === 'battle' ? GRACE_BATTLE_MS : GRACE_LOBBY_MS;
    if (this.phase === 'over') return; // после партии ждём без ограничений до TTL комнаты
    p.graceTimer = setTimeout(() => {
      if (!this.players[k] || this.players[k].connected) return;
      this.leave(k);
    }, grace);
  }

  onReconnect(k, client) {
    const p = this.players[k];
    p.conn = client;
    p.connected = true;
    p.name = client.name;
    if (p.graceTimer) { clearTimeout(p.graceTimer); p.graceTimer = null; }
    this.send(k, this.snapshot(k));
    this.send(1 - k, { t: 'opp_online' });
  }

  snapshot(k) {
    const p = this.players[k];
    const o = this.other(k);
    const enemySunk = o && o.board ? o.board.ships.filter((s) => s.sunk).map((s) => ({ len: s.len, cells: s.cells, r: s.r, c: s.c, horiz: s.horiz })) : [];
    return {
      t: 'state',
      code: this.code, role: k === 0 ? 'host' : 'guest', kind: this.kind, phase: this.phase,
      opp: o ? o.name : null, oppOnline: !!(o && o.connected), oppPlaced: !!(o && o.board),
      turn: this.who(this.turn, k), deadline: this.deadline,
      my: p.board ? { ships: p.board.ships.map((s) => ({ r: s.r, c: s.c, len: s.len, horiz: s.horiz })), shots: Array.from(p.board.shots) } : null,
      enemy: o && o.board ? { shots: Array.from(o.board.shots), sunk: enemySunk } : null,
      stats: [this.stats[k], this.stats[1 - k]],
      winner: this.winner == null ? null : this.who(this.winner, k),
      reason: this.reason,
      rematch: [this.rematch[k], this.rematch[1 - k]],
      reveal: this.phase === 'over' && o && o.board ? this.revealOf(1 - k) : null,
    };
  }

  /* ---------- расстановка ---------- */
  place(k, ships) {
    if (this.phase !== 'placing') return { error: 'bad_phase' };
    const b = buildBoard(ships);
    if (!b) return { error: 'bad_fleet' };
    this.players[k].board = b;
    this.touch();
    this.send(k, { t: 'placed' });
    this.send(1 - k, { t: 'opp_placed' });
    if (this.players[0].board && this.players[1].board) this.startBattle();
    return { ok: true };
  }

  startBattle() {
    this.phase = 'battle';
    this.turn = Math.random() < 0.5 ? 0 : 1;
    this.timeouts = [0, 0];
    this.stats = [{ shots: 0, hits: 0, sunk: 0 }, { shots: 0, hits: 0, sunk: 0 }];
    this.autoMarked = [new Set(), new Set()];
    this.winner = null;
    this.reason = null;
    this.rematch = [false, false];
    this.armTurn();
    this.send(0, { t: 'start', first: this.who(this.turn, 0), deadline: this.deadline, opp: this.players[1].name });
    this.send(1, { t: 'start', first: this.who(this.turn, 1), deadline: this.deadline, opp: this.players[0].name });
  }

  armTurn() {
    if (this.turnTimer) clearTimeout(this.turnTimer);
    this.deadline = Date.now() + TURN_MS;
    this.turnTimer = setTimeout(() => this.onTurnTimeout(), TURN_MS + 500);
  }

  onTurnTimeout() {
    if (this.phase !== 'battle') return;
    const k = this.turn;
    this.timeouts[k]++;
    if (this.timeouts[k] >= MAX_TIMEOUTS) { this.finish(1 - k, 'timeout'); return; }
    this.turn = 1 - k;
    this.armTurn();
    this.send(0, { t: 'turn', turn: this.who(this.turn, 0), deadline: this.deadline, reason: 'timeout' });
    this.send(1, { t: 'turn', turn: this.who(this.turn, 1), deadline: this.deadline, reason: 'timeout' });
  }

  /* ---------- выстрел ---------- */
  shot(k, i) {
    if (this.phase !== 'battle') return { error: 'bad_phase' };
    if (this.turn !== k) return { error: 'not_your_turn' };
    if (!Number.isInteger(i) || i < 0 || i >= SIZE * SIZE) return { error: 'bad_cell' };
    const target = this.other(k).board;
    const marked = this.autoMarked[1 - k];
    let res;
    if (target.shots[i] === SHOT.MISS && marked.has(i)) {
      marked.delete(i);
      res = { result: 'miss', cell: i }; // клетка была помечена автоматически — засчитываем как промах
    } else {
      res = target.shoot(i);
    }
    if (res.result === 'repeat') return { error: 'repeat' };
    this.timeouts[k] = 0;
    const st = this.stats[k];
    st.shots++;
    const msg = { t: 'result', i, result: res.result };
    if (res.result !== 'miss') {
      st.hits++;
      if (res.result === 'sunk') {
        st.sunk++;
        msg.ship = { len: res.ship.len, cells: res.ship.cells, r: res.ship.r, c: res.ship.c, horiz: res.ship.horiz };
        msg.around = res.around;
        target.markAround(res.around).forEach((c) => marked.add(c));
      }
    }
    const over = target.allSunk();
    if (!over) {
      if (res.result === 'miss') this.turn = 1 - k;
      this.armTurn();
    }
    msg.deadline = this.deadline;
    this.touch();
    this.send(k, { ...msg, shooter: 'you', turn: this.who(this.turn, k) });
    this.send(1 - k, { ...msg, shooter: 'opp', turn: this.who(this.turn, 1 - k) });
    if (over) this.finish(k, 'sunk');
    return { ok: true };
  }

  revealOf(k) {
    const p = this.players[k];
    if (!p || !p.board) return [];
    return p.board.ships.map((s) => ({ len: s.len, cells: s.cells, r: s.r, c: s.c, horiz: s.horiz, sunk: s.sunk }));
  }

  finish(winner, reason) {
    if (this.phase === 'over') return;
    this.phase = 'over';
    this.winner = winner;
    this.reason = reason;
    if (this.turnTimer) { clearTimeout(this.turnTimer); this.turnTimer = null; }
    this.send(0, { t: 'over', winner: this.who(winner, 0), reason, reveal: this.revealOf(1), stats: [this.stats[0], this.stats[1]] });
    this.send(1, { t: 'over', winner: this.who(winner, 1), reason, reveal: this.revealOf(0), stats: [this.stats[1], this.stats[0]] });
    const p0 = this.players[0], p1 = this.players[1];
    this.m.db.recordGame(this.kind, p0 ? p0.pid : '', p1 ? p1.pid : '', this.players[winner] ? this.players[winner].pid : null, this.stats[0].shots, this.stats[1].shots, reason);
    if (this.cleanupTimer) clearTimeout(this.cleanupTimer);
    this.cleanupTimer = setTimeout(() => this.m.destroyRoom(this, 'over_ttl'), OVER_TTL_MS);
  }

  /* ---------- реванш ---------- */
  requestRematch(k) {
    if (this.phase !== 'over') return { error: 'bad_phase' };
    if (!this.full()) return { error: 'no_opponent' };
    this.rematch[k] = true;
    this.send(1 - k, { t: 'rematch_wait' });
    if (this.rematch[0] && this.rematch[1]) {
      this.rematch = [false, false];
      this.players[0].board = null;
      this.players[1].board = null;
      this.phase = 'placing';
      if (this.cleanupTimer) { clearTimeout(this.cleanupTimer); this.cleanupTimer = null; }
      this.broadcast({ t: 'rematch_start' });
    }
    return { ok: true };
  }

  react(k, e) {
    if (typeof e !== 'string' || e.length === 0 || e.length > 4) return;
    this.send(1 - k, { t: 'react', e });
  }

  touch() { this.updated = Date.now(); }

  dispose() {
    if (this.turnTimer) clearTimeout(this.turnTimer);
    if (this.cleanupTimer) clearTimeout(this.cleanupTimer);
    for (const p of this.players) if (p && p.graceTimer) clearTimeout(p.graceTimer);
  }
}

class RoomManager {
  constructor(db, sendTo) {
    this.db = db;
    this.sendTo = sendTo; // (client, msg) => void
    this.rooms = new Map();
    this.byPid = new Map();
    this.queue = [];
  }

  roomOf(pid) { return this.byPid.get(pid) || null; }

  create(client) {
    this.dropFromQueue(client.pid);
    const existing = this.roomOf(client.pid);
    if (existing) existing.leave(existing.idx(client.pid));
    let code;
    do { code = makeCode(5); } while (this.rooms.has(code));
    const room = new Room(this, code, 'friend');
    this.rooms.set(code, room);
    room.addPlayer(client);
    return room;
  }

  join(client, rawCode) {
    this.dropFromQueue(client.pid);
    const code = normalizeCode(rawCode);
    const room = this.rooms.get(code);
    if (!room) return { error: 'not_found' };
    if (room.idx(client.pid) !== -1) { room.onReconnect(room.idx(client.pid), client); return { ok: true, room }; }
    if (room.full()) return { error: 'room_full' };
    if (room.phase !== 'lobby') return { error: 'room_busy' };
    const existing = this.roomOf(client.pid);
    if (existing) existing.leave(existing.idx(client.pid));
    room.addPlayer(client);
    return { ok: true, room };
  }

  quick(client) {
    const existing = this.roomOf(client.pid);
    if (existing) existing.leave(existing.idx(client.pid));
    this.dropFromQueue(client.pid);
    const partner = this.queue.find((c) => c.pid !== client.pid && c.ws && c.ws.readyState === 1);
    if (partner) {
      this.dropFromQueue(partner.pid);
      let code;
      do { code = makeCode(5); } while (this.rooms.has(code));
      const room = new Room(this, code, 'quick');
      this.rooms.set(code, room);
      room.addPlayer(partner);
      room.addPlayer(client);
      return { matched: true, room };
    }
    this.queue.push(client);
    this.sendTo(client, { t: 'queued', size: this.queue.length });
    return { matched: false };
  }

  dropFromQueue(pid) { this.queue = this.queue.filter((c) => c.pid !== pid); }

  leave(client) {
    this.dropFromQueue(client.pid);
    const room = this.roomOf(client.pid);
    if (room) room.leave(room.idx(client.pid));
  }

  detachPlayer(pid) { this.byPid.delete(pid); }

  onSocketClosed(client) {
    this.dropFromQueue(client.pid);
    const room = this.roomOf(client.pid);
    if (!room) return;
    const k = room.idx(client.pid);
    if (k !== -1 && room.players[k].conn === client) room.onDisconnect(k);
  }

  /* при новом подключении: вернуть игрока в его комнату */
  resume(client) {
    const room = this.roomOf(client.pid);
    if (!room) return false;
    const k = room.idx(client.pid);
    if (k === -1) return false;
    room.onReconnect(k, client);
    return true;
  }

  destroyRoom(room, why) {
    room.dispose();
    for (const p of room.players) if (p) { if (this.byPid.get(p.pid) === room) this.byPid.delete(p.pid); if (p.conn && why !== 'opp_left') this.sendTo(p.conn, { t: 'room_closed', why }); }
    this.rooms.delete(room.code);
  }

  stats() {
    let battles = 0;
    for (const r of this.rooms.values()) if (r.phase === 'battle') battles++;
    return { rooms: this.rooms.size, battles, queue: this.queue.length, online: this.byPid.size };
  }
}

module.exports = { RoomManager, Room, normalizeCode, buildBoard, TURN_MS };
