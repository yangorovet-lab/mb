/* Сеть: WebSocket-клиент игрового сервера. Автопереподключение, идентификация игрока, события по типу сообщения. */
(function (global) {
  'use strict';

  const ID_KEY = 'bs_identity_v1';
  const handlers = {};
  let ws = null;
  let connected = false;
  let identified = false;
  let wanted = false; // хотим ли держать соединение
  let attempts = 0;
  let reconnectTimer = null;
  let pingTimer = null;
  let identity = null;
  let serverInfo = {};
  let lastError = null;

  try { identity = JSON.parse(localStorage.getItem(ID_KEY) || 'null'); } catch (e) { identity = null; }

  function emit(type, payload) {
    (handlers[type] || []).forEach((fn) => { try { fn(payload); } catch (e) { console.error(e); } });
  }

  function serverUrl() {
    const cfg = (global.BS_CONFIG && global.BS_CONFIG.server) || '';
    if (cfg) {
      const u = cfg.replace(/\/+$/, '');
      if (/^wss?:\/\//.test(u)) return u.endsWith('/ws') ? u : u + '/ws';
      return u.replace(/^http/, 'ws') + '/ws';
    }
    if (!location.protocol.startsWith('http')) return null;
    return (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws';
  }

  function httpBase() {
    const u = serverUrl();
    if (!u) return null;
    return u.replace(/^ws/, 'http').replace(/\/ws$/, '');
  }

  function playerName() {
    try { return (global.BS.progress && global.BS.progress.get().name) || 'Капитан'; } catch (e) { return 'Капитан'; }
  }

  function connect() {
    wanted = true;
    if (ws && (ws.readyState === 0 || ws.readyState === 1)) return;
    const url = serverUrl();
    if (!url) { lastError = 'no_server'; emit('_unavailable'); return; }
    try { ws = new WebSocket(url); } catch (e) { lastError = 'bad_url'; scheduleReconnect(); return; }
    ws.onopen = () => {
      connected = true;
      attempts = 0;
      lastError = null;
      ws.send(JSON.stringify({ t: 'hello', pid: identity && identity.pid, token: identity && identity.token, name: playerName() }));
      if (pingTimer) clearInterval(pingTimer);
      pingTimer = setInterval(() => { if (ws && ws.readyState === 1) ws.send(JSON.stringify({ t: 'ping', ts: Date.now() })); }, 25000);
    };
    ws.onmessage = (e) => {
      let msg;
      try { msg = JSON.parse(e.data); } catch (err) { return; }
      if (!msg || typeof msg.t !== 'string') return;
      if (msg.t === 'welcome') {
        identity = { pid: msg.pid, token: msg.token };
        try { localStorage.setItem(ID_KEY, JSON.stringify(identity)); } catch (err) { /* ignore */ }
        serverInfo = { turnMs: msg.turnMs };
        identified = true;
        emit('_connected', msg);
        return;
      }
      emit(msg.t, msg);
    };
    ws.onclose = () => {
      const was = connected;
      connected = false;
      identified = false;
      if (pingTimer) { clearInterval(pingTimer); pingTimer = null; }
      if (was) emit('_disconnected');
      if (wanted) scheduleReconnect();
    };
    ws.onerror = () => { lastError = 'socket'; };
  }

  function scheduleReconnect() {
    if (reconnectTimer || !wanted) return;
    attempts++;
    const delay = Math.min(15000, 500 * Math.pow(2, Math.min(attempts, 5))) + Math.random() * 300;
    reconnectTimer = setTimeout(() => { reconnectTimer = null; if (wanted) connect(); }, delay);
    if (attempts === 3) emit('_unavailable');
  }

  function disconnect() {
    wanted = false;
    if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
    if (ws) { try { ws.close(); } catch (e) { /* ignore */ } }
    ws = null;
  }

  /* Дождаться идентификации (с таймаутом) */
  function ready(timeoutMs) {
    if (identified) return Promise.resolve(true);
    connect();
    return new Promise((resolve) => {
      const t = setTimeout(() => { off('_connected', h); resolve(false); }, timeoutMs || 8000);
      const h = () => { clearTimeout(t); off('_connected', h); resolve(true); };
      on('_connected', h);
    });
  }

  function on(type, fn) { (handlers[type] = handlers[type] || []).push(fn); return () => off(type, fn); }
  function off(type, fn) { handlers[type] = (handlers[type] || []).filter((f) => f !== fn); }

  function send(t, payload) {
    if (!ws || ws.readyState !== 1) return false;
    ws.send(JSON.stringify({ t, ...(payload || {}) }));
    return true;
  }

  /* Отправить и дождаться первого ответа одного из типов */
  function request(t, payload, replyTypes, timeoutMs) {
    const types = Array.isArray(replyTypes) ? replyTypes : [replyTypes];
    return new Promise((resolve, reject) => {
      const offs = [];
      const done = (fn) => { offs.forEach((f) => f()); clearTimeout(timer); fn(); };
      const timer = setTimeout(() => done(() => reject(new Error('timeout'))), timeoutMs || 10000);
      for (const rt of types) offs.push(on(rt, (msg) => done(() => resolve(msg))));
      offs.push(on('error', (msg) => done(() => reject(Object.assign(new Error(msg.code), { code: msg.code })))));
      if (!send(t, payload)) done(() => reject(new Error('offline')));
    });
  }

  function normalizeCode(code) {
    return String(code || '').toUpperCase().replace(/[^A-Z0-9]/g, '').replace(/0/g, 'O').replace(/1/g, 'I').slice(0, 8);
  }

  function roomLink(code) {
    const url = new URL(location.href);
    url.search = '';
    url.hash = '';
    url.searchParams.set('room', code);
    return url.toString();
  }

  const ERRORS = {
    not_found: 'Комната не найдена. Проверь код или попроси друга создать комнату заново.',
    room_full: 'В этой комнате уже двое.',
    room_busy: 'В этой комнате уже идёт игра.',
    offline: 'Нет связи с сервером. Проверь интернет.',
    timeout: 'Сервер не отвечает. Попробуй ещё раз.',
    no_server: 'Онлайн-сервер не настроен для этой копии игры.',
    bad_fleet: 'Сервер отклонил расстановку. Попробуй заново.',
    not_your_turn: 'Сейчас не твой ход.',
    repeat: 'Сюда уже стреляли.',
  };
  function explainError(err) {
    const code = (err && err.code) || (err && err.message) || String(err);
    return ERRORS[code] || ('Ошибка: ' + code);
  }

  global.BS = global.BS || {};
  global.BS.net = {
    connect, disconnect, ready, on, off, send, request, normalizeCode, roomLink, explainError, httpBase,
    get connected() { return connected && identified; },
    get available() { return !!serverUrl(); },
    get identity() { return identity; },
    get pid() { return identity && identity.pid; },
    get info() { return serverInfo; },
    get lastError() { return lastError; },
  };
})(window);
