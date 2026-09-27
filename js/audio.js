/* Звук: всё синтезируется на лету через WebAudio, без файлов */
(function (global) {
  'use strict';

  let ctx = null;
  let master = null;

  function ensure() {
    if (!global.BS.settings.get().sound) return null;
    try {
      if (!ctx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return null;
        ctx = new AC();
        master = ctx.createGain();
        master.gain.value = 0.55;
        master.connect(ctx.destination);
      }
      if (ctx.state === 'suspended') ctx.resume();
      return ctx;
    } catch (e) {
      return null;
    }
  }

  function noise(duration, { freq = 1000, q = 1, gain = 0.5, type = 'lowpass', decay = duration } = {}) {
    const c = ensure();
    if (!c) return;
    const len = Math.floor(c.sampleRate * duration);
    const buf = c.createBuffer(1, len, c.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    const src = c.createBufferSource();
    src.buffer = buf;
    const filter = c.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = freq;
    filter.Q.value = q;
    const g = c.createGain();
    g.gain.setValueAtTime(gain, c.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, c.currentTime + decay);
    src.connect(filter).connect(g).connect(master);
    src.start();
    src.stop(c.currentTime + duration);
  }

  function tone(freq, duration, { type = 'sine', gain = 0.3, slide = null, delay = 0 } = {}) {
    const c = ensure();
    if (!c) return;
    const o = c.createOscillator();
    o.type = type;
    const t0 = c.currentTime + delay;
    o.frequency.setValueAtTime(freq, t0);
    if (slide) o.frequency.exponentialRampToValueAtTime(slide, t0 + duration);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gain, t0 + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
    o.connect(g).connect(master);
    o.start(t0);
    o.stop(t0 + duration + 0.05);
  }

  const sfx = {
    tap() { tone(900, 0.05, { type: 'square', gain: 0.05 }); },
    select() { tone(600, 0.06, { type: 'triangle', gain: 0.08, slide: 900 }); },
    shot() { noise(0.12, { freq: 2500, gain: 0.35, type: 'highpass', decay: 0.1 }); },
    miss() {
      noise(0.5, { freq: 700, gain: 0.35, q: 0.7, decay: 0.45 });
      tone(220, 0.25, { type: 'sine', gain: 0.08, slide: 90 });
    },
    hit() {
      noise(0.35, { freq: 400, gain: 0.7, decay: 0.3 });
      tone(120, 0.35, { type: 'sawtooth', gain: 0.25, slide: 40 });
    },
    sunk() {
      noise(0.7, { freq: 300, gain: 0.9, decay: 0.6 });
      tone(90, 0.6, { type: 'sawtooth', gain: 0.3, slide: 30 });
      [523, 659, 784].forEach((f, i) => tone(f, 0.18, { type: 'triangle', gain: 0.12, delay: 0.25 + i * 0.09 }));
    },
    detect() { [880, 1320].forEach((f, i) => tone(f, 0.12, { type: 'sine', gain: 0.1, delay: i * 0.12 })); },
    radar() { tone(1200, 0.6, { type: 'sine', gain: 0.1, slide: 400 }); },
    torpedo() { noise(0.6, { freq: 900, gain: 0.3, type: 'bandpass', q: 2, decay: 0.6 }); tone(300, 0.6, { type: 'sawtooth', gain: 0.08, slide: 1200 }); },
    hurt() { noise(0.3, { freq: 500, gain: 0.6, decay: 0.3 }); tone(80, 0.3, { type: 'square', gain: 0.12, slide: 50 }); },
    tick() { tone(1400, 0.04, { type: 'square', gain: 0.05 }); },
    timeout() { tone(300, 0.3, { type: 'square', gain: 0.1, slide: 120 }); },
    win() { [523, 659, 784, 1046].forEach((f, i) => tone(f, 0.3, { type: 'triangle', gain: 0.18, delay: i * 0.14 })); tone(1046, 0.8, { type: 'sine', gain: 0.12, delay: 0.6 }); },
    lose() { [440, 370, 311, 220].forEach((f, i) => tone(f, 0.35, { type: 'sawtooth', gain: 0.1, delay: i * 0.18 })); },
    reward() { [660, 880, 1320].forEach((f, i) => tone(f, 0.15, { type: 'triangle', gain: 0.14, delay: i * 0.08 })); },
    unlock() { ensure(); sfx.reward(); },
  };

  global.BS.audio = { sfx, ensure };
})(window);
