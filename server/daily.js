'use strict';
/* Проверка результата вызова дня: сервер сам строит доску по дате и повторяет выстрелы клиента */
const BS = require('../js/util.js');
require('../js/engine.js');
const { Board, FLEET, seededRng, hashString, todayKey } = BS;

function boardFor(dateKey) {
  const rng = seededRng(hashString('daily:' + dateKey));
  const enemy = new Board();
  enemy.randomize(FLEET, rng);
  return enemy;
}

function validDate(dateKey) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) return false;
  const d = new Date(dateKey + 'T12:00:00Z');
  if (Number.isNaN(d.getTime())) return false;
  // допускаем ±1 день относительно серверного времени (часовые пояса)
  const now = new Date();
  const diff = Math.abs(d.getTime() - new Date(todayKey(now) + 'T12:00:00Z').getTime());
  return diff <= 36 * 3600 * 1000;
}

/* Возвращает { ok, shots } или { ok:false, error } */
function verify(dateKey, shots) {
  if (!validDate(dateKey)) return { ok: false, error: 'bad_date' };
  if (!Array.isArray(shots) || shots.length < 20 || shots.length > 200) return { ok: false, error: 'bad_shots' };
  const board = boardFor(dateKey);
  let count = 0;
  for (const raw of shots) {
    const i = Number(raw);
    if (!Number.isInteger(i) || i < 0 || i >= 100) return { ok: false, error: 'bad_cell' };
    const res = board.shoot(i);
    if (res.result === 'repeat') continue;
    count++;
    if (res.result === 'sunk') board.markAround(res.around);
    if (board.allSunk()) break;
  }
  if (!board.allSunk()) return { ok: false, error: 'not_finished' };
  return { ok: true, shots: count };
}

module.exports = { verify, boardFor, validDate };
