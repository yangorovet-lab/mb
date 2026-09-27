/* Прогресс игрока: опыт, ранги, серии, ежедневные миссии, достижения, настройки */
(function (global) {
  'use strict';

  const { todayKey, pick, seededRng, hashString } = global.BS;

  const KEY = 'bs_profile_v1';
  const SETTINGS_KEY = 'bs_settings_v1';
  const GAME_KEY = 'bs_game_v1';

  const RANKS = [
    { level: 1, name: 'Юнга', icon: '🪢' },
    { level: 3, name: 'Матрос', icon: '⚓' },
    { level: 5, name: 'Старшина', icon: '🧭' },
    { level: 8, name: 'Мичман', icon: '🔱' },
    { level: 12, name: 'Лейтенант', icon: '🎖️' },
    { level: 16, name: 'Капитан', icon: '🛳️' },
    { level: 20, name: 'Командор', icon: '🚢' },
    { level: 25, name: 'Адмирал', icon: '👑' },
  ];

  const THEMES = [
    { id: 'cyan', name: 'Неон', level: 1 },
    { id: 'aurora', name: 'Аврора', level: 4 },
    { id: 'coral', name: 'Коралл', level: 8 },
    { id: 'radar', name: 'Радар', level: 12 },
    { id: 'gold', name: 'Золото', level: 20 },
  ];

  const ACHIEVEMENTS = [
    { id: 'first_win', name: 'Первая кровь', desc: 'Выиграть первую партию', icon: '🏁', xp: 50 },
    { id: 'wins_10', name: 'Ветеран', desc: 'Выиграть 10 партий', icon: '🎗️', xp: 150 },
    { id: 'wins_50', name: 'Гроза морей', desc: 'Выиграть 50 партий', icon: '🌊', xp: 500 },
    { id: 'perfect', name: 'Без единой царапины', desc: 'Победить, не потеряв ни одного корабля', icon: '🛡️', xp: 200 },
    { id: 'sniper', name: 'Снайпер', desc: 'Победить с точностью выше 60%', icon: '🎯', xp: 150 },
    { id: 'streak_3', name: 'Серия ×3', desc: 'Три победы подряд', icon: '🔥', xp: 100 },
    { id: 'streak_10', name: 'Непобедимый', desc: 'Десять побед подряд', icon: '☄️', xp: 400 },
    { id: 'beat_hard', name: 'Свергнуть адмирала', desc: 'Победить на уровне «Адмирал»', icon: '👑', xp: 250 },
    { id: 'combo_4', name: 'Комбо ×4', desc: 'Четыре попадания подряд за один ход', icon: '⚡', xp: 100 },
    { id: 'blitz_win', name: 'Реакция', desc: 'Победить в режиме «Блиц»', icon: '⏱️', xp: 100 },
    { id: 'arsenal_win', name: 'Оружейник', desc: 'Победить в режиме «Арсенал»', icon: '💣', xp: 100 },
    { id: 'salvo_win', name: 'Батарея, огонь!', desc: 'Победить в режиме «Залп»', icon: '💥', xp: 100 },
    { id: 'daily_1', name: 'Дежурный', desc: 'Пройти ежедневный вызов', icon: '📅', xp: 80 },
    { id: 'daily_3stars', name: 'Три звезды', desc: 'Пройти ежедневный вызов на три звезды', icon: '⭐', xp: 200 },
    { id: 'login_7', name: 'Неделя на вахте', desc: 'Заходить в игру 7 дней подряд', icon: '🗓️', xp: 300 },
    { id: 'comeback', name: 'Камбэк', desc: 'Победить, когда у тебя оставался один корабль', icon: '🫀', xp: 200 },
    { id: 'duel_10', name: 'Дуэлянт', desc: 'Сыграть 10 дуэлей на одном устройстве', icon: '🤝', xp: 150 },
    { id: 'online_win', name: 'Морской волк', desc: 'Выиграть онлайн-партию у друга', icon: '🌐', xp: 200 },
    { id: 'online_10', name: 'Флотоводец', desc: 'Сыграть 10 онлайн-партий', icon: '🛰️', xp: 300 },
    { id: 'ships_100', name: 'Сотня на дне', desc: 'Потопить 100 кораблей', icon: '🪦', xp: 300 },
  ];

  const MISSION_POOL = [
    { id: 'win1', text: 'Выиграть 1 партию', goal: 1, stat: 'wins', xp: 60 },
    { id: 'win2', text: 'Выиграть 2 партии', goal: 2, stat: 'wins', xp: 120 },
    { id: 'sink8', text: 'Потопить 8 кораблей', goal: 8, stat: 'sunk', xp: 60 },
    { id: 'sink15', text: 'Потопить 15 кораблей', goal: 15, stat: 'sunk', xp: 110 },
    { id: 'hits20', text: 'Попасть 20 раз', goal: 20, stat: 'hits', xp: 60 },
    { id: 'hits40', text: 'Попасть 40 раз', goal: 40, stat: 'hits', xp: 110 },
    { id: 'hardwin', text: 'Победить «Адмирала»', goal: 1, stat: 'hardWins', xp: 150 },
    { id: 'blitz', text: 'Сыграть партию в «Блиц»', goal: 1, stat: 'blitzGames', xp: 70 },
    { id: 'arsenal', text: 'Сыграть партию в «Арсенал»', goal: 1, stat: 'arsenalGames', xp: 70 },
    { id: 'salvo', text: 'Сыграть партию в «Залп»', goal: 1, stat: 'salvoGames', xp: 70 },
    { id: 'combo3', text: 'Сделать комбо ×3', goal: 1, stat: 'combo3', xp: 80 },
    { id: 'daily', text: 'Пройти ежедневный вызов', goal: 1, stat: 'dailyDone', xp: 90 },
    { id: 'accuracy', text: 'Победить с точностью 50%+', goal: 1, stat: 'accurateWins', xp: 100 },
    { id: 'games3', text: 'Сыграть 3 партии', goal: 3, stat: 'games', xp: 80 },
    { id: 'online', text: 'Сыграть онлайн с другом', goal: 1, stat: 'onlineGames', xp: 120 },
  ];

  function xpForLevel(level) {
    // опыт, необходимый для перехода с level на level+1
    return Math.round(150 + (level - 1) * 90 + Math.pow(level - 1, 1.6) * 20);
  }

  function levelFromXp(xp) {
    let level = 1;
    let rest = xp;
    while (rest >= xpForLevel(level) && level < 99) {
      rest -= xpForLevel(level);
      level++;
    }
    return { level, into: rest, need: xpForLevel(level) };
  }

  function rankFor(level) {
    let r = RANKS[0];
    for (const x of RANKS) if (level >= x.level) r = x;
    return r;
  }

  function nextRank(level) {
    return RANKS.find((x) => x.level > level) || null;
  }

  function defaultProfile() {
    return {
      xp: 0,
      created: todayKey(),
      lastSeen: null,
      loginStreak: 0,
      bestLoginStreak: 0,
      claimedDaily: null,
      stats: {
        games: 0, wins: 0, losses: 0, shots: 0, hits: 0, sunk: 0, lost: 0,
        streak: 0, bestStreak: 0, hardWins: 0, duels: 0, bestCombo: 0,
        fastestWin: null, byMode: {},
      },
      achievements: {},
      missions: { date: null, list: [] },
      daily: { history: {}, streak: 0, lastDate: null },
      theme: 'cyan',
      name: 'Капитан',
    };
  }

  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return defaultProfile();
      const p = JSON.parse(raw);
      const d = defaultProfile();
      return { ...d, ...p, stats: { ...d.stats, ...(p.stats || {}) }, daily: { ...d.daily, ...(p.daily || {}) } };
    } catch (e) {
      return defaultProfile();
    }
  }

  let profile = load();
  const listeners = new Set();

  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(profile)); } catch (e) { /* ignore */ }
    listeners.forEach((fn) => fn(profile));
  }

  function onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }

  /* ---------- Ежедневный вход ---------- */
  function touchLogin() {
    const today = todayKey();
    const events = [];
    if (profile.lastSeen !== today) {
      const y = new Date(); y.setDate(y.getDate() - 1);
      const yesterday = todayKey(y);
      profile.loginStreak = profile.lastSeen === yesterday ? profile.loginStreak + 1 : 1;
      profile.bestLoginStreak = Math.max(profile.bestLoginStreak, profile.loginStreak);
      profile.lastSeen = today;
      events.push({ type: 'login', streak: profile.loginStreak });
      if (profile.loginStreak >= 7) unlock('login_7', events);
    }
    ensureMissions();
    save();
    return events;
  }

  function dailyBonusAvailable() {
    return profile.claimedDaily !== todayKey();
  }

  function dailyBonusAmount() {
    return 30 + Math.min(profile.loginStreak, 7) * 15;
  }

  function claimDailyBonus() {
    if (!dailyBonusAvailable()) return 0;
    const amount = dailyBonusAmount();
    profile.claimedDaily = todayKey();
    addXp(amount);
    save();
    return amount;
  }

  /* ---------- Миссии ---------- */
  function ensureMissions() {
    const today = todayKey();
    if (profile.missions.date === today && profile.missions.list.length) return;
    const rng = seededRng(hashString('missions:' + today));
    const pool = MISSION_POOL.slice();
    const list = [];
    while (list.length < 3 && pool.length) {
      const k = Math.floor(rng() * pool.length);
      const m = pool.splice(k, 1)[0];
      list.push({ id: m.id, progress: 0, done: false, claimed: false });
    }
    profile.missions = { date: today, list };
  }

  function missionDef(id) { return MISSION_POOL.find((m) => m.id === id); }

  function bumpMission(stat, amount, events) {
    ensureMissions();
    for (const m of profile.missions.list) {
      const def = missionDef(m.id);
      if (!def || def.stat !== stat || m.done) continue;
      m.progress = Math.min(def.goal, m.progress + amount);
      if (m.progress >= def.goal) {
        m.done = true;
        m.claimed = true;
        addXp(def.xp);
        if (events) events.push({ type: 'mission', mission: def });
      }
    }
  }

  /* ---------- Опыт и достижения ---------- */
  function addXp(amount, events) {
    const before = levelFromXp(profile.xp).level;
    profile.xp += Math.max(0, Math.round(amount));
    const after = levelFromXp(profile.xp).level;
    if (after > before && events) {
      events.push({ type: 'level', level: after });
      const unlockedTheme = THEMES.find((t) => t.level > before && t.level <= after);
      if (unlockedTheme) events.push({ type: 'theme', theme: unlockedTheme });
      const rBefore = rankFor(before), rAfter = rankFor(after);
      if (rBefore !== rAfter) events.push({ type: 'rank', rank: rAfter });
    }
    return after - before;
  }

  function unlock(id, events) {
    if (profile.achievements[id]) return false;
    const def = ACHIEVEMENTS.find((a) => a.id === id);
    if (!def) return false;
    profile.achievements[id] = todayKey();
    profile.xp += def.xp;
    if (events) events.push({ type: 'achievement', achievement: def });
    return true;
  }

  /* ---------- Итоги партии ---------- */
  /*
    summary: { mode, difficulty, won, shots, hits, sunk, lost, aliveAtEnd, bestCombo, turns, duel }
  */
  function recordGame(summary) {
    const events = [];
    const s = profile.stats;
    const xpBefore = profile.xp;
    s.games++;
    s.shots += summary.shots;
    s.hits += summary.hits;
    s.sunk += summary.sunk;
    s.lost += summary.lost;
    s.bestCombo = Math.max(s.bestCombo, summary.bestCombo || 0);
    s.byMode[summary.mode] = (s.byMode[summary.mode] || 0) + 1;
    bumpMission('games', 1, events);
    bumpMission('hits', summary.hits, events);
    bumpMission('sunk', summary.sunk, events);
    if (summary.mode === 'blitz') bumpMission('blitzGames', 1, events);
    if (summary.mode === 'arsenal') bumpMission('arsenalGames', 1, events);
    if (summary.mode === 'salvo') bumpMission('salvoGames', 1, events);
    if (summary.mode === 'online') {
      s.onlineGames = (s.onlineGames || 0) + 1;
      bumpMission('onlineGames', 1, events);
      if (s.onlineGames >= 10) unlock('online_10', events);
    }
    if ((summary.bestCombo || 0) >= 3) bumpMission('combo3', 1, events);
    if ((summary.bestCombo || 0) >= 4) unlock('combo_4', events);

    const accuracy = summary.shots ? summary.hits / summary.shots : 0;
    let xp = 0;
    const modeMult = (global.BS.MODES[summary.mode] || { xp: 1 }).xp;
    const diffMult = summary.duel ? 1 : (global.BS.DIFFICULTY[summary.difficulty] || { xp: 1 }).xp;

    if (summary.duel) {
      s.duels++;
      if (s.duels >= 10) unlock('duel_10', events);
      xp = 40 + summary.hits * 2;
    } else if (summary.won) {
      s.wins++;
      s.streak++;
      s.bestStreak = Math.max(s.bestStreak, s.streak);
      if (summary.difficulty === 'hard') { s.hardWins++; bumpMission('hardWins', 1, events); }
      bumpMission('wins', 1, events);
      if (accuracy >= 0.5) bumpMission('accurateWins', 1, events);
      if (summary.shots && (s.fastestWin == null || summary.shots < s.fastestWin)) s.fastestWin = summary.shots;
      xp = (120 + summary.hits * 3 + summary.sunk * 8 + Math.round(accuracy * 100)) * modeMult * diffMult;
      unlock('first_win', events);
      if (s.wins >= 10) unlock('wins_10', events);
      if (s.wins >= 50) unlock('wins_50', events);
      if (summary.lost === 0) unlock('perfect', events);
      if (accuracy > 0.6) unlock('sniper', events);
      if (s.streak >= 3) unlock('streak_3', events);
      if (s.streak >= 10) unlock('streak_10', events);
      if (summary.difficulty === 'hard') unlock('beat_hard', events);
      if (summary.mode === 'blitz') unlock('blitz_win', events);
      if (summary.mode === 'arsenal') unlock('arsenal_win', events);
      if (summary.mode === 'salvo') unlock('salvo_win', events);
      if (summary.mode === 'online') unlock('online_win', events);
      if (summary.aliveAtEnd === 1) unlock('comeback', events);
    } else {
      s.losses++;
      s.streak = 0;
      xp = (30 + summary.hits * 2 + summary.sunk * 5) * modeMult;
    }
    if (s.sunk >= 100) unlock('ships_100', events);
    addXp(xp, events);
    save();
    return { events, xpGained: profile.xp - xpBefore, streak: s.streak };
  }

  /* ---------- Ежедневный вызов ---------- */
  function dailyStars(shots) {
    if (shots <= 44) return 3;
    if (shots <= 54) return 2;
    return 1;
  }

  function recordDaily(dateKey, shots) {
    const events = [];
    const xpBefore = profile.xp;
    const stars = dailyStars(shots);
    const prev = profile.daily.history[dateKey];
    const isNew = !prev;
    if (!prev || shots < prev.shots) profile.daily.history[dateKey] = { shots, stars };
    if (isNew) {
      const y = new Date(dateKey + 'T12:00:00'); y.setDate(y.getDate() - 1);
      profile.daily.streak = profile.daily.lastDate === todayKey(y) ? profile.daily.streak + 1 : 1;
      profile.daily.lastDate = dateKey;
      bumpMission('dailyDone', 1, events);
      unlock('daily_1', events);
      addXp(80 + stars * 40, events);
    }
    if (stars === 3) unlock('daily_3stars', events);
    profile.stats.shots += shots;
    profile.stats.hits += 20;
    profile.stats.sunk += 10;
    bumpMission('hits', 20, events);
    bumpMission('sunk', 10, events);
    save();
    return { events, xpGained: profile.xp - xpBefore, stars, isNew, best: profile.daily.history[dateKey].shots };
  }

  function setTheme(id) {
    const lvl = levelFromXp(profile.xp).level;
    const t = THEMES.find((x) => x.id === id);
    if (!t || t.level > lvl) return false;
    profile.theme = id;
    save();
    return true;
  }

  function setName(name) {
    profile.name = (name || '').trim().slice(0, 16) || 'Капитан';
    save();
  }

  function reset() {
    profile = defaultProfile();
    save();
  }

  /* ---------- Настройки ---------- */
  const defaultSettings = { sound: true, vibration: true, autoMark: true, quickFire: false };
  let settings = { ...defaultSettings };
  try { settings = { ...defaultSettings, ...(JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}')) }; } catch (e) { /* ignore */ }

  const settingsApi = {
    get: () => settings,
    set(patch) {
      settings = { ...settings, ...patch };
      try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch (e) { /* ignore */ }
      return settings;
    },
  };

  /* ---------- Сохранение текущей партии ---------- */
  const gameStore = {
    save(state) { try { localStorage.setItem(GAME_KEY, JSON.stringify(state)); } catch (e) { /* ignore */ } },
    load() { try { return JSON.parse(localStorage.getItem(GAME_KEY) || 'null'); } catch (e) { return null; } },
    clear() { try { localStorage.removeItem(GAME_KEY); } catch (e) { /* ignore */ } },
  };

  global.BS.progress = {
    get: () => profile,
    save, onChange, touchLogin, dailyBonusAvailable, dailyBonusAmount, claimDailyBonus,
    ensureMissions, missionDef, recordGame, recordDaily, dailyStars, setTheme, setName, reset,
    levelFromXp, xpForLevel, rankFor, nextRank, RANKS, THEMES, ACHIEVEMENTS, MISSION_POOL,
  };
  global.BS.settings = settingsApi;
  global.BS.gameStore = gameStore;
})(window);
