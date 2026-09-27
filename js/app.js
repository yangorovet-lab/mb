/* Приложение: экраны, расстановка, бой, итоги */
(function (global) {
  'use strict';

  const BS = global.BS;
  const { $, $$, el, sleep, todayKey, formatDateRu, plural, vibrate, isTouch, seededRng, hashString, pick } = BS;
  const { SIZE, FLEET, LETTERS, SHOT, MODES, ABILITIES, DIFFICULTY, idx, rc, cellName, Board, AI, salvoSize } = BS;
  const progress = BS.progress;
  const settings = BS.settings;
  const sfx = BS.audio.sfx;

  /* =====================================================================
     Навигация
     ===================================================================== */
  const history = [];
  let current = 'home';

  function showScreen(id, { push = true } = {}) {
    if (push && current !== id) history.push(current);
    $$('.screen').forEach((s) => s.classList.remove('active'));
    const target = $('#screen-' + id);
    target.classList.add('active');
    target.scrollTop = 0;
    current = id;
    window.scrollTo(0, 0);
    if (id === 'home') renderHome();
    if (id === 'profile') renderProfile();
    if (id === 'settings') renderSettings();
  }

  function goBack() {
    const prev = history.pop() || 'home';
    showScreen(prev, { push: false });
  }

  $$('[data-back]').forEach((b) => b.addEventListener('click', async () => {
    sfx.tap();
    if (current === 'place' && place.cfg && place.cfg.kind === 'online') {
      const ok = await confirmDialog('Покинуть комнату?', 'Соперник останется без пары.', 'Покинуть');
      if (!ok) return;
      online.leave();
      history.length = 0;
      showScreen('home', { push: false });
      return;
    }
    goBack();
  }));

  /* =====================================================================
     Тосты и модалки
     ===================================================================== */
  function toast(text, { icon = '', kind = '', ms = 2600 } = {}) {
    const node = el('div', { class: 'toast ' + kind }, [icon ? el('span', { class: 'toast-icon', text: icon }) : null, el('span', { text })]);
    $('#toasts').appendChild(node);
    requestAnimationFrame(() => node.classList.add('show'));
    setTimeout(() => { node.classList.remove('show'); setTimeout(() => node.remove(), 300); }, ms);
  }

  function modal(content, { closable = true } = {}) {
    const m = $('#modal');
    const card = $('#modal-card');
    card.innerHTML = '';
    if (typeof content === 'string') card.innerHTML = content; else card.appendChild(content);
    m.classList.remove('hidden');
    m.onclick = (e) => { if (closable && e.target === m) closeModal(); };
    return card;
  }

  function closeModal() { $('#modal').classList.add('hidden'); }

  function confirmDialog(title, text, okText) {
    return new Promise((resolve) => {
      const ok = el('button', { class: 'btn primary', text: okText || 'Да', onclick: () => { closeModal(); resolve(true); } });
      const cancel = el('button', { class: 'btn ghost', text: 'Отмена', onclick: () => { closeModal(); resolve(false); } });
      modal(el('div', {}, [el('h3', { text: title }), el('p', { class: 'muted', text }), el('div', { class: 'modal-actions' }, [cancel, ok])]));
    });
  }

  /* =====================================================================
     Тема и звук
     ===================================================================== */
  function applyTheme() {
    document.documentElement.setAttribute('data-theme', progress.get().theme || 'cyan');
  }

  document.addEventListener('pointerdown', () => BS.audio.ensure(), { once: true, capture: true });

  /* =====================================================================
     Рендер досок
     ===================================================================== */
  function buildBoard(container) {
    container.innerHTML = '';
    container.appendChild(el('div', { class: 'lbl corner' }));
    for (let c = 0; c < SIZE; c++) container.appendChild(el('div', { class: 'lbl', text: LETTERS[c] }));
    for (let r = 0; r < SIZE; r++) {
      container.appendChild(el('div', { class: 'lbl', text: String(r + 1) }));
      for (let c = 0; c < SIZE; c++) container.appendChild(el('div', { class: 'cell', 'data-i': idx(r, c) }));
    }
    container._cells = $$('.cell', container);
  }

  function shipShapeClasses(board, i) {
    const ship = board.shipAt(i);
    if (!ship) return '';
    const k = ship.cells.indexOf(i);
    if (ship.len === 1) return 'ship s-one';
    let cls = 'ship ' + (ship.horiz ? 's-h' : 's-v');
    if (k === 0) cls += ' s-head';
    else if (k === ship.len - 1) cls += ' s-tail';
    else cls += ' s-mid';
    return cls;
  }

  /* reveal: показывать корабли; extra: карта индекс→доп. классы */
  function paintBoard(container, board, { reveal = false, extra = null } = {}) {
    const cells = container._cells;
    for (let i = 0; i < SIZE * SIZE; i++) {
      const cell = cells[i];
      let cls = 'cell';
      const ship = board.shipAt(i);
      const shot = board.shots[i];
      if (ship && (reveal || ship.sunk)) cls += ' ' + shipShapeClasses(board, i);
      if (shot === SHOT.MISS) cls += ' miss';
      if (shot === SHOT.HIT) cls += ship && ship.sunk ? ' hit sunk' : ' hit';
      if (board.detected[i] && shot === SHOT.NONE) cls += ' detected';
      if (extra && extra[i]) cls += ' ' + extra[i];
      if (cell.className !== cls) cell.className = cls;
    }
  }

  function cellFromEvent(container, e) {
    const rect = container.getBoundingClientRect();
    const size = rect.width / (SIZE + 1);
    const c = Math.floor((e.clientX - rect.left) / size) - 1;
    const r = Math.floor((e.clientY - rect.top) / size) - 1;
    if (r < 0 || c < 0 || r >= SIZE || c >= SIZE) return -1;
    return idx(r, c);
  }

  function flashCell(container, i, cls, ms) {
    const cell = container._cells[i];
    cell.classList.add(cls);
    setTimeout(() => cell.classList.remove(cls), ms || 700);
  }

  function floatText(layer, text, kind) {
    const node = el('div', { class: 'float ' + (kind || ''), text });
    layer.appendChild(node);
    setTimeout(() => node.remove(), 1100);
  }

  function renderFleet(container, board) {
    const wrap = $('.fleet-ships', container);
    wrap.innerHTML = '';
    let ships = board.ships.slice();
    if (board.virtualFleet) {
      // о флоте соперника известны только потопленные корабли
      const rest = board.remainingFleet();
      ships = ships.concat(rest.map((len) => ({ len, hits: 0, sunk: false })));
    }
    ships.sort((a, b) => b.len - a.len);
    for (const s of ships) {
      const g = el('div', { class: 'fs ' + (s.sunk ? 'sunk' : '') });
      for (let k = 0; k < s.len; k++) g.appendChild(el('i', { class: k < s.hits ? 'dmg' : '' }));
      wrap.appendChild(g);
    }
  }

  /* =====================================================================
     Главная
     ===================================================================== */
  function renderHome() {
    const p = progress.get();
    const lv = progress.levelFromXp(p.xp);
    const rank = progress.rankFor(lv.level);
    $('#home-name').textContent = p.name;
    $('#home-rank-icon').textContent = rank.icon;
    $('#home-rank').textContent = rank.name;
    $('#home-level').textContent = 'Уровень ' + lv.level;
    $('#home-xp-fill').style.width = Math.round((lv.into / lv.need) * 100) + '%';
    $('#home-xp-text').textContent = `${lv.into} / ${lv.need} XP`;
    $('#home-streak b').textContent = p.loginStreak;

    const saved = BS.gameStore.load();
    const cont = $('#home-continue');
    if (saved && !saved.over && (saved.kind !== 'daily' || saved.dateKey === todayKey())) {
      cont.classList.remove('hidden');
      const m = MODES[saved.mode];
      const kindName = saved.kind === 'daily' ? 'Вызов дня' : saved.kind === 'duel' ? 'Дуэль' : (m ? m.name : '');
      const d = saved.difficulty && saved.kind === 'solo' ? ' · ' + DIFFICULTY[saved.difficulty].name : '';
      cont.querySelector('#home-continue-sub').textContent = kindName + d;
    } else cont.classList.add('hidden');

    // вызов дня
    const today = todayKey();
    const rec = p.daily.history[today];
    $('#daily-sub').textContent = rec ? `${'⭐'.repeat(rec.stars)} · ${rec.shots} выстрелов` : (p.daily.streak > 1 ? `Серия: ${p.daily.streak} дн.` : 'Одна доска для всех');
    $('#btn-daily').classList.toggle('done', !!rec);

    // миссии
    progress.ensureMissions();
    const list = $('#missions-list');
    list.innerHTML = '';
    for (const m of p.missions.list) {
      const def = progress.missionDef(m.id);
      if (!def) continue;
      const li = el('li', { class: m.done ? 'done' : '' }, [
        el('div', { class: 'm-row' }, [el('span', { text: def.text }), el('b', { class: 'mono', text: m.done ? '✓' : `+${def.xp}` })]),
        el('div', { class: 'm-bar' }, [el('i', { style: { width: Math.round((m.progress / def.goal) * 100) + '%' } })]),
        el('small', { class: 'mono muted', text: `${m.progress}/${def.goal}` }),
      ]);
      list.appendChild(li);
    }
    const now = new Date();
    const end = new Date(now); end.setHours(24, 0, 0, 0);
    const left = Math.max(0, end - now);
    const h = Math.floor(left / 3600000), mm = Math.floor((left % 3600000) / 60000);
    $('#missions-timer').textContent = `обновятся через ${h}ч ${String(mm).padStart(2, '0')}м`;

    // бонус
    const bonus = $('#btn-bonus');
    if (progress.dailyBonusAvailable()) {
      bonus.classList.remove('hidden');
      $('#bonus-amount').textContent = `+${progress.dailyBonusAmount()} XP`;
    } else bonus.classList.add('hidden');
  }

  $('#btn-bonus').addEventListener('click', () => {
    const amount = progress.claimDailyBonus();
    if (amount) {
      sfx.reward();
      vibrate([20, 30, 20]);
      toast(`+${amount} XP за ${progress.get().loginStreak}-й день подряд`, { icon: '🎁', kind: 'good' });
      renderHome();
    }
  });

  $('#btn-edit-name').addEventListener('click', () => {
    const input = el('input', { class: 'input', maxlength: 16, value: progress.get().name, placeholder: 'Имя капитана' });
    const ok = el('button', { class: 'btn primary', text: 'Сохранить', onclick: () => { progress.setName(input.value); closeModal(); renderHome(); } });
    modal(el('div', {}, [el('h3', { text: 'Как тебя звать?' }), input, el('div', { class: 'modal-actions' }, [ok])]));
    input.focus();
  });

  $('#btn-play').addEventListener('click', () => { sfx.tap(); renderModes(); showScreen('modes'); });
  $('#btn-profile').addEventListener('click', () => { sfx.tap(); showScreen('profile'); });
  $('#btn-settings').addEventListener('click', () => { sfx.tap(); showScreen('settings'); });
  $('#btn-howto').addEventListener('click', () => { sfx.tap(); showScreen('howto'); });
  $('#btn-duel').addEventListener('click', () => { sfx.tap(); startDuelSetup(); });
  $('#btn-online').addEventListener('click', () => { sfx.tap(); online.openScreen(); });
  $('#btn-daily').addEventListener('click', () => { sfx.tap(); startDaily(); });
  $('#home-continue').addEventListener('click', () => { sfx.tap(); resumeGame(); });

  /* =====================================================================
     Выбор режима
     ===================================================================== */
  const setup = { mode: 'classic', difficulty: 'normal' };
  try { Object.assign(setup, JSON.parse(localStorage.getItem('bs_setup') || '{}')); } catch (e) { /* ignore */ }
  function saveSetup() { try { localStorage.setItem('bs_setup', JSON.stringify(setup)); } catch (e) { /* ignore */ } }

  function renderModes() {
    const list = $('#modes-list');
    list.innerHTML = '';
    const p = progress.get();
    for (const m of Object.values(MODES)) {
      if (m.hidden) continue;
      const played = p.stats.byMode[m.id] || 0;
      const card = el('button', { class: 'mode-card' + (setup.mode === m.id ? ' selected' : ''), 'data-mode': m.id }, [
        el('div', { class: 'mode-icon', text: m.icon }),
        el('div', { class: 'mode-body' }, [
          el('div', { class: 'mode-head' }, [el('b', { text: m.name }), el('span', { class: 'tag', text: m.tag })]),
          el('p', { text: m.desc }),
          el('small', { class: 'mono muted', text: `×${m.xp} XP${played ? ` · сыграно ${played}` : ''}` }),
        ]),
      ]);
      card.addEventListener('click', () => { setup.mode = m.id; saveSetup(); sfx.select(); renderModes(); });
      list.appendChild(card);
    }
    const seg = $('#difficulty-seg');
    seg.innerHTML = '';
    for (const d of Object.values(DIFFICULTY)) {
      const b = el('button', { class: setup.difficulty === d.id ? 'on' : '', text: d.name });
      b.addEventListener('click', () => { setup.difficulty = d.id; saveSetup(); sfx.select(); renderModes(); });
      seg.appendChild(b);
    }
    $('#difficulty-desc').textContent = DIFFICULTY[setup.difficulty].desc + ` · опыт ×${DIFFICULTY[setup.difficulty].xp}`;
  }

  $('#btn-modes-go').addEventListener('click', () => {
    sfx.tap();
    startPlacement({ kind: 'solo', mode: setup.mode, difficulty: setup.difficulty });
  });

  /* =====================================================================
     Расстановка
     ===================================================================== */
  const place = {
    board: null, horiz: true, selLen: null, drag: null, onDone: null, title: '',
  };
  const placeBoardEl = $('#place-board');
  buildBoard(placeBoardEl);

  function startPlacement(cfg) {
    place.cfg = cfg;
    place.board = new Board();
    place.board.randomize();
    place.selLen = null;
    place.drag = null;
    $('#place-title').textContent = cfg.title || 'Расстановка';
    $('#place-hint').textContent = cfg.hint || 'Перетащи корабль на поле или выбери в панели и нажми на клетку. Нажми на поставленный корабль, чтобы повернуть.';
    renderPlacement();
    showScreen('place');
  }

  function renderPlacement(ghost) {
    const b = place.board;
    const extra = {};
    if (ghost) {
      const cls = ghost.valid ? 'ghost-ok' : 'ghost-bad';
      ghost.cells.forEach((i) => (extra[i] = cls));
    }
    if (place.drag && place.drag.fromShip) place.drag.fromShip.cells.forEach((i) => (extra[i] = (extra[i] || '') + ' lifted'));
    paintBoard(placeBoardEl, b, { reveal: true, extra });

    // панель кораблей
    const tray = $('#tray');
    tray.innerHTML = '';
    const remaining = b.remainingFleet();
    for (const len of [4, 3, 2, 1]) {
      const count = remaining.filter((l) => l === len).length;
      const item = el('div', { class: 'tray-item' + (count === 0 ? ' empty' : '') + (place.selLen === len && count ? ' selected' : ''), 'data-len': len }, [
        el('div', { class: 'tray-ship' }, Array.from({ length: len }, () => el('i'))),
        el('span', { class: 'mono', text: '×' + count }),
      ]);
      tray.appendChild(item);
    }
    if (place.selLen && !remaining.includes(place.selLen)) place.selLen = null;
    $('#btn-rotate').textContent = place.horiz ? '↔ Горизонтально' : '↕ Вертикально';
    $('#btn-start').disabled = !b.isComplete();
  }

  /* попытка поставить корабль головой в клетку, сдвигая внутрь поля */
  function tryPlaceAt(len, i, horiz, anchorK) {
    const b = place.board;
    let [r, c] = rc(i);
    if (horiz) c -= anchorK || 0; else r -= anchorK || 0;
    if (horiz) c = Math.max(0, Math.min(SIZE - len, c)); else r = Math.max(0, Math.min(SIZE - len, r));
    if (b.canPlace(r, c, len, horiz)) return b.place(r, c, len, horiz);
    return null;
  }

  function ghostFor(len, i, horiz, anchorK, ignoreId) {
    const b = place.board;
    let [r, c] = rc(i);
    if (horiz) c -= anchorK || 0; else r -= anchorK || 0;
    if (horiz) c = Math.max(0, Math.min(SIZE - len, c)); else r = Math.max(0, Math.min(SIZE - len, r));
    const cells = Board.shipCells(r, c, len, horiz) || [];
    return { cells, valid: b.canPlace(r, c, len, horiz, ignoreId), r, c };
  }

  function shakeBoard() {
    placeBoardEl.classList.add('shake');
    vibrate(40);
    setTimeout(() => placeBoardEl.classList.remove('shake'), 350);
  }

  placeBoardEl.addEventListener('pointerdown', (e) => {
    const i = cellFromEvent(placeBoardEl, e);
    if (i < 0) return;
    e.preventDefault();
    const ship = place.board.shipAt(i);
    if (ship) {
      place.drag = { len: ship.len, horiz: ship.horiz, fromShip: ship, anchorK: ship.cells.indexOf(i), startX: e.clientX, startY: e.clientY, moved: false, cell: i, pointerId: e.pointerId };
      placeBoardEl.setPointerCapture(e.pointerId);
      renderPlacement();
    } else if (place.selLen) {
      const placed = tryPlaceAt(place.selLen, i, place.horiz, 0);
      if (placed) { sfx.select(); vibrate(10); } else shakeBoard();
      renderPlacement();
    } else {
      // подсказка: выбрать первый оставшийся корабль
      const rem = place.board.remainingFleet();
      if (rem.length) { place.selLen = rem[0]; toast('Выбран ' + rem[0] + '-палубный. Нажми на клетку ещё раз.', { icon: '👆' }); renderPlacement(); }
    }
  });

  function onDragMove(e) {
    const d = place.drag;
    if (!d) return;
    if (Math.hypot(e.clientX - d.startX, e.clientY - d.startY) > 8) d.moved = true;
    if (!d.moved) return;
    const i = cellFromEvent(placeBoardEl, e);
    if (i < 0) { d.cell = -1; renderPlacement(null); return; }
    d.cell = i;
    renderPlacement(ghostFor(d.len, i, d.horiz, d.anchorK, d.fromShip ? d.fromShip.id : -1));
  }

  function onDragEnd(e) {
    const d = place.drag;
    if (!d) return;
    place.drag = null;
    const b = place.board;
    if (!d.moved) {
      if (d.fromShip) {
        // поворот вокруг нажатой клетки
        const s = d.fromShip;
        b.remove(s.id);
        const g = ghostFor(s.len, d.cell, !s.horiz, d.anchorK, -1);
        if (g.valid && s.len > 1) { b.place(g.r, g.c, s.len, !s.horiz); sfx.select(); vibrate(10); }
        else {
          b.place(s.r, s.c, s.len, s.horiz);
          if (s.len > 1) shakeBoard();
        }
      } else if (d.fromTray) {
        place.selLen = d.len;
        sfx.tap();
      }
      renderPlacement();
      return;
    }
    // дроп
    if (d.fromShip) b.remove(d.fromShip.id);
    let ok = false;
    if (d.cell >= 0) {
      const g = ghostFor(d.len, d.cell, d.horiz, d.anchorK, -1);
      if (g.valid) { b.place(g.r, g.c, d.len, d.horiz); ok = true; }
    }
    if (!ok && d.fromShip) {
      if (d.cell < 0) { /* вынесли за поле — корабль возвращается в панель */ place.selLen = d.len; }
      else { b.place(d.fromShip.r, d.fromShip.c, d.fromShip.len, d.fromShip.horiz); shakeBoard(); }
    } else if (!ok) shakeBoard();
    if (ok) { sfx.select(); vibrate(10); }
    renderPlacement();
  }

  placeBoardEl.addEventListener('pointermove', onDragMove);
  placeBoardEl.addEventListener('pointerup', onDragEnd);
  placeBoardEl.addEventListener('pointercancel', onDragEnd);

  $('#tray').addEventListener('pointerdown', (e) => {
    const item = e.target.closest('.tray-item');
    if (!item || item.classList.contains('empty')) return;
    e.preventDefault();
    const len = Number(item.dataset.len);
    place.drag = { len, horiz: place.horiz, fromTray: true, anchorK: 0, startX: e.clientX, startY: e.clientY, moved: false, cell: -1, pointerId: e.pointerId };
    $('#tray').setPointerCapture(e.pointerId);
  });
  $('#tray').addEventListener('pointermove', onDragMove);
  $('#tray').addEventListener('pointerup', onDragEnd);
  $('#tray').addEventListener('pointercancel', onDragEnd);

  $('#btn-random').addEventListener('click', () => { place.board.randomize(); place.selLen = null; sfx.select(); vibrate(15); renderPlacement(); });
  $('#btn-rotate').addEventListener('click', () => { place.horiz = !place.horiz; sfx.tap(); renderPlacement(); });
  $('#btn-clear').addEventListener('click', () => { place.board.clear(); place.selLen = 4; sfx.tap(); renderPlacement(); });
  $('#btn-start').addEventListener('click', () => {
    if (!place.board.isComplete()) return;
    sfx.select();
    const cfg = place.cfg;
    if (cfg.onDone) cfg.onDone(place.board);
    else startSoloGame(cfg, place.board);
  });

  /* =====================================================================
     Игра
     ===================================================================== */
  let game = null;
  let busy = false; // идёт анимация / ход ИИ
  let timer = { id: null, left: 0, total: 0 };

  const boardEnemyEl = $('#board-enemy');
  const boardOwnEl = $('#board-own');
  buildBoard(boardEnemyEl);
  buildBoard(boardOwnEl);

  function newStats() { return { shots: 0, hits: 0, sunk: 0, bestCombo: 0 }; }
  function newCharges() { return { radar: 1, bomb: 1, torpedo: 1 }; }

  function startSoloGame(cfg, playerBoard) {
    const enemy = new Board();
    enemy.randomize();
    game = {
      kind: 'solo', mode: cfg.mode, difficulty: cfg.difficulty,
      boards: [playerBoard, enemy], turn: 0, ai: new AI(cfg.difficulty),
      charges: [newCharges(), newCharges()], stats: [newStats(), newStats()],
      combo: 0, over: false, winner: null, target: -1, ability: null, salvo: [], viewOwn: false,
      lostAtEnd: 0, turnsCount: 0,
    };
    enterBattle();
  }

  function startDaily() {
    const dateKey = todayKey();
    const rng = seededRng(hashString('daily:' + dateKey));
    const enemy = new Board();
    enemy.randomize(FLEET, rng);
    const own = new Board();
    own.randomize(FLEET, rng);
    game = {
      kind: 'daily', mode: 'classic', difficulty: null, dateKey,
      boards: [own, enemy], turn: 0, ai: null,
      charges: [newCharges(), newCharges()], stats: [newStats(), newStats()],
      combo: 0, over: false, winner: null, target: -1, ability: null, salvo: [], viewOwn: false,
    };
    enterBattle();
    toast('Одна доска для всех. Найди флот за минимум выстрелов.', { icon: '📅', ms: 3200 });
  }

  function startDuelSetup() {
    startPlacement({
      kind: 'duel', title: 'Игрок 1 · расстановка', hint: 'Игрок 1, расставь флот. Игрок 2 пусть отвернётся.',
      onDone(board1) {
        startPlacement({
          kind: 'duel', title: 'Игрок 2 · расстановка', hint: 'Теперь Игрок 2. Игрок 1 не подглядывает.',
          onDone(board2) {
            game = {
              kind: 'duel', mode: 'classic', difficulty: null,
              boards: [board1, board2], turn: 0, ai: null,
              charges: [newCharges(), newCharges()], stats: [newStats(), newStats()],
              combo: 0, over: false, winner: null, target: -1, ability: null, salvo: [], viewOwn: false,
            };
            enterBattle();
            showPass(0);
          },
        });
      },
    });
  }

  function serializeGame() {
    if (!game) return null;
    return {
      ...game,
      boards: game.boards.map((b) => b.toJSON()),
      ai: game.ai ? game.ai.toJSON() : null,
    };
  }

  function saveGame() {
    if (!game || game.over || game.kind === 'online') { BS.gameStore.clear(); return; }
    BS.gameStore.save(serializeGame());
  }

  function resumeGame() {
    const saved = BS.gameStore.load();
    if (!saved) return;
    game = { ...saved, boards: saved.boards.map(Board.fromJSON), ai: saved.ai ? AI.fromJSON(saved.ai) : null, target: -1, ability: null, salvo: [] };
    enterBattle();
    if (game.kind === 'duel') showPass(game.turn);
    else if (game.turn === 1) aiTurn();
  }

  function me() { return game.kind === 'duel' ? game.turn : 0; }
  function foe() { return 1 - me(); }
  function myBoard() { return game.boards[me()]; }
  function enemyBoard() { return game.boards[foe()]; }

  function enterBattle() {
    busy = false;
    stopTimer();
    game.viewOwn = false;
    $('#battle-boards').classList.remove('view-own');
    const modeName = game.kind === 'daily' ? 'Вызов дня · ' + formatDateRu(game.dateKey) : game.kind === 'duel' ? 'Дуэль' : game.kind === 'online' ? `Онлайн · комната ${game.room}` : `${MODES[game.mode].name} · ${DIFFICULTY[game.difficulty].name}`;
    $('#battle-mode').textContent = modeName;
    $('#abilities').classList.toggle('hidden', game.mode !== 'arsenal');
    $('#timer').classList.toggle('hidden', game.mode !== 'blitz');
    $('#own-slot').classList.toggle('hidden', game.kind === 'daily');
    $('#battle-boards').classList.toggle('single', game.kind === 'daily');
    $('#fleet-own').classList.toggle('hidden', game.kind === 'daily');
    $('#reactions').classList.toggle('hidden', game.kind !== 'online');
    $('#fleet-enemy small').textContent = game.kind === 'online' ? game.opp : 'Противник';
    showScreen('battle');
    renderBattle();
    saveGame();
    if (game.kind === 'solo' && game.turn === 0 && game.mode === 'blitz') startTimer();
    if (game.kind === 'solo' && game.turn === 0) setStatus(game.mode === 'salvo' ? `Выбери ${salvoSize(myBoard().aliveShips().length)} клеток и жми «Залп»` : 'Выбери клетку на поле противника');
    if (game.kind === 'online') setStatus(game.turn === 0 ? 'Ты ходишь первым. Выбери клетку.' : `Первым ходит ${game.opp}. Жди.`);
  }

  function renderBattle() {
    if (!game) return;
    const mine = myBoard();
    const theirs = enemyBoard();
    const extra = {};
    if (game.target >= 0 && !game.ability) extra[game.target] = 'target';
    for (const i of game.salvo) extra[i] = 'target';
    if (game.ability && game.target >= 0) {
      const t = game.target;
      if (game.ability === 'torpedo') {
        const [r] = rc(t);
        for (let c = 0; c < SIZE; c++) extra[idx(r, c)] = 'area';
      } else {
        const [r, c] = rc(t);
        for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) if (BS.inBounds(r + dr, c + dc)) extra[idx(r + dr, c + dc)] = 'area';
        extra[t] = 'area target';
      }
    }
    paintBoard(boardEnemyEl, theirs, { reveal: game.over, extra });
    paintBoard(boardOwnEl, mine, { reveal: true });
    renderFleet($('#fleet-enemy'), theirs);
    renderFleet($('#fleet-own'), mine);

    const myTurn = game.kind === 'duel' ? true : game.turn === 0;
    const label = $('#turn-label');
    if (game.over) label.textContent = game.kind === 'duel' ? `Победил Игрок ${game.winner + 1}` : game.winner === 0 ? 'Победа!' : 'Поражение';
    else if (game.kind === 'duel') label.textContent = `Ходит Игрок ${game.turn + 1}`;
    else label.textContent = myTurn ? 'Твой ход' : (game.kind === 'online' ? 'Ход соперника' : 'Ход противника');
    label.classList.toggle('enemy', !myTurn && !game.over);
    $('#screen-battle').classList.toggle('my-turn', myTurn && !game.over);

    // кнопка огня
    const fire = $('#btn-fire');
    if (game.mode === 'salvo') {
      const n = salvoSize(mine.aliveShips().length);
      fire.textContent = `Залп ${game.salvo.length}/${n}`;
      fire.disabled = busy || !myTurn || game.salvo.length === 0 || game.over;
    } else if (game.ability) {
      const a = ABILITIES[game.ability];
      fire.textContent = game.target >= 0 ? `${a.icon} ${a.name}` : `${a.icon} Выбери цель`;
      fire.disabled = busy || !myTurn || game.target < 0 || game.over;
    } else {
      fire.textContent = game.target >= 0 ? `Огонь · ${cellName(game.target)}` : 'Огонь';
      fire.disabled = busy || !myTurn || game.target < 0 || game.over;
    }

    // комбо
    $('#combo').textContent = myTurn && game.combo >= 2 ? `КОМБО ×${game.combo}` : '';

    // способности
    if (game.mode === 'arsenal') {
      const wrap = $('#abilities');
      wrap.innerHTML = '';
      const ch = game.charges[me()];
      for (const a of Object.values(ABILITIES)) {
        const b = el('button', { class: 'ab' + (game.ability === a.id ? ' on' : '') + (ch[a.id] <= 0 ? ' empty' : ''), title: a.hint }, [
          el('span', { class: 'ab-icon', text: a.icon }),
          el('span', { class: 'ab-name', text: a.name }),
          el('span', { class: 'ab-count mono', text: '×' + ch[a.id] }),
        ]);
        b.addEventListener('click', () => {
          if (busy || game.over || (game.kind === 'solo' && game.turn !== 0)) return;
          if (ch[a.id] <= 0) { toast('Нет зарядов. Потопи корабль — получишь новый.', { icon: a.icon }); return; }
          game.ability = game.ability === a.id ? null : a.id;
          game.target = -1;
          sfx.select();
          setStatus(game.ability ? a.hint + (a.id === 'torpedo' ? ' Нажми на любую клетку строки.' : ' Нажми на центр квадрата.') : 'Выбери клетку на поле противника');
          renderBattle();
        });
        wrap.appendChild(b);
      }
    }
  }

  function setStatus(text) { $('#status-line').textContent = text; }

  /* ---------- Взаимодействие с полем противника ---------- */
  boardEnemyEl.addEventListener('pointerdown', (e) => {
    if (!game || game.over || busy) return;
    if ((game.kind === 'solo' || game.kind === 'online') && game.turn !== 0) return;
    if (game.viewOwn && !isWide()) { toggleView(false); return; }
    const i = cellFromEvent(boardEnemyEl, e);
    if (i < 0) return;
    e.preventDefault();
    const theirs = enemyBoard();
    if (game.mode === 'salvo') {
      const n = salvoSize(myBoard().aliveShips().length);
      const k = game.salvo.indexOf(i);
      if (k >= 0) game.salvo.splice(k, 1);
      else if (theirs.shots[i] !== SHOT.NONE) { flashCell(boardEnemyEl, i, 'deny', 300); return; }
      else if (game.salvo.length >= n) { toast(`В залпе максимум ${n} ${plural(n, 'снаряд', 'снаряда', 'снарядов')}`, { icon: '💥' }); return; }
      else game.salvo.push(i);
      sfx.tap();
      renderBattle();
      return;
    }
    if (game.ability) {
      if (game.target === i || settings.get().quickFire) { game.target = i; useAbility(); return; }
      game.target = i;
      sfx.tap();
      renderBattle();
      return;
    }
    if (theirs.shots[i] !== SHOT.NONE) { flashCell(boardEnemyEl, i, 'deny', 300); vibrate(20); return; }
    if (game.target === i || settings.get().quickFire) { game.target = i; playerFire(); return; }
    game.target = i;
    sfx.tap();
    vibrate(5);
    renderBattle();
  });

  $('#btn-fire').addEventListener('click', () => {
    if (!game || busy) return;
    if (game.mode === 'salvo') playerSalvo();
    else if (game.ability) useAbility();
    else playerFire();
  });

  const isWide = () => matchMedia('(min-width: 820px)').matches;
  function toggleView(own) {
    game.viewOwn = isWide() ? false : (own == null ? !game.viewOwn : own);
    $('#battle-boards').classList.toggle('view-own', game.viewOwn);
  }
  $('#own-slot').addEventListener('click', () => { if (game && game.kind !== 'daily' && !isWide()) { sfx.tap(); toggleView(); } });

  $('#btn-battle-exit').addEventListener('click', async () => {
    sfx.tap();
    if (game && !game.over && game.kind === 'online') {
      const ok = await confirmDialog('Покинуть партию?', 'Сопернику засчитается победа, а тебе — поражение.', 'Покинуть');
      if (!ok) return;
      online.leave();
      game = null;
      busy = false;
      showScreen('home', { push: false });
      history.length = 0;
      return;
    }
    if (game && !game.over) {
      const ok = await confirmDialog('Выйти из боя?', game.kind === 'duel' ? 'Партия будет сохранена, можно продолжить с главного экрана.' : 'Партия сохранится, можно продолжить позже.', 'Выйти');
      if (!ok) return;
      stopTimer();
      saveGame();
    }
    busy = false;
    showScreen('home', { push: false });
    history.length = 0;
  });

  /* ---------- Применение выстрела с анимацией ---------- */
  async function applyShot(shooter, i, { silent = false } = {}) {
    const board = game.boards[1 - shooter];
    let res;
    if (game.kind === 'online' && shooter === 0) {
      res = await online.remoteShot(i);
      if (!res) return { result: 'aborted', cell: i };
      online.applyResultToView(board, res);
    } else {
      res = board.shoot(i);
      if (game.kind === 'online' && shooter === 1) online.sendResult(board, res);
    }
    if (res.result === 'repeat') return res;
    const st = game.stats[shooter];
    st.shots++;
    const isMe = shooter === me();
    const targetEl = isMe ? boardEnemyEl : boardOwnEl;
    const layer = isMe ? $('#float-enemy') : $('#float-own');
    if (res.result === 'miss') {
      game.combo = 0;
      if (!silent) { sfx.miss(); flashCell(targetEl, i, 'anim-miss', 600); floatText(layer, 'Мимо', 'miss'); }
    } else {
      st.hits++;
      game.combo++;
      st.bestCombo = Math.max(st.bestCombo, game.combo);
      if (res.result === 'sunk') {
        st.sunk++;
        if (settings.get().autoMark) board.markAround(res.around);
        if (game.mode === 'arsenal') {
          const ch = game.charges[shooter];
          const gift = pick(['radar', 'bomb', 'torpedo']);
          ch[gift] = Math.min(3, ch[gift] + 1);
          if (isMe && !silent) toast(`+1 заряд: ${ABILITIES[gift].icon} ${ABILITIES[gift].name}`, { icon: '🎁', kind: 'good' });
        }
        if (!silent) {
          sfx.sunk();
          vibrate(isMe ? [30, 40, 60] : [80, 40, 80]);
          res.ship.cells.forEach((c) => flashCell(targetEl, c, 'anim-sunk', 900));
          floatText(layer, isMe ? 'Потопил!' : 'Потоплен!', 'sunk');
          if (!isMe) shakeScreen();
        }
      } else if (!silent) {
        sfx.hit();
        vibrate(isMe ? 25 : 60);
        flashCell(targetEl, i, 'anim-hit', 700);
        floatText(layer, isMe ? (game.combo >= 2 ? `Попал! ×${game.combo}` : 'Попал!') : 'Попадание', 'hit');
        if (!isMe) shakeScreen();
      }
    }
    renderBattle();
    const finished = game.kind === 'online' && shooter === 0 ? !!res.gameOver : board.allSunk();
    if (finished) await finishGame(shooter);
    return res;
  }

  function shakeScreen() {
    const s = $('#screen-battle');
    s.classList.add('shake');
    setTimeout(() => s.classList.remove('shake'), 400);
  }

  /* ---------- Ход игрока ---------- */
  async function playerFire() {
    if (busy || game.over || game.target < 0) return;
    if ((game.kind === 'solo' || game.kind === 'online') && game.turn !== 0) return;
    const i = game.target;
    game.target = -1;
    busy = true;
    stopTimer();
    sfx.shot();
    if (game.kind === 'online') setStatus('Выстрел…');
    const res = await applyShot(me(), i);
    busy = false;
    if (!game || game.over) return;
    if (res.result === 'aborted') { setStatus('Соперник не отвечает. Попробуй ещё раз.'); renderBattle(); return; }
    if (res.result === 'miss') {
      setStatus('Мимо. Ход противника.');
      await endMyTurn();
    } else {
      setStatus(res.result === 'sunk' ? 'Корабль потоплен! Стреляй ещё.' : 'Попадание! Добивай.');
      if (game.mode === 'blitz') startTimer();
      saveGame();
      renderBattle();
    }
  }

  async function playerSalvo() {
    if (busy || game.over || !game.salvo.length) return;
    const cells = game.salvo.slice();
    game.salvo = [];
    busy = true;
    let anyHit = false;
    for (const i of cells) {
      sfx.shot();
      const res = await applyShot(me(), i);
      if (res.result !== 'miss') anyHit = true;
      if (game.over) { busy = false; return; }
      await sleep(320);
    }
    busy = false;
    game.combo = 0;
    setStatus(anyHit ? 'Есть попадания! Ход противника.' : 'Все мимо. Ход противника.');
    await endMyTurn();
  }

  async function useAbility() {
    if (busy || game.over || game.target < 0 || !game.ability) return;
    const type = game.ability;
    const ch = game.charges[me()];
    if (ch[type] <= 0) return;
    const theirs = enemyBoard();
    const t = game.target;
    game.target = -1;
    game.ability = null;
    busy = true;
    stopTimer();
    ch[type]--;
    if (type === 'radar') {
      sfx.radar();
      const { area, found } = theirs.radar(t);
      area.forEach((c) => flashCell(boardEnemyEl, c, 'anim-scan', 900));
      await sleep(500);
      if (found.length) { sfx.detect(); vibrate([15, 30, 15]); }
      setStatus(found.length ? `Радар: ${found.length} ${plural(found.length, 'палуба', 'палубы', 'палуб')} в квадрате. Ход не потрачен.` : 'Радар: в квадрате пусто. Ход не потрачен.');
      floatText($('#float-enemy'), found.length ? `Обнаружено: ${found.length}` : 'Чисто', found.length ? 'hit' : 'miss');
      busy = false;
      renderBattle();
      if (game.mode === 'blitz') startTimer();
      saveGame();
      return;
    }
    let anyHit = false;
    if (type === 'bomb') {
      const cells = theirs.bombCells(t);
      sfx.shot();
      for (const c of cells) {
        const res = await applyShot(me(), c, { silent: true });
        if (res.result !== 'miss') anyHit = true;
        flashCell(boardEnemyEl, c, res.result === 'miss' ? 'anim-miss' : 'anim-hit', 700);
        if (game.over) { busy = false; return; }
        await sleep(70);
      }
      if (anyHit) { sfx.hit(); vibrate(40); } else sfx.miss();
      floatText($('#float-enemy'), anyHit ? 'Бомба: есть попадания!' : 'Бомба: мимо', anyHit ? 'hit' : 'miss');
    } else if (type === 'torpedo') {
      const [row] = rc(t);
      const { hit, trail } = theirs.torpedoTarget(row);
      sfx.torpedo();
      for (const c of trail) { flashCell(boardEnemyEl, c, 'anim-trail', 500); await sleep(45); }
      if (hit >= 0) {
        const res = await applyShot(me(), hit);
        anyHit = res.result !== 'miss';
        if (game.over) { busy = false; return; }
      } else {
        // вся строка пустая — помечаем промахами
        trail.forEach((c) => { theirs.shots[c] = SHOT.MISS; });
        game.stats[me()].shots++;
        sfx.miss();
        floatText($('#float-enemy'), 'Торпеда ушла в пустоту', 'miss');
        renderBattle();
      }
    }
    busy = false;
    if (game.over) return;
    if (anyHit) {
      game.combo = Math.max(game.combo, 1);
      setStatus('Есть попадание! Стреляй ещё.');
      if (game.mode === 'blitz') startTimer();
      saveGame();
      renderBattle();
    } else {
      game.combo = 0;
      setStatus('Мимо. Ход противника.');
      await endMyTurn();
    }
  }

  async function endMyTurn() {
    game.combo = 0;
    game.target = -1;
    game.ability = null;
    if (game.kind === 'daily') { renderBattle(); saveGame(); setStatus('Продолжай — здесь противник не отвечает.'); return; }
    if (game.kind === 'online') { game.turn = 1; renderBattle(); setStatus(`Ход соперника: ${game.opp}`); return; }
    if (game.kind === 'duel') {
      game.turn = 1 - game.turn;
      saveGame();
      renderBattle();
      await sleep(900);
      showPass(game.turn);
      return;
    }
    game.turn = 1;
    saveGame();
    renderBattle();
    await aiTurn();
  }

  /* ---------- Ход ИИ ---------- */
  async function aiTurn() {
    if (!game || game.over || game.turn !== 1 || game.kind !== 'solo') return;
    busy = true;
    const ai = game.ai;
    const playerBoard = game.boards[0];
    const pace = game.mode === 'blitz' ? 450 : 750;
    const think = game.mode === 'blitz' ? 500 : 800;
    setStatus('Противник целится…');
    renderBattle();
    await sleep(think);
    if (game.mode === 'salvo') {
      const n = salvoSize(game.boards[1].aliveShips().length);
      const cells = ai.chooseSalvo(playerBoard, n);
      for (const c of cells) {
        if (game.over || !game) return;
        sfx.shot();
        await applyShot(1, c);
        await sleep(pace - 200);
      }
      if (game.over || !game) return;
      game.combo = 0;
    } else {
      let shooting = true;
      let guard = 0;
      while (shooting && !game.over && guard++ < 60) {
        let res;
        let usedAbility = false;
        if (game.mode === 'arsenal') {
          const ab = ai.chooseAbility(playerBoard, game.charges[1]);
          if (ab) {
            usedAbility = true;
            game.charges[1][ab.type]--;
            if (ab.type === 'radar') {
              toast('Противник использует радар', { icon: '📡' });
              sfx.radar();
              const { area, found } = playerBoard.radar(ab.cell);
              area.forEach((c) => flashCell(boardOwnEl, c, 'anim-scan', 900));
              ai.rememberDetected(found);
              playerBoard.detected.fill(0); // игроку не показываем, что нашёл ИИ
              await sleep(900);
              renderBattle();
              continue;
            }
            if (ab.type === 'bomb') {
              toast('Противник сбросил бомбу!', { icon: '💣', kind: 'bad' });
              const cells = playerBoard.bombCells(ab.cell);
              let any = false;
              for (const c of cells) {
                const r = await applyShot(1, c, { silent: true });
                flashCell(boardOwnEl, c, r.result === 'miss' ? 'anim-miss' : 'anim-hit', 700);
                if (r.result !== 'miss') any = true;
                if (game.over || !game) return;
                await sleep(60);
              }
              if (any) { sfx.hurt(); shakeScreen(); vibrate(80); } else sfx.miss();
              res = { result: any ? 'hit' : 'miss' };
            } else if (ab.type === 'torpedo') {
              toast('Противник пустил торпеду!', { icon: '🚀', kind: 'bad' });
              sfx.torpedo();
              const { hit, trail } = playerBoard.torpedoTarget(ab.row);
              for (const c of trail) { flashCell(boardOwnEl, c, 'anim-trail', 500); await sleep(40); }
              if (hit >= 0) res = await applyShot(1, hit);
              else { trail.forEach((c) => { playerBoard.shots[c] = SHOT.MISS; }); game.stats[1].shots++; res = { result: 'miss' }; renderBattle(); }
              if (game.over || !game) return;
            }
          }
        }
        if (!usedAbility) {
          const cell = ai.chooseShot(playerBoard);
          if (cell == null) break;
          sfx.shot();
          res = await applyShot(1, cell);
        }
        if (game.over || !game) return;
        if (res.result === 'miss') shooting = false;
        else { await sleep(pace); }
        if (shooting) { setStatus('Противник добивает…'); }
        await sleep(shooting ? pace : pace * 0.6);
      }
    }
    if (game.over || !game) return;
    game.turn = 0;
    game.combo = 0;
    busy = false;
    setStatus(game.mode === 'salvo' ? `Твой залп: ${salvoSize(game.boards[0].aliveShips().length)} ${plural(salvoSize(game.boards[0].aliveShips().length), 'снаряд', 'снаряда', 'снарядов')}` : 'Твой ход. Выбери клетку.');
    renderBattle();
    saveGame();
    if (game.mode === 'blitz') startTimer();
  }

  /* ---------- Дуэль: передача устройства ---------- */
  function showPass(turn) {
    const ov = $('#pass-overlay');
    ov.classList.remove('hidden');
    $('#pass-title').textContent = 'Передай устройство';
    $('#pass-text').textContent = `Ходит Игрок ${turn + 1}. Игрок ${2 - turn}, не подглядывай!`;
    // скрываем поля, пока экран не подтверждён
    $('#battle-boards').classList.add('blur');
  }
  $('#btn-pass-ok').addEventListener('click', () => {
    sfx.tap();
    $('#pass-overlay').classList.add('hidden');
    $('#battle-boards').classList.remove('blur');
    game.viewOwn = false;
    $('#battle-boards').classList.remove('view-own');
    setStatus(`Игрок ${game.turn + 1}, выбери клетку`);
    renderBattle();
  });

  /* ---------- Таймер блица ---------- */
  function startTimer() {
    stopTimer();
    if (!game || game.mode !== 'blitz' || game.over) return;
    timer.total = MODES.blitz.turnTime;
    timer.left = timer.total;
    updateTimer();
    timer.id = setInterval(() => {
      if (document.hidden) return;
      timer.left -= 0.1;
      if (timer.left <= 3.05 && Math.abs(timer.left - Math.round(timer.left)) < 0.06) sfx.tick();
      if (timer.left <= 0) { stopTimer(); onTimeout(); return; }
      updateTimer();
    }, 100);
  }
  function stopTimer() { if (timer.id) clearInterval(timer.id); timer.id = null; $('#timer').classList.remove('urgent'); }
  function updateTimer() {
    const arc = $('#timer-arc');
    const frac = Math.max(0, timer.left / timer.total);
    const circ = 2 * Math.PI * 16;
    arc.style.strokeDasharray = circ;
    arc.style.strokeDashoffset = circ * (1 - frac);
    $('#timer-text').textContent = Math.ceil(timer.left);
    $('#timer').classList.toggle('urgent', timer.left <= 3);
  }
  async function onTimeout() {
    if (!game || game.over || busy || game.turn !== 0) return;
    sfx.timeout();
    vibrate([40, 40, 40]);
    floatText($('#float-enemy'), 'Время вышло!', 'miss');
    setStatus('Время вышло. Ход противника.');
    game.target = -1; game.ability = null; game.salvo = [];
    await endMyTurn();
  }

  /* =====================================================================
     Завершение и итоги
     ===================================================================== */
  async function finishGame(winner) {
    game.over = true;
    game.winner = winner;
    stopTimer();
    BS.gameStore.clear();
    renderBattle();
    if (game.kind === 'online') online.onFinished(winner);
    paintBoard(boardEnemyEl, enemyBoard(), { reveal: true });
    const iWon = game.kind === 'duel' ? true : winner === 0;
    if (iWon) sfx.win(); else sfx.lose();
    vibrate(iWon ? [40, 60, 40, 60, 120] : [200]);
    await sleep(1400);
    showResult();
  }

  function showResult() {
    const p0 = game.stats[0];
    const mine = game.boards[0];
    const theirs = game.boards[1];
    const hero = $('#result-hero');
    const events = $('#result-events');
    events.innerHTML = '';
    let summaryEvents = [];
    let xpGained = 0;
    let statsRows = [];
    const accuracy = (st) => (st.shots ? Math.round((st.hits / st.shots) * 100) : 0);

    if (game.kind === 'daily') {
      const res = progress.recordDaily(game.dateKey, p0.shots);
      summaryEvents = res.events;
      xpGained = res.xpGained;
      hero.className = 'result-hero win';
      $('#result-badge').textContent = '⭐'.repeat(res.stars);
      $('#result-title').textContent = res.stars === 3 ? 'Блестяще!' : res.stars === 2 ? 'Отлично!' : 'Вызов пройден';
      $('#result-sub').textContent = res.isNew ? `Вызов ${formatDateRu(game.dateKey)} · серия ${progress.get().daily.streak} дн.` : `Лучший результат дня: ${res.best} выстрелов`;
      statsRows = [['Выстрелов', p0.shots], ['Точность', accuracy(p0) + '%'], ['До 3 звёзд', p0.shots <= 44 ? '✓' : `ещё −${p0.shots - 44}`], ['Серия вызовов', progress.get().daily.streak]];
      $('#btn-share').classList.remove('hidden');
      $('#btn-again').textContent = 'Играть с ИИ';
    } else if (game.kind === 'online') {
      const won = game.winner === 0;
      const res = progress.recordGame({
        mode: 'online', difficulty: null, won,
        shots: p0.shots, hits: p0.hits, sunk: p0.sunk, lost: mine.ships.filter((s) => s.sunk).length,
        aliveAtEnd: mine.aliveShips().length, bestCombo: p0.bestCombo,
      });
      summaryEvents = res.events;
      xpGained = res.xpGained;
      hero.className = 'result-hero ' + (won ? 'win' : 'lose');
      $('#result-badge').textContent = won ? '🏆' : '💀';
      $('#result-title').textContent = won ? (game.reason === 'left' ? 'Соперник сдался' : 'Победа!') : 'Поражение';
      $('#result-sub').textContent = won ? `Ты обыграл(а) ${game.opp}` : `${game.opp} оказался сильнее. Реванш?`;
      statsRows = [['Выстрелов', p0.shots], ['Точность', accuracy(p0) + '%'], ['Потоплено', `${p0.sunk}/10`], ['Лучшее комбо', '×' + p0.bestCombo], ['Потеряно', `${mine.ships.filter((s) => s.sunk).length}/10`], ['Точность соперника', accuracy(game.stats[1]) + '%']];
      $('#btn-share').classList.add('hidden');
      $('#btn-again').textContent = BS.net.connected ? 'Реванш' : 'Новая комната';
      $('#btn-again').disabled = false;
    } else if (game.kind === 'duel') {
      const w = game.winner;
      const res = progress.recordGame({ mode: 'classic', difficulty: null, won: true, duel: true, shots: p0.shots + game.stats[1].shots, hits: p0.hits + game.stats[1].hits, sunk: p0.sunk + game.stats[1].sunk, lost: 0, bestCombo: Math.max(p0.bestCombo, game.stats[1].bestCombo) });
      summaryEvents = res.events;
      xpGained = res.xpGained;
      hero.className = 'result-hero win';
      $('#result-badge').textContent = '🏆';
      $('#result-title').textContent = `Победил Игрок ${w + 1}`;
      $('#result-sub').textContent = 'Реванш?';
      statsRows = [['Выстрелы И1', p0.shots], ['Точность И1', accuracy(p0) + '%'], ['Выстрелы И2', game.stats[1].shots], ['Точность И2', accuracy(game.stats[1]) + '%']];
      $('#btn-share').classList.add('hidden');
      $('#btn-again').textContent = 'Реванш';
    } else {
      const won = game.winner === 0;
      const res = progress.recordGame({
        mode: game.mode, difficulty: game.difficulty, won,
        shots: p0.shots, hits: p0.hits, sunk: p0.sunk, lost: mine.ships.filter((s) => s.sunk).length,
        aliveAtEnd: mine.aliveShips().length, bestCombo: p0.bestCombo,
      });
      summaryEvents = res.events;
      xpGained = res.xpGained;
      hero.className = 'result-hero ' + (won ? 'win' : 'lose');
      $('#result-badge').textContent = won ? '🏆' : '💀';
      $('#result-title').textContent = won ? pick(['Победа!', 'Флот разбит!', 'Чистая работа!']) : pick(['Поражение', 'Флот потоплен', 'Не в этот раз']);
      const streak = progress.get().stats.streak;
      $('#result-sub').textContent = won ? (streak >= 2 ? `Серия побед: ${streak} 🔥` : `${MODES[game.mode].name} · ${DIFFICULTY[game.difficulty].name}`) : `Осталось потопить: ${theirs.aliveShips().length}. Реванш?`;
      statsRows = [['Выстрелов', p0.shots], ['Точность', accuracy(p0) + '%'], ['Потоплено', `${p0.sunk}/10`], ['Лучшее комбо', '×' + p0.bestCombo], ['Потеряно', `${mine.ships.filter((s) => s.sunk).length}/10`], ['Точность ИИ', accuracy(game.stats[1]) + '%']];
      $('#btn-share').classList.add('hidden');
      $('#btn-again').textContent = won ? 'Ещё раз' : 'Реванш';
    }

    const grid = $('#result-stats');
    grid.innerHTML = '';
    statsRows.forEach(([k, v]) => grid.appendChild(el('div', { class: 'stat' }, [el('b', { class: 'mono', text: String(v) }), el('small', { text: k })])));

    for (const ev of summaryEvents) {
      let icon = '✨', title = '', sub = '';
      if (ev.type === 'achievement') { icon = ev.achievement.icon; title = 'Достижение: ' + ev.achievement.name; sub = `${ev.achievement.desc} · +${ev.achievement.xp} XP`; }
      else if (ev.type === 'mission') { icon = '✅'; title = 'Миссия выполнена'; sub = `${ev.mission.text} · +${ev.mission.xp} XP`; }
      else if (ev.type === 'level') { icon = '⬆️'; title = `Новый уровень: ${ev.level}`; sub = 'Так держать, капитан'; }
      else if (ev.type === 'rank') { icon = ev.rank.icon; title = 'Новое звание: ' + ev.rank.name; sub = 'Экипаж гордится'; }
      else if (ev.type === 'theme') { icon = '🎨'; title = 'Открыт стиль: ' + ev.theme.name; sub = 'Включи его в профиле'; }
      else continue;
      events.appendChild(el('div', { class: 'event' }, [el('span', { class: 'ev-icon', text: icon }), el('div', {}, [el('b', { text: title }), el('small', { class: 'muted', text: sub })])]));
    }
    if (summaryEvents.some((e) => e.type === 'achievement' || e.type === 'level')) setTimeout(() => sfx.unlock(), 600);

    // анимация опыта
    const p = progress.get();
    const after = progress.levelFromXp(p.xp);
    const before = progress.levelFromXp(p.xp - xpGained);
    $('#result-xp').textContent = `+${xpGained} XP`;
    const fill = $('#result-xp-fill');
    fill.style.transition = 'none';
    fill.style.width = (before.level === after.level ? Math.round((before.into / before.need) * 100) : 0) + '%';
    $('#result-level-text').textContent = `Уровень ${after.level} · ${after.into} / ${after.need} XP`;
    requestAnimationFrame(() => { fill.style.transition = ''; setTimeout(() => { fill.style.width = Math.round((after.into / after.need) * 100) + '%'; }, 250); });

    history.length = 0;
    showScreen('result', { push: false });
  }

  $('#btn-again').addEventListener('click', () => {
    sfx.tap();
    if (!game) return showScreen('home');
    if (game.kind === 'online') return online.rematch();
    if (game.kind === 'duel') return startDuelSetup();
    if (game.kind === 'daily') { renderModes(); return showScreen('modes'); }
    startPlacement({ kind: 'solo', mode: game.mode, difficulty: game.difficulty });
  });
  $('#btn-home').addEventListener('click', () => { sfx.tap(); history.length = 0; showScreen('home', { push: false }); });
  $('#btn-share').addEventListener('click', async () => {
    if (!game || game.kind !== 'daily') return;
    const rec = progress.get().daily.history[game.dateKey];
    const text = `Морской бой · Вызов дня ${formatDateRu(game.dateKey)}\n${'⭐'.repeat(rec.stars)}${'☆'.repeat(3 - rec.stars)} · ${rec.shots} выстрелов\n${shareGrid()}\n${location.href.split('#')[0]}`;
    try {
      if (navigator.share) await navigator.share({ text });
      else { await navigator.clipboard.writeText(text); toast('Результат скопирован', { icon: '📋', kind: 'good' }); }
    } catch (e) { /* отмена */ }
  });

  function shareGrid() {
    const b = game.boards[1];
    const rows = [];
    for (let r = 0; r < SIZE; r++) {
      let s = '';
      for (let c = 0; c < SIZE; c++) {
        const i = idx(r, c);
        s += b.shots[i] === SHOT.HIT ? '🟥' : b.shots[i] === SHOT.MISS ? '🟦' : '⬛';
      }
      rows.push(s);
    }
    return rows.join('\n');
  }

  /* =====================================================================
     Профиль
     ===================================================================== */
  function renderProfile() {
    const p = progress.get();
    const lv = progress.levelFromXp(p.xp);
    const rank = progress.rankFor(lv.level);
    const next = progress.nextRank(lv.level);
    $('#profile-name').textContent = p.name;
    $('#profile-rank-icon').textContent = rank.icon;
    $('#profile-rank').textContent = `${rank.name} · уровень ${lv.level}` + (next ? ` · ${next.name} с ${next.level} ур.` : '');
    $('#profile-xp-fill').style.width = Math.round((lv.into / lv.need) * 100) + '%';
    $('#profile-xp-text').textContent = `${lv.into} / ${lv.need} XP · всего ${p.xp}`;

    const s = p.stats;
    const rows = [
      ['Партий', s.games], ['Побед', s.wins], ['Винрейт', s.games ? Math.round((s.wins / s.games) * 100) + '%' : '—'],
      ['Точность', s.shots ? Math.round((s.hits / s.shots) * 100) + '%' : '—'], ['Потоплено', s.sunk], ['Серия побед', `${s.streak} / ${s.bestStreak}`],
      ['Лучшее комбо', '×' + s.bestCombo], ['Быстрая победа', s.fastestWin != null ? s.fastestWin + ' выстр.' : '—'], ['Дней подряд', `${p.loginStreak} / ${p.bestLoginStreak}`],
    ];
    const grid = $('#profile-stats');
    grid.innerHTML = '';
    rows.forEach(([k, v]) => grid.appendChild(el('div', { class: 'stat' }, [el('b', { class: 'mono', text: String(v) }), el('small', { text: k })])));

    const themes = $('#themes-list');
    themes.innerHTML = '';
    for (const t of progress.THEMES) {
      const locked = t.level > lv.level;
      const b = el('button', { class: 'theme-chip' + (p.theme === t.id ? ' on' : '') + (locked ? ' locked' : ''), 'data-theme-id': t.id }, [
        el('i', { class: 'swatch' }), el('span', { text: t.name }), locked ? el('small', { class: 'mono', text: `ур. ${t.level}` }) : null,
      ]);
      b.addEventListener('click', () => {
        if (locked) { toast(`Стиль «${t.name}» откроется на уровне ${t.level}`, { icon: '🔒' }); return; }
        progress.setTheme(t.id); applyTheme(); sfx.select(); renderProfile();
      });
      themes.appendChild(b);
    }

    const ach = $('#achievements-list');
    ach.innerHTML = '';
    let got = 0;
    for (const a of progress.ACHIEVEMENTS) {
      const has = !!p.achievements[a.id];
      if (has) got++;
      ach.appendChild(el('div', { class: 'ach' + (has ? ' got' : ''), title: a.desc }, [
        el('span', { class: 'ach-icon', text: has ? a.icon : '🔒' }), el('b', { text: a.name }), el('small', { text: a.desc }),
      ]));
    }
    $('#ach-count').textContent = `${got}/${progress.ACHIEVEMENTS.length}`;

    const dh = $('#daily-history');
    dh.innerHTML = '';
    const keys = Object.keys(p.daily.history).sort().reverse().slice(0, 14);
    if (!keys.length) dh.appendChild(el('p', { class: 'muted small', text: 'Ещё ни одного вызова. Сегодняшний ждёт на главном экране.' }));
    for (const k of keys) {
      const r = p.daily.history[k];
      dh.appendChild(el('div', { class: 'dh-row' }, [el('span', { class: 'mono', text: formatDateRu(k) }), el('span', { text: '⭐'.repeat(r.stars) }), el('b', { class: 'mono', text: r.shots + ' выстр.' })]));
    }
  }

  /* =====================================================================
     Настройки
     ===================================================================== */
  function renderSettings() {
    const s = settings.get();
    const list = $('#settings-list');
    list.innerHTML = '';
    const items = [
      ['sound', 'Звук', 'Выстрелы, попадания, фанфары'],
      ['vibration', 'Вибрация', 'Отклик на попадания и события'],
      ['autoMark', 'Автоотметка', 'Помечать клетки вокруг потопленного корабля'],
      ['quickFire', 'Огонь в одно касание', 'Стрелять сразу, без подтверждения'],
    ];
    for (const [key, name, desc] of items) {
      const row = el('label', { class: 'setting' }, [
        el('div', {}, [el('b', { text: name }), el('small', { class: 'muted', text: desc })]),
        el('span', { class: 'switch' + (s[key] ? ' on' : '') }),
      ]);
      row.addEventListener('click', () => { const v = !settings.get()[key]; settings.set({ [key]: v }); if (key === 'sound' && v) BS.audio.ensure(); sfx.tap(); renderSettings(); });
      list.appendChild(row);
    }
  }
  $('#btn-reset').addEventListener('click', async () => {
    const ok = await confirmDialog('Сбросить прогресс?', 'Опыт, достижения и статистика будут удалены. Это нельзя отменить.', 'Сбросить');
    if (ok) { progress.reset(); BS.gameStore.clear(); applyTheme(); toast('Прогресс сброшен'); showScreen('home', { push: false }); history.length = 0; }
  });


  /* =====================================================================
     Онлайн: комната по коду, игра с другом
     ===================================================================== */
  const net = BS.net;
  const online = (() => {
    let pendingShot = null;
    let phase = 'idle'; // idle | hosting | joining | lobby | placing | waiting | battle | result
    let myReady = false, theirReady = false, myBoardReady = null;
    let oppName = 'Соперник';
    let lastReact = 0;
    let rematchState = { me: false, them: false };

    const ui = {
      screen: $('#screen-online'),
      status: $('#online-status'),
      codeBox: $('#room-code-box'),
      code: $('#room-code'),
      joinCode: $('#join-code'),
    };

    function setStatusText(text, kind) {
      ui.status.textContent = text;
      ui.status.className = 'online-status ' + (kind || '');
    }

    function myName() { return progress.get().name; }

    function openScreen() {
      phase = 'idle';
      ui.codeBox.classList.add('hidden');
      $('#btn-host').classList.remove('hidden');
      setStatusText('Создай комнату и отправь другу код или ссылку. Или введи код друга.');
      showScreen('online');
    }

    async function host() {
      try {
        sfx.tap();
        phase = 'hosting';
        setStatusText('Создаём комнату…', 'busy');
        const code = await net.host();
        ui.code.textContent = code;
        ui.codeBox.classList.remove('hidden');
        $('#btn-host').classList.add('hidden');
        setStatusText('Комната готова. Ждём соперника…', 'busy');
        $('#room-link').value = net.roomLink(code);
      } catch (err) {
        phase = 'idle';
        setStatusText(net.explainError(err), 'bad');
      }
    }

    async function join(code) {
      const c = net.normalizeCode(code);
      if (c.length < 4) { setStatusText('Код слишком короткий', 'bad'); return; }
      try {
        sfx.tap();
        phase = 'joining';
        setStatusText(`Подключаемся к комнате ${c}…`, 'busy');
        await net.join(c);
      } catch (err) {
        phase = 'idle';
        setStatusText(net.explainError(err), 'bad');
      }
    }

    async function shareRoom() {
      const code = net.code;
      const link = net.roomLink(code);
      const text = `Сыграем в морской бой? Код комнаты: ${code}\n${link}`;
      try {
        if (navigator.share) await navigator.share({ text });
        else { await navigator.clipboard.writeText(text); toast('Приглашение скопировано', { icon: '📋', kind: 'good' }); }
      } catch (e) { /* отмена */ }
    }

    async function copyCode() {
      try { await navigator.clipboard.writeText(net.code); toast('Код скопирован', { icon: '📋', kind: 'good' }); } catch (e) { toast('Код: ' + net.code); }
    }

    /* Соединение установлено — обмениваемся именами и идём расставлять корабли */
    function onOpen() {
      phase = 'lobby';
      myReady = false; theirReady = false; myBoardReady = null;
      rematchState = { me: false, them: false };
      net.send('hello', { name: myName(), v: 1 });
      sfx.reward();
      vibrate([20, 30, 20]);
      setStatusText('Соперник подключился!', 'good');
      setTimeout(startPlacementPhase, 400);
    }

    function startPlacementPhase() {
      phase = 'placing';
      closeModal();
      startPlacement({
        kind: 'online', title: `Онлайн · против ${oppName}`, hint: 'Расставь флот. Соперник не видит твоё поле.',
        onDone(board) {
          myBoardReady = board;
          myReady = true;
          net.send('ready', {});
          phase = 'waiting';
          showWaiting();
          tryStart();
        },
      });
    }

    function showWaiting() {
      const cancel = el('button', { class: 'btn ghost', text: 'Покинуть комнату', onclick: () => { leave(); closeModal(); showScreen('home', { push: false }); history.length = 0; } });
      modal(el('div', { class: 'waiting' }, [
        el('div', { class: 'spinner' }),
        el('h3', { text: theirReady ? 'Начинаем…' : 'Ждём соперника' }),
        el('p', { class: 'muted', text: theirReady ? 'Соперник готов' : `${oppName} ещё расставляет корабли` }),
        el('div', { class: 'modal-actions' }, [cancel]),
      ]), { closable: false });
    }

    /* Хост решает, кто ходит первым */
    function tryStart() {
      if (net.role !== 'host' || !myReady || !theirReady) return;
      const hostFirst = Math.random() < 0.5;
      net.send('start', { first: hostFirst ? 'host' : 'guest' });
      beginBattle(hostFirst ? 0 : 1);
    }

    function beginBattle(turn) {
      closeModal();
      phase = 'battle';
      const view = new Board();
      view.virtualFleet = true;
      game = {
        kind: 'online', mode: 'classic', difficulty: null, room: net.code, opp: oppName,
        boards: [myBoardReady, view], turn, ai: null,
        charges: [newCharges(), newCharges()], stats: [newStats(), newStats()],
        combo: 0, over: false, winner: null, target: -1, ability: null, salvo: [], viewOwn: false,
      };
      enterBattle();
    }

    /* ---- выстрелы ---- */
    function remoteShot(i) {
      return new Promise((resolve) => {
        pendingShot = { i, resolve };
        if (!net.send('shot', { i })) { pendingShot = null; resolve(null); return; }
        setTimeout(() => { if (pendingShot && pendingShot.i === i) { pendingShot = null; resolve(null); } }, 20000);
      });
    }

    function sendResult(board, res) {
      const payload = { i: res.cell, result: res.result, gameOver: board.allSunk() };
      if (res.result === 'sunk') {
        payload.ship = { len: res.ship.len, cells: res.ship.cells, r: res.ship.r, c: res.ship.c, horiz: res.ship.horiz };
        payload.around = res.around;
      }
      net.send('result', payload);
    }

    function applyResultToView(view, res) {
      const i = res.i;
      if (res.result === 'miss') { view.shots[i] = SHOT.MISS; res.cell = i; return; }
      view.shots[i] = SHOT.HIT;
      res.cell = i;
      if (res.result === 'sunk' && res.ship) {
        const s = res.ship;
        const ship = { id: view.nextId++, len: s.len, cells: s.cells.slice(), hits: s.len, sunk: true, r: s.r, c: s.c, horiz: s.horiz };
        ship.cells.forEach((c) => { view.grid[c] = ship.id; view.shots[c] = SHOT.HIT; });
        view.ships.push(ship);
        res.ship = ship;
        res.around = res.around || [];
      }
    }

    async function onRemoteShot(p) {
      if (!game || game.kind !== 'online' || game.over) return;
      if (game.turn !== 1) return; // не его ход — игнорируем
      busy = true;
      const res = await applyShot(1, p.i);
      if (!game || game.over) { busy = false; return; }
      if (res.result === 'miss' || res.result === 'repeat') {
        game.turn = 0;
        game.combo = 0;
        busy = false;
        setStatus('Твой ход. Выбери клетку.');
        vibrate(15);
      } else {
        busy = false;
        setStatus(res.result === 'sunk' ? `${game.opp} потопил твой корабль и стреляет снова` : `${game.opp} попал и стреляет снова`);
      }
      renderBattle();
    }

    function onFinished(winner) {
      phase = 'result';
      // раскрываем свой флот сопернику
      const mine = game.boards[0];
      net.send('reveal', { ships: mine.ships.map((s) => ({ len: s.len, cells: s.cells, r: s.r, c: s.c, horiz: s.horiz, sunk: s.sunk })) });
    }

    function onReveal(p) {
      if (!game || game.kind !== 'online') return;
      const view = game.boards[1];
      for (const s of p.ships || []) {
        if (view.grid[s.cells[0]] !== -1) continue;
        const ship = { id: view.nextId++, len: s.len, cells: s.cells.slice(), hits: s.sunk ? s.len : 0, sunk: !!s.sunk, r: s.r, c: s.c, horiz: s.horiz };
        ship.cells.forEach((c) => (view.grid[c] = ship.id));
        view.ships.push(ship);
      }
      paintBoard(boardEnemyEl, view, { reveal: true });
    }

    /* ---- реакции ---- */
    function react(emoji) {
      const now = Date.now();
      if (now - lastReact < 1200) return;
      lastReact = now;
      net.send('react', { e: emoji });
      floatText($('#float-enemy'), emoji, 'emoji');
      sfx.tap();
    }
    function onReact(p) {
      if (!p || typeof p.e !== 'string' || p.e.length > 4) return;
      floatText($('#float-own'), p.e, 'emoji');
      sfx.select();
      vibrate(10);
    }

    /* ---- реванш ---- */
    function rematch() {
      if (!net.connected) {
        openScreen();
        return;
      }
      rematchState.me = true;
      net.send('rematch', {});
      $('#btn-again').textContent = 'Ждём соперника…';
      $('#btn-again').disabled = true;
      checkRematch();
    }
    function checkRematch() {
      if (rematchState.me && rematchState.them) {
        rematchState = { me: false, them: false };
        myReady = false; theirReady = false; myBoardReady = null;
        toast('Реванш! Расставляй флот.', { icon: '⚔️', kind: 'good' });
        startPlacementPhase();
      }
    }

    function leave() {
      net.send('leave', {});
      net.close();
      phase = 'idle';
      closeModal();
    }

    function onPeerGone(reason) {
      const wasBattle = game && game.kind === 'online' && !game.over;
      if (wasBattle) {
        game.reason = 'left';
        toast(reason === 'left' ? `${oppName} покинул(а) партию` : 'Связь с соперником потеряна', { icon: '🔌', kind: 'bad', ms: 3500 });
        finishGame(0);
        return;
      }
      if (current === 'result' && game && game.kind === 'online') {
        $('#btn-again').textContent = 'Новая комната';
        $('#btn-again').disabled = false;
        toast(`${oppName} вышел(ла) из комнаты`, { icon: '🔌' });
        return;
      }
      if (phase === 'placing' || phase === 'waiting' || phase === 'lobby') {
        closeModal();
        net.close();
        phase = 'idle';
        openScreen();
        setStatusText(reason === 'left' ? 'Соперник покинул комнату.' : 'Связь с соперником потеряна.', 'bad');
      }
    }

    /* ---- события сети ---- */
    net.on('_open', onOpen);
    net.on('_close', () => onPeerGone('closed'));
    net.on('_error', (err) => { if (phase === 'hosting' || phase === 'joining') setStatusText(net.explainError(err), 'bad'); });
    net.on('hello', (p) => { oppName = String((p && p.name) || 'Соперник').slice(0, 16); if (game && game.kind === 'online') { game.opp = oppName; $('#fleet-enemy small').textContent = oppName; } if (current === 'place') $('#place-title').textContent = `Онлайн · против ${oppName}`; });
    net.on('ready', () => { theirReady = true; if (phase === 'waiting') showWaiting(); tryStart(); });
    net.on('start', (p) => { if (net.role === 'guest' && myBoardReady) beginBattle(p.first === 'guest' ? 0 : 1); });
    net.on('shot', onRemoteShot);
    net.on('result', (p) => { if (pendingShot && pendingShot.i === p.i) { const r = pendingShot; pendingShot = null; r.resolve(p); } });
    net.on('reveal', onReveal);
    net.on('react', onReact);
    net.on('rematch', () => { rematchState.them = true; if (current === 'result') toast(`${oppName} хочет реванш!`, { icon: '⚔️' }); checkRematch(); });
    net.on('leave', () => onPeerGone('left'));

    /* ---- кнопки экрана ---- */
    $('#btn-host').addEventListener('click', host);
    $('#btn-join').addEventListener('click', () => join(ui.joinCode.value));
    ui.joinCode.addEventListener('keydown', (e) => { if (e.key === 'Enter') join(ui.joinCode.value); });
    ui.joinCode.addEventListener('input', () => { ui.joinCode.value = net.normalizeCode(ui.joinCode.value); });
    $('#btn-share-room').addEventListener('click', shareRoom);
    $('#btn-copy-code').addEventListener('click', copyCode);
    $('#btn-cancel-room').addEventListener('click', () => { net.close(); openScreen(); });
    $('#screen-online [data-back]').addEventListener('click', () => { if (phase !== 'battle') net.close(); });
    $$('#reactions button').forEach((b) => b.addEventListener('click', () => react(b.dataset.e)));

    return { openScreen, host, join, leave, remoteShot, sendResult, applyResultToView, onFinished, rematch };
  })();

  /* =====================================================================
     Старт
     ===================================================================== */
  function init() {
    applyTheme();
    const events = progress.touchLogin();
    renderHome();
    const p = progress.get();
    if (p.stats.games === 0 && !localStorage.getItem('bs_seen_howto')) {
      localStorage.setItem('bs_seen_howto', '1');
      setTimeout(() => toast('Добро пожаловать на борт! Правила — внизу экрана.', { icon: '⚓', ms: 3500 }), 600);
    }
    for (const ev of events) {
      if (ev.type === 'login' && ev.streak > 1) setTimeout(() => toast(`${ev.streak}-й день подряд. Бонус ждёт!`, { icon: '🔥', kind: 'good' }), 900);
      if (ev.type === 'achievement') setTimeout(() => toast('Достижение: ' + ev.achievement.name, { icon: ev.achievement.icon, kind: 'good' }), 1500);
    }
    if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
      navigator.serviceWorker.register('sw.js').catch(() => {});
    }
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') closeModal();
      if ((e.key === 'Enter' || e.key === ' ') && current === 'battle' && !$('#btn-fire').disabled) { e.preventDefault(); $('#btn-fire').click(); }
    });
    window.addEventListener('beforeunload', () => { if (game && !game.over) saveGame(); });
    const roomParam = new URLSearchParams(location.search).get('room');
    if (roomParam) {
      history.length = 0;
      showScreen('online');
      $('#join-code').value = BS.net.normalizeCode(roomParam);
      setTimeout(() => online.join(roomParam), 300);
    }
  }

  init();

  // для отладки и тестов
  global.BS.app = { get game() { return game; }, showScreen, startSoloGame, startDaily, startPlacement, renderHome };
})(window);
