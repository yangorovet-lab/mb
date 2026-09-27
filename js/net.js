/* Сеть: комнаты по коду. Транспорт — WebRTC через PeerJS (без своего сервера)
   или BroadcastChannel для двух вкладок на одном устройстве (?transport=local). */
(function (global) {
  'use strict';

  const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const PREFIX = 'morskoy-boy-v1-';
  const ICE = {
    iceServers: [
      { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] },
      { urls: 'stun:stun.cloudflare.com:3478' },
      { urls: 'turn:openrelay.metered.ca:80', username: 'openrelayproject', credential: 'openrelayproject' },
      { urls: 'turn:openrelay.metered.ca:443', username: 'openrelayproject', credential: 'openrelayproject' },
      { urls: 'turn:openrelay.metered.ca:443?transport=tcp', username: 'openrelayproject', credential: 'openrelayproject' },
    ],
  };

  function makeCode(len) {
    let s = '';
    const arr = new Uint32Array(len || 5);
    (window.crypto || {}).getRandomValues ? crypto.getRandomValues(arr) : arr.forEach((_, i) => (arr[i] = Math.random() * 1e9));
    for (let i = 0; i < arr.length; i++) s += ALPHABET[arr[i] % ALPHABET.length];
    return s;
  }

  function normalizeCode(code) {
    return String(code || '').toUpperCase().replace(/[^A-Z0-9]/g, '').replace(/0/g, 'O').replace(/1/g, 'I').slice(0, 8);
  }

  /* ---------- Транспорт PeerJS ---------- */
  class PeerTransport {
    constructor(events) {
      this.events = events;
      this.peer = null;
      this.conn = null;
      this.closed = false;
    }

    _newPeer(id) {
      if (!global.Peer) throw new Error('PeerJS не загружен');
      const peer = new global.Peer(id, { config: ICE, debug: 0 });
      return peer;
    }

    host(code) {
      return new Promise((resolve, reject) => {
        const peer = this._newPeer(PREFIX + code);
        this.peer = peer;
        let opened = false;
        peer.on('open', () => { opened = true; resolve(code); });
        peer.on('error', (err) => {
          if (!opened) reject(err); else this.events.error(err);
        });
        peer.on('connection', (conn) => {
          if (this.conn && this.conn.open) { conn.close(); return; } // уже занято
          this._bind(conn);
        });
        peer.on('disconnected', () => { if (!this.closed) { try { peer.reconnect(); } catch (e) { /* ignore */ } } });
      });
    }

    join(code) {
      return new Promise((resolve, reject) => {
        const peer = this._newPeer(undefined);
        this.peer = peer;
        let done = false;
        const fail = (err) => { if (!done) { done = true; reject(err); } };
        peer.on('error', (err) => { if (!done) fail(err); else this.events.error(err); });
        peer.on('open', () => {
          const conn = peer.connect(PREFIX + code, { reliable: true, serialization: 'json' });
          const t = setTimeout(() => fail(new Error('timeout')), 20000);
          conn.on('open', () => { clearTimeout(t); done = true; this._bind(conn, true); resolve(); });
          conn.on('error', (err) => { clearTimeout(t); fail(err); });
        });
      });
    }

    _bind(conn, alreadyOpen) {
      this.conn = conn;
      const onOpen = () => this.events.open();
      conn.on('data', (msg) => this.events.message(msg));
      conn.on('close', () => this.events.close());
      conn.on('error', (err) => this.events.error(err));
      if (alreadyOpen || conn.open) onOpen(); else conn.on('open', onOpen);
    }

    send(msg) {
      if (this.conn && this.conn.open) { this.conn.send(msg); return true; }
      return false;
    }

    close() {
      this.closed = true;
      try { if (this.conn) this.conn.close(); } catch (e) { /* ignore */ }
      try { if (this.peer) this.peer.destroy(); } catch (e) { /* ignore */ }
      this.conn = null;
      this.peer = null;
    }
  }

  /* ---------- Локальный транспорт (две вкладки) ---------- */
  class LocalTransport {
    constructor(events) {
      this.events = events;
      this.ch = null;
      this.role = null;
      this.connected = false;
    }
    _open(code) {
      this.ch = new BroadcastChannel('morskoy-boy-room-' + code);
      this.ch.onmessage = (e) => {
        const { from, kind, payload } = e.data || {};
        if (from === this.role) return;
        if (kind === 'knock' && this.role === 'host') { this.ch.postMessage({ from: 'host', kind: 'welcome' }); this._connect(); }
        else if (kind === 'welcome' && this.role === 'guest') this._connect();
        else if (kind === 'msg' && this.connected) this.events.message(payload);
        else if (kind === 'bye') { this.connected = false; this.events.close(); }
      };
    }
    _connect() { if (!this.connected) { this.connected = true; this.events.open(); } }
    host(code) { this.role = 'host'; this._open(code); return Promise.resolve(code); }
    join(code) {
      this.role = 'guest'; this._open(code);
      return new Promise((resolve, reject) => {
        const t = setTimeout(() => reject(new Error('peer-unavailable')), 5000);
        const orig = this.events.open;
        this.events.open = () => { clearTimeout(t); this.events.open = orig; orig(); resolve(); };
        this.ch.postMessage({ from: 'guest', kind: 'knock' });
      });
    }
    send(payload) { if (!this.ch || !this.connected) return false; this.ch.postMessage({ from: this.role, kind: 'msg', payload }); return true; }
    close() { if (this.ch) { try { this.ch.postMessage({ from: this.role, kind: 'bye' }); } catch (e) { /* ignore */ } this.ch.close(); } this.ch = null; this.connected = false; }
  }

  /* ---------- Публичный API ---------- */
  const handlers = {};
  let transport = null;
  let connected = false;
  let role = null;
  let roomCode = null;

  const events = {
    open() { connected = true; emit('_open'); },
    close() { const was = connected; connected = false; if (was) emit('_close'); },
    error(err) { emit('_error', err); },
    message(msg) { if (msg && msg.type) emit(msg.type, msg.payload); },
  };

  function emit(type, payload) { (handlers[type] || []).forEach((fn) => { try { fn(payload); } catch (e) { console.error(e); } }); }

  function useLocal() {
    try { return new URLSearchParams(location.search).get('transport') === 'local' || localStorage.getItem('bs_transport') === 'local'; } catch (e) { return false; }
  }

  function makeTransport() {
    return useLocal() ? new LocalTransport(events) : new PeerTransport(events);
  }

  const net = {
    makeCode, normalizeCode,
    get connected() { return connected; },
    get role() { return role; },
    get code() { return roomCode; },
    on(type, fn) { (handlers[type] = handlers[type] || []).push(fn); return () => net.off(type, fn); },
    off(type, fn) { handlers[type] = (handlers[type] || []).filter((f) => f !== fn); },
    async host(code) {
      net.close();
      roomCode = code || makeCode(5);
      role = 'host';
      transport = makeTransport();
      await transport.host(roomCode);
      return roomCode;
    },
    async join(code) {
      net.close();
      roomCode = normalizeCode(code);
      role = 'guest';
      transport = makeTransport();
      await transport.join(roomCode);
    },
    send(type, payload) { return transport ? transport.send({ type, payload }) : false; },
    close() {
      if (transport) transport.close();
      transport = null;
      connected = false;
    },
    roomLink(code) {
      const url = new URL(location.href);
      url.search = '';
      url.hash = '';
      url.searchParams.set('room', code);
      if (useLocal()) url.searchParams.set('transport', 'local');
      return url.toString();
    },
    explainError(err) {
      const type = (err && err.type) || (err && err.message) || String(err);
      if (/peer-unavailable|timeout/.test(type)) return 'Комната не найдена. Проверь код или попроси друга создать комнату заново.';
      if (/unavailable-id/.test(type)) return 'Такой код уже занят. Создай комнату ещё раз.';
      if (/network|server-error|socket/.test(type)) return 'Нет связи с сервером подбора. Проверь интернет и попробуй снова.';
      if (/browser-incompatible/.test(type)) return 'Браузер не поддерживает WebRTC. Попробуй Chrome или Safari.';
      return 'Не удалось соединиться: ' + type;
    },
  };

  global.BS = global.BS || {};
  global.BS.net = net;
})(window);
