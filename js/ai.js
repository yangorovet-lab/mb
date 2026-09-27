/* Противник: три уровня — случайный, охотник, вероятностный */
(function (global) {
  'use strict';

  const { SIZE, FLEET, SHOT, idx, rc, inBounds, neighbors4, neighbors8, Board } = global.BS;

  class AI {
    constructor(level, rng) {
      this.level = level || 'normal';
      this.rng = rng || Math.random;
      this.known = new Set(); // палубы, обнаруженные радаром
    }

    /* ---------- Анализ поля противника (только публичная информация) ---------- */

    analyze(board) {
      const sunkCells = new Set();
      const sunkLens = [];
      for (const s of board.ships) {
        if (s.sunk) {
          sunkLens.push(s.len);
          s.cells.forEach((c) => sunkCells.add(c));
        }
      }
      const openHits = [];
      for (let i = 0; i < SIZE * SIZE; i++) {
        if (board.shots[i] === SHOT.HIT && !sunkCells.has(i)) openHits.push(i);
      }
      const remaining = FLEET.slice();
      for (const len of sunkLens) {
        const k = remaining.indexOf(len);
        if (k !== -1) remaining.splice(k, 1);
      }
      // Клетки, где корабля точно нет: промахи, потопленные и всё вокруг потопленных и вокруг открытых попаданий (по диагонали)
      const blocked = new Uint8Array(SIZE * SIZE);
      for (let i = 0; i < SIZE * SIZE; i++) {
        if (board.shots[i] === SHOT.MISS) blocked[i] = 1;
        if (sunkCells.has(i)) {
          blocked[i] = 1;
          neighbors8(i).forEach((n) => (blocked[n] = 1));
        }
      }
      for (const h of openHits) {
        const [r, c] = rc(h);
        for (const dr of [-1, 1]) for (const dc of [-1, 1]) if (inBounds(r + dr, c + dc)) blocked[idx(r + dr, c + dc)] = 1;
      }
      for (const k of this.known) if (board.shots[k] !== SHOT.NONE) this.known.delete(k);
      return { openHits, remaining, blocked, sunkCells };
    }

    /* Карта плотности: сколько вариантов расстановки проходит через клетку */
    density(board, info) {
      const { openHits, remaining, blocked } = info;
      const map = new Float32Array(SIZE * SIZE);
      const openSet = new Set(openHits);
      const lens = Array.from(new Set(remaining));
      const targetMode = openHits.length > 0;
      for (const len of lens) {
        const weightLen = remaining.filter((l) => l === len).length;
        for (let horiz = 0; horiz < 2; horiz++) {
          for (let r = 0; r < SIZE; r++) {
            for (let c = 0; c < SIZE; c++) {
              const cells = Board.shipCells(r, c, len, !!horiz);
              if (!cells) continue;
              let ok = true;
              let covers = 0;
              for (const i of cells) {
                if (blocked[i]) { ok = false; break; }
                if (board.shots[i] === SHOT.HIT) {
                  if (openSet.has(i)) covers++;
                  else { ok = false; break; }
                }
              }
              if (!ok) continue;
              // Корабль не может касаться открытого попадания, не накрывая его
              if (targetMode) {
                if (covers === 0) continue;
                let touches = false;
                for (const i of cells) {
                  for (const n of neighbors8(i)) if (openSet.has(n) && !cells.includes(n)) { touches = true; break; }
                  if (touches) break;
                }
                if (touches) continue;
              }
              const w = weightLen * (targetMode ? covers * covers * 4 : 1);
              for (const i of cells) if (board.shots[i] === SHOT.NONE) map[i] += w;
            }
          }
        }
      }
      return map;
    }

    freeCells(board) {
      const out = [];
      for (let i = 0; i < SIZE * SIZE; i++) if (board.shots[i] === SHOT.NONE) out.push(i);
      return out;
    }

    /* ---------- Выбор клетки для выстрела ---------- */

    chooseShot(board) {
      const info = this.analyze(board);
      // Обнаруженные радаром палубы — приоритет
      for (const k of this.known) if (board.shots[k] === SHOT.NONE) return k;

      if (this.level === 'easy') return this.chooseEasy(board, info);
      if (this.level === 'normal') return this.chooseNormal(board, info);
      return this.chooseHard(board, info);
    }

    chooseEasy(board, info) {
      // Новичок: иногда добивает раненый корабль, но чаще стреляет наугад и не думает о правиле «корабли не касаются»
      const free = this.freeCells(board);
      if (info.openHits.length && this.rng() < 0.4) {
        const cand = [];
        for (const h of info.openHits) for (const n of neighbors4(h)) if (board.shots[n] === SHOT.NONE) cand.push(n);
        if (cand.length) return cand[Math.floor(this.rng() * cand.length)];
      }
      return free[Math.floor(this.rng() * free.length)];
    }

    chooseNormal(board, info) {
      const free = this.freeCells(board).filter((i) => !info.blocked[i]);
      if (info.openHits.length) {
        const map = this.density(board, info);
        let best = -1, bestV = 0;
        for (const i of free) if (map[i] > bestV) { bestV = map[i]; best = i; }
        if (best !== -1) return best;
      }
      // Охота с шахматной чёткостью, пока жив хотя бы двухпалубный
      const minLen = Math.min(...info.remaining);
      let pool = free;
      if (minLen >= 2) {
        const parity = free.filter((i) => { const [r, c] = rc(i); return (r + c) % 2 === 0; });
        if (parity.length) pool = parity;
      }
      if (!pool.length) pool = this.freeCells(board);
      return pool[Math.floor(this.rng() * pool.length)];
    }

    chooseHard(board, info) {
      const map = this.density(board, info);
      let bestV = -1;
      let best = [];
      for (let i = 0; i < SIZE * SIZE; i++) {
        if (board.shots[i] !== SHOT.NONE) continue;
        if (map[i] > bestV + 1e-6) { bestV = map[i]; best = [i]; }
        else if (Math.abs(map[i] - bestV) < 1e-6) best.push(i);
      }
      if (!best.length) return this.freeCells(board)[0];
      return best[Math.floor(this.rng() * best.length)];
    }

    /* Залп: n лучших клеток */
    chooseSalvo(board, n) {
      const info = this.analyze(board);
      const map = this.density(board, info);
      const free = this.freeCells(board);
      const scored = free.map((i) => ({ i, v: map[i] + this.rng() * 0.01 + (this.known.has(i) ? 1e6 : 0) }));
      if (this.level === 'easy') scored.forEach((s) => (s.v = this.rng()));
      if (this.level === 'normal') scored.forEach((s) => (s.v = s.v * (0.5 + this.rng())));
      scored.sort((a, b) => b.v - a.v);
      return scored.slice(0, Math.min(n, scored.length)).map((s) => s.i);
    }

    /* ---------- Способности (режим «Арсенал») ---------- */

    chooseAbility(board, charges) {
      const info = this.analyze(board);
      const map = this.density(board, info);
      const free = this.freeCells(board);
      if (!free.length) return null;
      const smart = this.level !== 'easy';

      // Радар: пока охотимся — просвечиваем самый «густой» квадрат
      if (charges.radar > 0 && !info.openHits.length && this.known.size === 0) {
        const best = this.bestSquare(board, map, (i) => map[i]);
        if (best.cell !== -1 && (smart || this.rng() < 0.5)) return { type: 'radar', cell: best.cell };
      }
      // Бомба: когда есть открытое попадание с неясным направлением или крупная плотность
      if (charges.bomb > 0) {
        const best = this.bestSquare(board, map, (i) => map[i]);
        const threshold = info.openHits.length ? 0 : 0.6;
        const total = map.reduce((a, b) => a + b, 0) || 1;
        const share = best.sum / total;
        if (best.cell !== -1 && (share > threshold * 0.09 || (!smart && this.rng() < 0.3))) {
          if (info.openHits.length || this.rng() < (smart ? 0.6 : 0.3)) return { type: 'bomb', cell: best.cell };
        }
      }
      // Торпеда: строка с наибольшей плотностью, когда нет открытых попаданий
      if (charges.torpedo > 0 && !info.openHits.length) {
        let bestRow = -1, bestV = 0;
        for (let r = 0; r < SIZE; r++) {
          let s = 0;
          for (let c = 0; c < SIZE; c++) s += map[idx(r, c)];
          if (s > bestV) { bestV = s; bestRow = r; }
        }
        if (bestRow !== -1 && this.rng() < (smart ? 0.7 : 0.35)) return { type: 'torpedo', row: bestRow };
      }
      return null;
    }

    bestSquare(board, map, score) {
      let bestCell = -1, bestSum = -1;
      for (let r = 0; r < SIZE; r++) {
        for (let c = 0; c < SIZE; c++) {
          let s = 0;
          for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
            if (!inBounds(r + dr, c + dc)) continue;
            const i = idx(r + dr, c + dc);
            if (board.shots[i] === SHOT.NONE) s += score(i);
          }
          if (s > bestSum) { bestSum = s; bestCell = idx(r, c); }
        }
      }
      return { cell: bestCell, sum: bestSum };
    }

    rememberDetected(cells) {
      cells.forEach((c) => this.known.add(c));
    }

    toJSON() {
      return { level: this.level, known: Array.from(this.known) };
    }

    static fromJSON(o) {
      const ai = new AI(o.level);
      ai.known = new Set(o.known || []);
      return ai;
    }
  }

  global.BS.AI = AI;
})(typeof window !== "undefined" ? window : globalThis);
if (typeof module !== "undefined" && module.exports) module.exports = (typeof window !== "undefined" ? window : globalThis).BS;
