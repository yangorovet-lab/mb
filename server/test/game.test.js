'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { Room, RoomManager, buildBoard } = require('../rooms');
const daily = require('../daily');
const BS = require('../../js/util.js');
require('../../js/engine.js');
const { Board } = BS;

const fakeDb = { recordGame() {} };
function client(pid) { return { pid, name: pid, ws: { readyState: 1 }, inbox: [] }; }
function manager() { return new RoomManager(fakeDb, (c, msg) => c.inbox.push(msg)); }
function fleetOf(board) { return board.ships.map((s) => ({ r: s.r, c: s.c, len: s.len, horiz: s.horiz })); }

test('расстановка валидируется', () => {
  const b = new Board(); b.randomize();
  assert.ok(buildBoard(fleetOf(b)));
  assert.equal(buildBoard([{ r: 0, c: 0, len: 4, horiz: true }]), null);
  const touching = fleetOf(b); touching[1] = { r: touching[0].r, c: touching[0].c + (touching[0].horiz ? 4 : 0), len: 3, horiz: true };
  assert.equal(buildBoard(touching), null);
});

test('комната: создание, вход, партия до конца', () => {
  const m = manager();
  const a = client('a'), b = client('b');
  const room = m.create(a);
  assert.equal(m.join(b, room.code.toLowerCase()).ok, true);
  assert.equal(room.phase, 'placing');
  const ba = new Board(); ba.randomize();
  const bb = new Board(); bb.randomize();
  assert.equal(room.place(0, fleetOf(ba)).ok, true);
  assert.equal(room.place(1, fleetOf(bb)).ok, true);
  assert.equal(room.phase, 'battle');
  const startA = a.inbox.find((x) => x.t === 'start');
  assert.ok(startA && ['you', 'opp'].includes(startA.first));
  // стреляем по очереди строго по правилам
  let guard = 0;
  while (room.phase === 'battle' && guard++ < 300) {
    const k = room.turn;
    const target = room.other(k).board;
    let i = 0; while (target.shots[i] !== 0) i++;
    const r = room.shot(k, i);
    assert.equal(r.error, undefined);
  }
  assert.equal(room.phase, 'over');
  assert.equal(room.reason, 'sunk');
  const over = a.inbox.find((x) => x.t === 'over');
  assert.equal(over.reveal.length, 10);
  assert.equal(room.shot(0, 5).error, 'bad_phase');
  room.dispose();
});

test('чужой ход и повтор отклоняются', () => {
  const m = manager();
  const a = client('a'), b = client('b');
  const room = m.create(a); m.join(b, room.code);
  const ba = new Board(); ba.randomize(); const bb = new Board(); bb.randomize();
  room.place(0, fleetOf(ba)); room.place(1, fleetOf(bb));
  const k = room.turn;
  assert.equal(room.shot(1 - k, 0).error, 'not_your_turn');
  const target = room.other(k).board;
  let empty = 0; while (target.grid[empty] !== -1) empty++;
  assert.equal(room.shot(k, empty).ok, true);
  assert.equal(room.turn, 1 - k);
  assert.equal(room.shot(1 - k, 999).error, 'bad_cell');
  room.dispose();
});

test('быстрый подбор сводит двоих', () => {
  const m = manager();
  const a = client('a'), b = client('b');
  assert.equal(m.quick(a).matched, false);
  const r = m.quick(b);
  assert.equal(r.matched, true);
  assert.equal(r.room.kind, 'quick');
  assert.equal(r.room.phase, 'placing');
  r.room.dispose();
});

test('вызов дня: честный результат принимается, липовый — нет', () => {
  const date = BS.todayKey();
  const board = daily.boardFor(date);
  const shots = [];
  for (let i = 0; i < 100; i++) shots.push(i);
  const v = daily.verify(date, shots);
  assert.equal(v.ok, true);
  assert.ok(v.shots <= 100 && v.shots >= 20);
  assert.equal(daily.verify(date, shots.slice(0, 10)).ok, false);
  assert.equal(daily.verify('2000-01-01', shots).ok, false);
  const shipCells = board.ships.flatMap((s) => s.cells);
  assert.equal(daily.verify(date, shipCells).shots, 20);
});
