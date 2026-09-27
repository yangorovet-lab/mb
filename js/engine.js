/* Игровая логика: доска, флот, расстановка, выстрелы, способности */
(function (global) {
  'use strict';

  const SIZE = 10;
  const FLEET = [4, 3, 3, 2, 2, 2, 1, 1, 1, 1];
  const LETTERS = ['А', 'Б', 'В', 'Г', 'Д', 'Е', 'Ж', 'З', 'И', 'К'];

  const SHOT = { NONE: 0, MISS: 1, HIT: 2 };

  const idx = (r, c) => r * SIZE + c;
  const rc = (i) => [Math.floor(i / SIZE), i % SIZE];
  const inBounds = (r, c) => r >= 0 && r < SIZE && c >= 0 && c < SIZE;

  function cellName(i) {
    const [r, c] = rc(i);
    return LETTERS[c] + (r + 1);
  }

  function neighbors8(i) {
    const [r, c] = rc(i);
    const out = [];
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        if (!dr && !dc) continue;
        if (inBounds(r + dr, c + dc)) out.push(idx(r + dr, c + dc));
      }
    }
    return out;
  }

  function neighbors4(i) {
    const [r, c] = rc(i);
    const out = [];
    if (inBounds(r - 1, c)) out.push(idx(r - 1, c));
    if (inBounds(r + 1, c)) out.push(idx(r + 1, c));
    if (inBounds(r, c - 1)) out.push(idx(r, c - 1));
    if (inBounds(r, c + 1)) out.push(idx(r, c + 1));
    return out;
  }

  class Board {
    constructor() {
      this.grid = new Int8Array(SIZE * SIZE).fill(-1); // индекс корабля или -1
      this.shots = new Uint8Array(SIZE * SIZE); // SHOT.*
      this.detected = new Uint8Array(SIZE * SIZE); // отметки радара (1 — палуба обнаружена)
      this.ships = []; // {id, len, cells, hits, sunk, r, c, horiz}
      this.nextId = 0;
    }

    static shipCells(r, c, len, horiz) {
      const cells = [];
      for (let k = 0; k < len; k++) {
        const rr = horiz ? r : r + k;
        const cc = horiz ? c + k : c;
        if (!inBounds(rr, cc)) return null;
        cells.push(idx(rr, cc));
      }
      return cells;
    }

    canPlace(r, c, len, horiz, ignoreId) {
      const cells = Board.shipCells(r, c, len, horiz);
      if (!cells) return false;
      for (const i of cells) {
        if (this.grid[i] !== -1 && this.grid[i] !== ignoreId) return false;
        for (const n of neighbors8(i)) {
          if (this.grid[n] !== -1 && this.grid[n] !== ignoreId) return false;
        }
      }
      return true;
    }

    place(r, c, len, horiz) {
      if (!this.canPlace(r, c, len, horiz)) return null;
      const cells = Board.shipCells(r, c, len, horiz);
      const ship = { id: this.nextId++, len, cells, hits: 0, sunk: false, r, c, horiz };
      cells.forEach((i) => (this.grid[i] = ship.id));
      this.ships.push(ship);
      return ship;
    }

    remove(shipId) {
      const ship = this.ships.find((s) => s.id === shipId);
      if (!ship) return null;
      ship.cells.forEach((i) => (this.grid[i] = -1));
      this.ships = this.ships.filter((s) => s.id !== shipId);
      return ship;
    }

    shipById(id) {
      return this.ships.find((s) => s.id === id) || null;
    }

    shipAt(i) {
      const id = this.grid[i];
      return id === -1 ? null : this.shipById(id);
    }

    clear() {
      this.grid.fill(-1);
      this.ships = [];
    }

    /* Сколько кораблей каждой длины ещё нужно поставить */
    remainingFleet(fleet) {
      const need = (fleet || FLEET).slice();
      for (const s of this.ships) {
        const k = need.indexOf(s.len);
        if (k !== -1) need.splice(k, 1);
      }
      return need;
    }

    isComplete(fleet) {
      return this.remainingFleet(fleet).length === 0;
    }

    randomize(fleet, rng) {
      const r = rng || Math.random;
      for (let attempt = 0; attempt < 200; attempt++) {
        this.clear();
        let ok = true;
        for (const len of fleet || FLEET) {
          let placed = false;
          for (let t = 0; t < 300; t++) {
            const horiz = r() < 0.5;
            const rr = Math.floor(r() * (horiz ? SIZE : SIZE - len + 1));
            const cc = Math.floor(r() * (horiz ? SIZE - len + 1 : SIZE));
            if (this.place(rr, cc, len, horiz)) {
              placed = true;
              break;
            }
          }
          if (!placed) {
            ok = false;
            break;
          }
        }
        if (ok) return true;
      }
      return false;
    }

    /* Выстрел. Возвращает результат и затронутые клетки. */
    shoot(i) {
      if (this.shots[i] !== SHOT.NONE) return { result: 'repeat', cell: i };
      const ship = this.shipAt(i);
      if (!ship) {
        this.shots[i] = SHOT.MISS;
        return { result: 'miss', cell: i };
      }
      this.shots[i] = SHOT.HIT;
      this.detected[i] = 0;
      ship.hits++;
      if (ship.hits >= ship.len) {
        ship.sunk = true;
        const around = new Set();
        for (const c of ship.cells) for (const n of neighbors8(c)) if (this.grid[n] === -1) around.add(n);
        return { result: 'sunk', cell: i, ship, around: Array.from(around) };
      }
      return { result: 'hit', cell: i, ship };
    }

    /* Автоотметка пустых клеток вокруг потопленного корабля */
    markAround(cells) {
      const marked = [];
      for (const n of cells) {
        if (this.shots[n] === SHOT.NONE) {
          this.shots[n] = SHOT.MISS;
          marked.push(n);
        }
      }
      return marked;
    }

    aliveShips() {
      return this.ships.filter((s) => !s.sunk);
    }

    allSunk() {
      return this.ships.length > 0 && this.ships.every((s) => s.sunk);
    }

    shotsCount() {
      let n = 0;
      for (let i = 0; i < this.shots.length; i++) if (this.shots[i]) n++;
      return n;
    }

    hitsCount() {
      let n = 0;
      for (let i = 0; i < this.shots.length; i++) if (this.shots[i] === SHOT.HIT) n++;
      return n;
    }

    /* Радар: отмечает палубы в квадрате 3×3 вокруг центра, ничего не стреляет */
    radar(center) {
      const [r, c] = rc(center);
      const found = [];
      const area = [];
      for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          if (!inBounds(r + dr, c + dc)) continue;
          const i = idx(r + dr, c + dc);
          area.push(i);
          if (this.grid[i] !== -1 && this.shots[i] === SHOT.NONE) {
            this.detected[i] = 1;
            found.push(i);
          }
        }
      }
      return { area, found };
    }

    /* Бомба: залп по квадрату 3×3 */
    bombCells(center) {
      const [r, c] = rc(center);
      const cells = [];
      for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          if (inBounds(r + dr, c + dc)) cells.push(idx(r + dr, c + dc));
        }
      }
      return cells.filter((i) => this.shots[i] === SHOT.NONE);
    }

    /* Торпеда: идёт по строке слева направо до первой неповреждённой палубы */
    torpedoTarget(row) {
      const trail = [];
      for (let c = 0; c < SIZE; c++) {
        const i = idx(row, c);
        if (this.shots[i] !== SHOT.NONE) continue;
        if (this.grid[i] !== -1) return { hit: i, trail };
        trail.push(i);
      }
      return { hit: -1, trail };
    }

    toJSON() {
      return {
        grid: Array.from(this.grid),
        shots: Array.from(this.shots),
        detected: Array.from(this.detected),
        ships: this.ships.map((s) => ({ ...s, cells: s.cells.slice() })),
        nextId: this.nextId,
      };
    }

    static fromJSON(o) {
      const b = new Board();
      b.grid = Int8Array.from(o.grid);
      b.shots = Uint8Array.from(o.shots);
      b.detected = Uint8Array.from(o.detected || new Array(100).fill(0));
      b.ships = o.ships.map((s) => ({ ...s, cells: s.cells.slice() }));
      b.nextId = o.nextId;
      return b;
    }
  }

  /* Режимы игры */
  const MODES = {
    classic: {
      id: 'classic',
      name: 'Классика',
      tag: 'База',
      icon: '⚓',
      desc: 'Правила, как во дворе: попал — стреляй ещё. Корабли не касаются друг друга.',
      xp: 1.0,
    },
    blitz: {
      id: 'blitz',
      name: 'Блиц',
      tag: 'Скорость',
      icon: '⚡',
      desc: '7 секунд на выстрел. Не успел — ход переходит противнику. Думай быстро.',
      xp: 1.2,
      turnTime: 7,
    },
    arsenal: {
      id: 'arsenal',
      name: 'Арсенал',
      tag: 'Способности',
      icon: '🎯',
      desc: 'Радар, бомба 3×3 и торпеда. За каждый потопленный корабль — новый заряд.',
      xp: 1.3,
    },
    salvo: {
      id: 'salvo',
      name: 'Залп',
      tag: 'Тактика',
      icon: '💥',
      desc: 'Стреляй сразу несколькими снарядами. Чем меньше кораблей осталось, тем меньше залп.',
      xp: 1.25,
    },
  };

  const ABILITIES = {
    radar: { id: 'radar', name: 'Радар', icon: '📡', hint: 'Показывает палубы в квадрате 3×3. Ход не тратится.', free: true },
    bomb: { id: 'bomb', name: 'Бомба', icon: '💣', hint: 'Накрывает квадрат 3×3 одним ударом.', free: false },
    torpedo: { id: 'torpedo', name: 'Торпеда', icon: '🚀', hint: 'Идёт по строке и бьёт первую палубу на пути.', free: false },
  };

  const DIFFICULTY = {
    easy: { id: 'easy', name: 'Юнга', desc: 'Стреляет почти наугад', xp: 0.7 },
    normal: { id: 'normal', name: 'Капитан', desc: 'Добивает раненые корабли', xp: 1.0 },
    hard: { id: 'hard', name: 'Адмирал', desc: 'Считает вероятности. Больно.', xp: 1.5 },
  };

  function salvoSize(aliveCount) {
    return Math.max(1, Math.ceil(aliveCount / 2));
  }

  global.BS = global.BS || {};
  Object.assign(global.BS, {
    SIZE, FLEET, LETTERS, SHOT, MODES, ABILITIES, DIFFICULTY,
    idx, rc, inBounds, cellName, neighbors4, neighbors8, Board, salvoSize,
  });
})(window);
