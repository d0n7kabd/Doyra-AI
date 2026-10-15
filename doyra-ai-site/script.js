/* Doyra AI — landing page.
   One rhythm engine drives every visual: the hero drum, the usul ring, the
   timing strip, the girih tiles, the ta/ka rain and the ambient drum.
   Sound starts only after the visitor's first click or tap. */
(() => {
  'use strict';

  // ---------- helpers ----------
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const TAU = Math.PI * 2;
  const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
  const smooth = (t) => t * t * (3 - 2 * t);
  const nowSec = () => performance.now() / 1000;
  const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
  let reduced = mq.matches;
  if (mq.addEventListener) mq.addEventListener('change', (e) => { reduced = e.matches; });

  function seeded(seed) { // mulberry32: same "random" layout every visit
    return () => {
      seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  const bus = {
    fns: {},
    on(type, fn) { (this.fns[type] = this.fns[type] || []).push(fn); },
    emit(type, data) { (this.fns[type] || []).forEach((fn) => fn(data)); },
  };

  // Canvas sized to its CSS box, device pixel ratio capped at 2.
  function fitCanvas(canvas, onResize, maxDpr = 2) {
    const fit = () => {
      const r = canvas.getBoundingClientRect();
      const dpr = Math.min(maxDpr, window.devicePixelRatio || 1);
      canvas.width = Math.max(1, Math.round(r.width * dpr));
      canvas.height = Math.max(1, Math.round(r.height * dpr));
      onResize(r.width, r.height, dpr);
    };
    if ('ResizeObserver' in window) new ResizeObserver(fit).observe(canvas);
    else window.addEventListener('resize', fit);
    fit();
  }

  // Track which elements are on screen so offscreen canvases don't draw.
  const visible = new WeakMap();
  const io = new IntersectionObserver((entries) => {
    entries.forEach((e) => visible.set(e.target, e.isIntersecting));
  }, { rootMargin: '120px 0px' });
  const watch = (el) => { visible.set(el, false); io.observe(el); };

  // ---------- the nine strokes ----------
  const STROKES = [
    { key: 'bum_main',             name: 'bum',        hand: 'main',      syl: null, kind: 'bum' },
    { key: 'bum_secondary',        name: 'bum',        hand: 'secondary', syl: null, kind: 'bum' },
    { key: 'bak_main',             name: 'bak',        hand: 'main',      syl: 'ta', kind: 'bak' },
    { key: 'bak_secondary',        name: 'bak',        hand: 'secondary', syl: 'ka', kind: 'bak' },
    { key: 'kichik_bum_main',      name: 'kichik bum', hand: 'main',      syl: null, kind: 'bum', small: true },
    { key: 'kichik_bum_secondary', name: 'kichik bum', hand: 'secondary', syl: null, kind: 'bum', small: true },
    { key: 'kichik_bak_main',      name: 'kichik bak', hand: 'main',      syl: 'ta', kind: 'bak', small: true },
    { key: 'kichik_bak_secondary', name: 'kichik bak', hand: 'secondary', syl: 'ka', kind: 'bak', small: true },
    { key: 'noxun_secondary',      name: 'noxun',      hand: 'secondary', syl: 'ka', kind: 'noxun' },
  ];
  const BY_KEY = Object.fromEntries(STROKES.map((s) => [s.key, s]));

  // ---------- sound: real recordings from data/clips, copied to sounds/ ----------
  const Sound = {
    ctx: null, master: null, raw: {}, buffers: {}, fetching: null, decoding: null,
    prefetch() { // bytes only; nothing is audible until unlock()
      if (!this.fetching) {
        this.fetching = Promise.all(STROKES.map(async ({ key }) => {
          try {
            const r = await fetch(`sounds/${key}.wav`);
            if (r.ok) this.raw[key] = await r.arrayBuffer();
          } catch (e) { /* offline or file:// — visuals still work */ }
        }));
      }
      return this.fetching;
    },
    unlock() {
      if (!this.ctx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return Promise.resolve();
        this.ctx = new AC();
        const comp = this.ctx.createDynamicsCompressor();
        comp.threshold.value = -10; comp.ratio.value = 4;
        this.master = this.ctx.createGain();
        this.master.gain.value = 0.9;
        this.master.connect(comp).connect(this.ctx.destination);
      }
      if (this.ctx.state === 'suspended') this.ctx.resume();
      if (!this.decoding) {
        this.decoding = this.prefetch().then(() => Promise.all(
          Object.entries(this.raw).map(([k, ab]) => new Promise((res) => {
            this.ctx.decodeAudioData(ab.slice(0), (b) => { this.buffers[k] = b; res(); }, () => res());
          }))
        ));
      }
      return this.decoding;
    },
    play(key, when = 0, gain = 1) {
      const b = this.buffers[key];
      if (!b || !this.ctx) return;
      const src = this.ctx.createBufferSource();
      src.buffer = b;
      const g = this.ctx.createGain();
      g.gain.value = gain;
      src.connect(g).connect(this.master);
      src.start(Math.max(when, this.ctx.currentTime));
    },
  };

  // A single hit triggered by the visitor (drum, stroke list, keyboard).
  function hit(key, from) {
    const t0 = performance.now();
    Sound.unlock().then(() => {
      if (performance.now() - t0 < 700) Sound.play(key);
    });
    bus.emit('hit', { key, stroke: BY_KEY[key], from });
  }

  // ---------- rhythm engine: the to'y cycle ----------
  // 12 strokes: kichik bum, kichik bak, kichik bak, four times.
  // Both baks are kichik bak with the main hand: "ta ta".
  const TOY_GROUP = ['kichik_bum_main', 'kichik_bak_main', 'kichik_bak_main'];
  const TOY = Array.from({ length: 12 }, (_, i) => TOY_GROUP[i % 3]);
  const STEP = 0.2;     // even spacing between strokes (s), illustration tempo
  const SQUEEZE = 0.035; // baks 35 ms closer: middle of the measured 30-40 ms

  // Onset of each stroke within one group of three, in seconds.
  // Real: bak-bak gap is SQUEEZE shorter than the other two gaps; group length unchanged.
  function groupOffsets(m) { // m: 0 = even, 1 = real (can be in between while animating)
    const d = SQUEEZE * m;
    return [0, STEP + d / 3, 2 * STEP - d / 3];
  }
  const CYCLE = 12 * STEP;

  const Engine = {
    running: false, audible: false, blind: false, mode: 'real',
    cycles: Infinity, onEnd: null, n: 0, start0: 0, useAudio: false,
    queue: [], timer: 0,
    clock() { return this.useAudio && Sound.ctx ? Sound.ctx.currentTime : nowSec(); },
    start(opts = {}) {
      this.stop(true);
      this.audible = !!opts.audible;
      this.blind = !!opts.blind;
      this.playMode = opts.mode || null; // fixed mode (listening game) or follow the toggle
      this.cycles = opts.cycles || Infinity;
      this.onEnd = opts.onEnd || null;
      this.useAudio = this.audible && !!Sound.ctx;
      this.running = true;
      this.n = 0;
      this.start0 = this.clock() + 0.1;
      this.timer = setInterval(() => this.schedule(), 25);
      this.schedule();
      bus.emit('engine', this);
    },
    stop(quiet) {
      clearInterval(this.timer);
      this.running = false;
      this.queue.length = 0;
      if (!quiet) bus.emit('engine', this);
    },
    currentM() { return (this.playMode || this.mode) === 'real' ? 1 : 0; },
    schedule() {
      const horizon = this.clock() + 0.15;
      for (;;) {
        const cyc = Math.floor(this.n / 12), i = this.n % 12;
        if (cyc >= this.cycles) break;
        const g = Math.floor(i / 3);
        const t = this.start0 + cyc * CYCLE + g * 3 * STEP + groupOffsets(this.currentM())[i % 3];
        if (t > horizon) break;
        if (this.audible) Sound.play(TOY[i], t, i % 3 === 0 ? 0.95 : 0.85);
        this.queue.push({ t, i, cyc, key: TOY[i] });
        this.n++;
      }
    },
    // Called every animation frame: fire visual beats that are due.
    flush() {
      if (!this.running) return;
      const now = this.clock();
      while (this.queue.length && this.queue[0].t <= now) {
        const b = this.queue.shift();
        bus.emit('beat', { ...b, stroke: BY_KEY[b.key], audible: this.audible, blind: this.blind });
      }
      if (this.n >= this.cycles * 12 && !this.queue.length) {
        const done = this.onEnd;
        this.stop();
        if (done) setTimeout(done, 350);
      }
    },
    phase() { // seconds into the current cycle
      return ((this.clock() - this.start0) % CYCLE + CYCLE) % CYCLE;
    },
  };

  // The audible loop is toggled by the ring buttons and the ambient drum.
  function toggleToy() {
    if (Engine.running && Engine.audible && !Engine.blind) {
      Engine.stop();
      ghostCheck();
      return;
    }
    Sound.unlock().then(() => Engine.start({ audible: true }));
  }
  $$('[data-play-toy]').forEach((b) => b.addEventListener('click', toggleToy));
  bus.on('engine', () => {
    const on = Engine.running && Engine.audible && !Engine.blind;
    $$('[data-play-toy]').forEach((b) => {
      b.setAttribute('aria-pressed', String(on));
      $('.label', b).textContent = on ? 'Stop' : "Play the to'y cycle";
    });
    const amb = $('#ambient');
    amb.setAttribute('aria-pressed', String(on));
    amb.setAttribute('aria-label', on ? "Stop the to'y cycle" : "Play the to'y cycle");
  });

  // A silent "ghost" cycle keeps the rhythm visuals alive while they are on screen.
  const rhythmSections = $$('.girih-band, .level-2, .level-3, .cta-band, .core');
  const rhythmIO = new IntersectionObserver((entries) => {
    entries.forEach((e) => e.target.classList.toggle('on-screen', e.isIntersecting));
    ghostCheck();
  });
  rhythmSections.forEach((s) => rhythmIO.observe(s));
  function ghostCheck() {
    const want = !reduced && rhythmSections.some((s) => s.classList.contains('on-screen'));
    if (want && !Engine.running) Engine.start({ audible: false });
    else if (!want && Engine.running && !Engine.audible) Engine.stop();
  }

  // ---------- hero drum ----------
  class HeroDrum {
    constructor(canvas) {
      this.c = canvas;
      this.ctx = canvas.getContext('2d');
      this.ripples = []; this.sparks = []; this.words = [];
      this.energy = 0; this.kick = 0; this.shake = 0;
      this.lastTouch = nowSec(); this.lastIdle = 0;
      const rnd = seeded(7);
      this.rings = Array.from({ length: 46 }, (_, i) => ({
        a: (i / 46) * TAU, ph: rnd() * TAU, f: 22 + rnd() * 16, tilt: rnd() * 0.6 - 0.3,
      }));
      fitCanvas(canvas, (w, h, dpr) => this.resize(w, h, dpr));
      canvas.addEventListener('pointerdown', (e) => this.onPointer(e));
      watch(canvas);
    }
    resize(w, h, dpr) {
      Object.assign(this, { w, h, dpr, cx: w / 2, cy: h / 2, R: Math.min(w, h) / 2 * 0.9 });
      const { ctx, R } = this, Ri = R * 0.84;
      this.Ri = Ri;
      const frame = ctx.createRadialGradient(0, 0, Ri, 0, 0, R);
      frame.addColorStop(0, '#2b130a'); frame.addColorStop(0.18, '#6e3519');
      frame.addColorStop(0.55, '#a65a2c'); frame.addColorStop(0.85, '#7a3d1d'); frame.addColorStop(1, '#3a1a0c');
      const skin = ctx.createRadialGradient(-R * 0.18, -R * 0.22, R * 0.05, 0, 0, Ri);
      skin.addColorStop(0, '#fbf1dc'); skin.addColorStop(0.6, '#efdcb6'); skin.addColorStop(0.92, '#d6b783'); skin.addColorStop(1, '#a98455');
      const shadow = ctx.createRadialGradient(0, R * 0.06, R * 0.85, 0, R * 0.06, R * 1.18);
      shadow.addColorStop(0, 'rgba(0,0,0,.55)'); shadow.addColorStop(1, 'rgba(0,0,0,0)');
      const glow = ctx.createRadialGradient(0, 0, 0, 0, 0, R * 1.4);
      glow.addColorStop(0, 'rgba(224,169,59,.35)'); glow.addColorStop(1, 'rgba(224,169,59,0)');
      this.grad = { frame, skin, shadow, glow };
    }
    onPointer(e) {
      const r = this.c.getBoundingClientRect();
      const x = e.clientX - r.left - this.cx, y = e.clientY - r.top - this.cy;
      const d = Math.hypot(x, y) / this.R;
      if (d > 1.04) return;
      const hand = x < 0 ? 'secondary' : 'main';
      const key = (d < 0.7 ? 'bum_' : 'bak_') + hand;
      hit(key, { drum: true, x, y });
    }
    strike(stroke, at) {
      const { R, Ri } = this;
      const t = nowSec();
      this.lastTouch = t;
      let x = at ? at.x : 0, y = at ? at.y : 0;
      if (stroke.kind === 'bum') {
        if (!at) { x = (stroke.hand === 'main' ? 1 : -1) * R * 0.12; y = R * 0.05; }
        this.ripples.push({ x, y, t, life: 1.6, speed: R * 0.9, w: R * 0.06, s: stroke.small ? 0.6 : 1 });
        this.kick = stroke.small ? 0.6 : 1;
        this.energy = Math.min(1.6, this.energy + 0.45);
      } else {
        // project onto the edge of the skin
        let a = Math.atan2(y, x);
        if (!at) a = (stroke.hand === 'main' ? 0 : Math.PI) + (Math.random() - 0.5) * 1.2;
        const rx = Math.cos(a) * Ri * 0.97, ry = Math.sin(a) * Ri * 0.97;
        this.ripples.push({ x: rx, y: ry, t, life: 0.8, speed: R * 1.6, w: R * 0.022, s: 0.8 });
        this.energy = Math.min(1.8, this.energy + 1);
        this.kick = Math.max(this.kick, 0.25);
        this.shake = 1;
        if (!reduced) {
          for (let k = 0; k < 24; k++) {
            const sa = a + (Math.random() - 0.5) * 1.8;
            const sp = R * (0.9 + Math.random() * 2.2);
            this.sparks.push({ x: rx, y: ry, vx: Math.cos(sa) * sp, vy: Math.sin(sa) * sp, t, life: 0.45 + Math.random() * 0.5 });
          }
        }
        if (stroke.syl) {
          this.words.push({ text: stroke.syl, x: Math.cos(a) * R * 1.02, y: Math.sin(a) * R * 1.02, t, life: 1.1, a });
        }
      }
      if (this.ripples.length > 14) this.ripples.shift();
      if (this.sparks.length > 240) this.sparks.splice(0, this.sparks.length - 240);
    }
    draw(t, dt) {
      const { ctx, dpr, cx, cy, R, Ri, grad } = this;
      if (!R) return;
      // idle invitation: a soft breath of a ripple when nobody has played for a while
      if (!reduced && t - this.lastTouch > 5 && t - this.lastIdle > 3.2) {
        this.lastIdle = t;
        this.ripples.push({ x: 0, y: 0, t, life: 2.4, speed: R * 0.45, w: R * 0.04, s: 0.35 });
      }
      this.kick *= Math.exp(-dt * 7);
      this.energy *= Math.exp(-dt * 2.6);
      this.shake *= Math.exp(-dt * 18);

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, this.w, this.h);
      ctx.translate(cx, cy);

      // gold glow after hits
      if (this.energy > 0.02) {
        ctx.globalAlpha = Math.min(1, this.energy * 0.6);
        ctx.fillStyle = grad.glow;
        ctx.fillRect(-R * 1.4, -R * 1.4, R * 2.8, R * 2.8);
        ctx.globalAlpha = 1;
      }
      const s = 1 + this.kick * 0.018;
      ctx.scale(s, s);
      if (this.shake > 0.01) ctx.translate((Math.random() - 0.5) * this.shake * R * 0.012, (Math.random() - 0.5) * this.shake * R * 0.012);

      // drop shadow
      ctx.fillStyle = grad.shadow;
      ctx.beginPath(); ctx.arc(0, R * 0.06, R * 1.18, 0, TAU); ctx.fill();

      // wooden frame
      ctx.fillStyle = grad.frame;
      ctx.beginPath(); ctx.arc(0, 0, R, 0, TAU); ctx.arc(0, 0, Ri, 0, TAU, true); ctx.fill();

      // painted inlay on the frame, turning slowly
      const rot = reduced ? 0 : t * 0.04;
      const mid = (R + Ri) / 2, n = 40;
      ctx.save(); ctx.rotate(rot);
      for (let i = 0; i < n; i++) {
        const a = (i / n) * TAU;
        ctx.save(); ctx.rotate(a); ctx.translate(mid, 0);
        const d = (R - Ri) * 0.32;
        ctx.fillStyle = i % 2 ? '#2fb7b0' : '#f1e4c8';
        ctx.beginPath(); ctx.moveTo(-d * 0.55, 0); ctx.lineTo(0, -d); ctx.lineTo(d * 0.55, 0); ctx.lineTo(0, d); ctx.closePath(); ctx.fill();
        ctx.restore();
        const b = a + Math.PI / n;
        ctx.fillStyle = '#e0a93b';
        ctx.beginPath(); ctx.arc(Math.cos(b) * mid, Math.sin(b) * mid, (R - Ri) * 0.07, 0, TAU); ctx.fill();
      }
      ctx.restore();
      ctx.strokeStyle = 'rgba(224,169,59,.8)'; ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.arc(0, 0, R * 0.995, 0, TAU); ctx.stroke();
      ctx.beginPath(); ctx.arc(0, 0, Ri * 1.01, 0, TAU); ctx.stroke();

      // skin
      ctx.save();
      ctx.beginPath(); ctx.arc(0, 0, Ri, 0, TAU); ctx.clip();
      ctx.fillStyle = grad.skin;
      ctx.fillRect(-Ri, -Ri, Ri * 2, Ri * 2);
      if (this.kick > 0.02) {
        ctx.fillStyle = `rgba(255,236,190,${this.kick * 0.22})`;
        ctx.fillRect(-Ri, -Ri, Ri * 2, Ri * 2);
      }
      // painted star at the centre of the skin
      ctx.strokeStyle = 'rgba(160,110,50,.35)'; ctx.lineWidth = 1.2;
      starPath(ctx, 0, 0, Ri * 0.2, Ri * 0.2 * 0.765, -rot * 0.5); ctx.stroke();
      ctx.beginPath(); ctx.arc(0, 0, Ri * 0.27, 0, TAU); ctx.stroke();

      // ripples: a shadow ring with a highlight ring just inside it
      for (let k = this.ripples.length - 1; k >= 0; k--) {
        const rp = this.ripples[k];
        const age = t - rp.t;
        if (age > rp.life) { this.ripples.splice(k, 1); continue; }
        const f = age / rp.life;
        const fade = Math.pow(1 - f, 1.6) * rp.s;
        for (let j = 0; j < 3; j++) {
          const rr = rp.speed * age - j * rp.w * 2.2;
          if (rr <= 0) continue;
          const a = fade * (1 - j * 0.3);
          ctx.lineWidth = rp.w * (1 - f * 0.5);
          ctx.strokeStyle = `rgba(110,70,30,${a * 0.28})`;
          ctx.beginPath(); ctx.arc(rp.x, rp.y, rr, 0, TAU); ctx.stroke();
          ctx.strokeStyle = `rgba(255,252,240,${a * 0.55})`;
          ctx.lineWidth = rp.w * 0.45;
          ctx.beginPath(); ctx.arc(rp.x, rp.y, Math.max(0, rr - rp.w * 0.6), 0, TAU); ctx.stroke();
        }
      }
      // inner shadow at the rim
      ctx.lineWidth = Ri * 0.06;
      ctx.strokeStyle = 'rgba(60,30,10,.28)';
      ctx.beginPath(); ctx.arc(0, 0, Ri, 0, TAU); ctx.stroke();
      ctx.restore();

      // metal rings inside the rim
      const e = this.energy, rr = R * 0.028, rad = Ri * 0.925;
      ctx.lineWidth = Math.max(1, R * 0.007);
      for (const ring of this.rings) {
        const wob = reduced ? 0 : Math.sin(t * ring.f + ring.ph) * e;
        const a = ring.a + wob * 0.012 + (reduced ? 0 : Math.sin(t * 0.7 + ring.ph) * 0.004);
        const r2 = rad + wob * R * 0.012;
        const x = Math.cos(a) * r2, y = Math.sin(a) * r2;
        ctx.strokeStyle = 'rgba(70,50,30,.45)';
        ctx.beginPath(); ctx.ellipse(x + 1, y + 1.5, rr, rr * 0.55, a + ring.tilt + wob * 0.6, 0, TAU); ctx.stroke();
        ctx.strokeStyle = e > 0.3 ? '#fff1c4' : '#d8c08a';
        ctx.beginPath(); ctx.ellipse(x, y, rr, rr * 0.55, a + ring.tilt + wob * 0.6, 0, TAU); ctx.stroke();
      }

      // sparks
      ctx.globalCompositeOperation = 'lighter';
      ctx.lineCap = 'round';
      for (let k = this.sparks.length - 1; k >= 0; k--) {
        const p = this.sparks[k];
        const age = t - p.t;
        if (age > p.life) { this.sparks.splice(k, 1); continue; }
        p.vx *= Math.exp(-dt * 2.5); p.vy *= Math.exp(-dt * 2.5); p.vy += R * 1.4 * dt;
        p.x += p.vx * dt; p.y += p.vy * dt;
        const f = 1 - age / p.life;
        ctx.strokeStyle = `rgba(255,${190 + f * 60 | 0},${90 + f * 100 | 0},${f})`;
        ctx.lineWidth = 1 + f * 2;
        ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x - p.vx * 0.035, p.y - p.vy * 0.035); ctx.stroke();
      }
      ctx.globalCompositeOperation = 'source-over';

      // ta / ka burst from the rim
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      for (let k = this.words.length - 1; k >= 0; k--) {
        const w = this.words[k];
        const age = t - w.t;
        if (age > w.life) { this.words.splice(k, 1); continue; }
        const f = age / w.life;
        const push = reduced ? 0 : smooth(Math.min(1, f * 2)) * R * 0.18;
        ctx.globalAlpha = 1 - f;
        ctx.font = `800 ${R * (0.13 + (reduced ? 0 : f * 0.06))}px Unbounded, sans-serif`;
        ctx.fillStyle = w.text === 'ta' ? '#ff8a5c' : '#7fe3da';
        ctx.fillText(w.text, w.x + Math.cos(w.a) * push, w.y + Math.sin(w.a) * push);
      }
      ctx.globalAlpha = 1;
    }
  }

  function starPath(ctx, x, y, R, r, rot = 0) { // 8-pointed star, 16 vertices
    ctx.beginPath();
    for (let i = 0; i < 16; i++) {
      const a = rot + (i * Math.PI) / 8 - Math.PI / 2;
      const rad = i % 2 ? r : R;
      const px = x + Math.cos(a) * rad, py = y + Math.sin(a) * rad;
      i ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
    }
    ctx.closePath();
  }

  // ---------- girih: eight-pointed stars of Samarkand tilework ----------
  class Girih {
    constructor(canvas, variant) {
      this.c = canvas; this.ctx = canvas.getContext('2d'); this.variant = variant;
      this.host = canvas.parentElement;
      this.pulses = []; this.p = 0;
      fitCanvas(canvas, (w, h, dpr) => this.layout(w, h, dpr), 1.5);
      watch(canvas);
    }
    layout(w, h, dpr) {
      Object.assign(this, { w, h, dpr });
      const s = w < 600 ? 62 : w < 1100 ? 84 : 100;
      this.s = s;
      const rnd = seeded(this.variant.length * 97 + 3);
      const cols = Math.ceil(w / s) + 2, rows = Math.ceil(h / s) + 2;
      const ox = (w - (cols - 1) * s) / 2, oy = (h - (rows - 1) * s) / 2;
      const maxD = Math.hypot(w, h) / 2;
      this.tiles = [];
      for (let j = 0; j < rows; j++) {
        for (let i = 0; i < cols; i++) {
          const x = ox + i * s, y = oy + j * s;
          const dx = x - w / 2, dy = y - h / 2, dist = Math.hypot(dx, dy);
          const out = Math.atan2(dy, dx) + (rnd() - 0.5) * 1.4;
          const far = 260 + rnd() * 700;
          const away = Math.atan2(dy, dx) + (rnd() - 0.5) * 0.8;
          const pick = rnd();
          this.tiles.push({
            x, y, dist, nd: dist / maxD,
            sx: Math.cos(out) * far, sy: Math.sin(out) * far - 120, sr: (rnd() - 0.5) * 5,
            bx: Math.cos(away) * (300 + rnd() * 600), by: Math.sin(away) * (300 + rnd() * 600) + 200, br: (rnd() - 0.5) * 4,
            col: pick < 0.12 ? '#d0623a' : (i + j) % 2 ? '#1f4aa8' : '#2fb7b0',
            delay: dist / maxD * 0.55 + rnd() * 0.15,
          });
        }
      }
      this.sprites = {};
      this.lastKey = '';
    }
    // Each tile colour is drawn once into an offscreen canvas, then stamped with drawImage.
    sprite(col, lit) {
      const id = col + lit;
      if (this.sprites[id]) return this.sprites[id];
      const k = this.dpr * 1.25; // headroom for the pulse scale-up
      const R = this.s * 0.5;
      const size = Math.ceil(R * 2.2 * k);
      const c = document.createElement('canvas');
      c.width = c.height = size;
      const x = c.getContext('2d');
      x.setTransform(k, 0, 0, k, size / 2, size / 2);
      starPath(x, 0, 0, R * 0.98, R * 0.765 * 0.98);
      x.fillStyle = col; x.fill();
      x.lineWidth = 1.4; x.strokeStyle = '#e0a93b'; x.stroke();
      starPath(x, 0, 0, R * 0.46, R * 0.46 * 0.6, Math.PI / 8);
      x.fillStyle = lit ? '#f2cf7c' : 'rgba(10,20,48,.85)'; x.fill();
      x.beginPath(); x.arc(0, 0, R * 0.1, 0, TAU);
      x.fillStyle = '#e0a93b'; x.fill();
      return (this.sprites[id] = { c, k, half: size / 2 });
    }
    pulse(strength) { if (!reduced) { this.pulses.push({ t: nowSec(), s: strength }); if (this.pulses.length > 6) this.pulses.shift(); } }
    progress() { // 0 when the section enters at the bottom, 1 when it leaves at the top
      const r = this.host.getBoundingClientRect();
      const vh = window.innerHeight;
      return clamp((vh - r.top) / (vh + r.height));
    }
    draw(t) {
      if (!this.tiles) return;
      const { ctx, dpr, s, w, h } = this;
      const p = this.p;
      let asm, brk;
      if (reduced || this.variant === 'ghost') { asm = 1; brk = 0; }
      else if (this.variant === 'cta') { asm = clamp((p - 0.08) / 0.38); brk = 0; }
      else { asm = clamp((p - 0.06) / 0.4); brk = clamp((p - 0.66) / 0.3); }

      // drop finished pulses; skip the frame entirely if nothing moved
      this.pulses = this.pulses.filter((q) => t - q.t < 2.2);
      const key = `${asm.toFixed(4)}|${brk.toFixed(4)}|${this.w}`;
      if (!this.pulses.length && key === this.lastKey) return;
      this.lastKey = this.pulses.length ? '' : key;

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      const speed = Math.max(w, h) * 0.9;

      for (const tl of this.tiles) {
        const a = smooth(clamp((asm - tl.delay * 0.6) / 0.45));
        const b = smooth(clamp((brk - (1 - tl.nd) * 0.4) / 0.6));
        const alpha = a * (1 - b);
        if (alpha <= 0.01) continue;
        let bump = 0;
        for (const q of this.pulses) {
          const front = (t - q.t) * speed;
          const z = (front - tl.dist) / (s * 1.4);
          if (z > -1 && z < 3) bump += q.s * Math.exp(-z * z) * (1 - (t - q.t) / 2.2);
        }
        const x = tl.x + (1 - a) * tl.sx + b * tl.bx;
        const y = tl.y + (1 - a) * tl.sy + b * tl.by;
        const rot = (1 - a) * tl.sr + b * tl.br;
        const sp = this.sprite(tl.col, bump > 0.15);
        const sc = (0.35 + 0.65 * a) * (1 + bump * 0.18) * dpr / sp.k;
        const cs = sc * Math.cos(rot), sn = sc * Math.sin(rot);
        ctx.setTransform(cs, sn, -sn, cs, dpr * x, dpr * y);
        ctx.globalAlpha = alpha;
        ctx.drawImage(sp.c, -sp.half, -sp.half);
      }
      ctx.globalAlpha = 1;
    }
  }

  // ---------- ta / ka rain over the core idea ----------
  class Rain {
    constructor(canvas) {
      this.c = canvas; this.ctx = canvas.getContext('2d');
      this.parts = []; this.waves = [];
      fitCanvas(canvas, (w, h, dpr) => Object.assign(this, { w, h, dpr }));
      watch(canvas);
    }
    beat(stroke, i) {
      if (reduced || !this.w) return;
      if (stroke.kind === 'bum') {
        this.waves.push({ t: nowSec() });
        for (const p of this.parts) if (p.y > this.h - 140) p.vy -= 520 + Math.random() * 300; // the bum bounces them
      } else if (stroke.syl) {
        const lane = ((i % 12) + 0.5) / 12;
        const size = 30 + Math.random() * 46;
        this.parts.push({
          text: stroke.syl, x: this.w * (0.06 + lane * 0.88) + (Math.random() - 0.5) * 40, y: -60,
          vx: (Math.random() - 0.5) * 60, vy: 120 + Math.random() * 160, r: (Math.random() - 0.5) * 0.6,
          vr: (Math.random() - 0.5) * 3, size, t: nowSec(), bounces: 0,
        });
        if (this.parts.length > 70) this.parts.shift();
      }
    }
    draw(t, dt) {
      const { ctx, dpr, w, h } = this;
      if (!w) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      // bum shockwaves rise from the floor
      this.waves = this.waves.filter((q) => t - q.t < 1.4);
      for (const q of this.waves) {
        const f = (t - q.t) / 1.4;
        ctx.strokeStyle = `rgba(224,169,59,${(1 - f) * 0.5})`;
        ctx.lineWidth = 2 + (1 - f) * 6;
        ctx.beginPath(); ctx.ellipse(w / 2, h + 20, f * w * 0.7, f * h * 0.45, 0, Math.PI, TAU); ctx.stroke();
      }
      const floor = h - 36;
      ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
      for (let k = this.parts.length - 1; k >= 0; k--) {
        const p = this.parts[k];
        const age = t - p.t;
        if (age > 5) { this.parts.splice(k, 1); continue; }
        p.vy += 1500 * dt; p.x += p.vx * dt; p.y += p.vy * dt; p.r += p.vr * dt;
        if (p.y > floor) {
          p.y = floor; p.vy *= -0.5; p.vx *= 0.8; p.vr *= 0.6; p.bounces++;
          if (Math.abs(p.vy) < 60) { p.vy = 0; p.vr = 0; p.r *= 0.9; }
        }
        const fade = age > 4 ? 1 - (age - 4) : 1;
        ctx.save();
        ctx.translate(p.x, p.y); ctx.rotate(p.r);
        ctx.globalAlpha = fade * 0.9;
        ctx.font = `800 ${p.size}px Unbounded, sans-serif`;
        ctx.fillStyle = p.text === 'ta' ? '#d0623a' : '#2fb7b0';
        ctx.fillText(p.text, 0, 0);
        ctx.restore();
      }
      ctx.globalAlpha = 1;
    }
  }

  // ---------- ambient drum, bottom right, always alive ----------
  class Ambient {
    constructor(btn) {
      this.btn = btn; this.c = $('canvas', btn); this.ctx = this.c.getContext('2d');
      this.energy = 0; this.flash = 0; this.lit = -1; this.litT = 0;
      fitCanvas(this.c, (w, h, dpr) => Object.assign(this, { w, h, dpr }));
      btn.addEventListener('click', toggleToy);
    }
    hit(stroke, i) {
      this.energy = Math.min(1.5, this.energy + (stroke.kind === 'bum' ? 0.5 : 0.9));
      this.flash = stroke.kind === 'bum' ? 1 : 0.6;
      if (i !== undefined) { this.lit = i; this.litT = nowSec(); }
    }
    draw(t, dt) {
      const { ctx, dpr, w, h } = this;
      if (!w) return;
      this.energy *= Math.exp(-dt * 3); this.flash *= Math.exp(-dt * 6);
      const R = w / 2 - 2, Ri = R * 0.78, cx = w / 2, cy = h / 2;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      ctx.translate(cx, cy);
      const breathe = reduced ? 0 : Math.sin(t * 1.6) * 0.02;
      ctx.scale(1 + breathe + this.flash * 0.05, 1 + breathe + this.flash * 0.05);
      ctx.fillStyle = '#7a3d1d'; ctx.beginPath(); ctx.arc(0, 0, R, 0, TAU); ctx.fill();
      ctx.fillStyle = `rgb(${241},${228 - this.flash * 30 | 0},${200 - this.flash * 90 | 0})`;
      ctx.beginPath(); ctx.arc(0, 0, Ri, 0, TAU); ctx.fill();
      // the 12 strokes of the cycle around the frame
      const playing = Engine.running && Engine.audible;
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * TAU - Math.PI / 2;
        const on = playing && i === this.lit && t - this.litT < 0.25;
        ctx.fillStyle = on ? '#f2cf7c' : i % 3 === 0 ? '#e0a93b' : 'rgba(241,228,200,.55)';
        ctx.beginPath(); ctx.arc(Math.cos(a) * (R + Ri) / 2, Math.sin(a) * (R + Ri) / 2, on ? 2.6 : 1.5, 0, TAU); ctx.fill();
      }
      // jingles: idle drift, shiver on hits
      const spin = reduced ? 0 : t * 0.35;
      ctx.lineWidth = 1.1;
      for (let i = 0; i < 10; i++) {
        const a = (i / 10) * TAU + spin;
        const wob = reduced ? 0 : Math.sin(t * (25 + i * 3) + i) * this.energy * 2;
        ctx.strokeStyle = '#a8864e';
        ctx.beginPath(); ctx.ellipse(Math.cos(a) * Ri * 0.8 + wob, Math.sin(a) * Ri * 0.8, 2.6, 1.5, a + wob * 0.3, 0, TAU); ctx.stroke();
      }
      ctx.fillStyle = playing ? '#d0623a' : '#1f4aa8';
      if (playing) { ctx.fillRect(-5, -6, 3.5, 12); ctx.fillRect(1.5, -6, 3.5, 12); }
      else { ctx.beginPath(); ctx.moveTo(-3.5, -6); ctx.lineTo(6, 0); ctx.lineTo(-3.5, 6); ctx.closePath(); ctx.fill(); }
    }
  }

  // ---------- usul ring (level 2) ----------
  function buildUsul() {
    const NS = 'http://www.w3.org/2000/svg';
    const dotsG = $('#usul-dots'), arcsG = $('#usul-arcs');
    if (!dotsG) return null;
    const RAD = 118;
    const pos = (i, r = RAD) => {
      const a = (i / 12) * TAU - Math.PI / 2;
      return [Math.cos(a) * r, Math.sin(a) * r];
    };
    const arcs = [];
    for (let g = 0; g < 4; g++) {
      const [x1, y1] = pos(g * 3 - 0.3, 146), [x2, y2] = pos(g * 3 + 2.3, 146);
      const p = document.createElementNS(NS, 'path');
      p.setAttribute('d', `M${x1.toFixed(1)} ${y1.toFixed(1)} A146 146 0 0 1 ${x2.toFixed(1)} ${y2.toFixed(1)}`);
      p.setAttribute('class', 'usul-arc');
      arcsG.appendChild(p); arcs.push(p);
    }
    const dots = TOY.map((key, i) => {
      const s = BY_KEY[key];
      const [x, y] = pos(i);
      const g = document.createElementNS(NS, 'g');
      g.setAttribute('class', 'usul-dot');
      g.setAttribute('transform', `translate(${x.toFixed(1)} ${y.toFixed(1)})`);
      const fill = s.kind === 'bum' ? '#e0a93b' : s.syl === 'ta' ? '#d0623a' : '#2fb7b0';
      g.innerHTML = `<circle class="halo" r="16"/><circle class="core" r="${s.kind === 'bum' ? 17 : 14}" fill="${fill}"/>` +
        (s.syl ? `<text text-anchor="middle" dy="4.5">${s.syl}</text>` : '');
      dotsG.appendChild(g);
      return g;
    });
    const center = $('#usul-center'), sub = $('#usul-center-sub');
    return {
      beat(i) {
        const halo = dots[i].firstChild;
        if (halo.animate && !reduced) {
          halo.animate([{ opacity: 1, transform: 'scale(.6)' }, { opacity: 0, transform: 'scale(2.6)' }], { duration: 700, easing: 'ease-out' });
        }
        arcs.forEach((a, g) => a.classList.toggle('on', g === Math.floor(i / 3)));
        const s = BY_KEY[TOY[i]];
        center.textContent = s.syl || 'bum';
        sub.textContent = `${s.name} · ${s.hand}`;
      },
      reset() {
        arcs.forEach((a) => a.classList.remove('on'));
        center.textContent = "to'y"; sub.textContent = '12 strokes';
      },
    };
  }

  // ---------- timing strip (level 3) ----------
  function buildTiming() {
    const svg = $('#timing-svg');
    if (!svg) return null;
    const NS = 'http://www.w3.org/2000/svg';
    const X0 = 60, PX = 1080 / (6 * STEP), AXIS = 150; // two groups across the strip
    const mk = (tag, attrs, parent = svg) => {
      const el = document.createElementNS(NS, tag);
      for (const k in attrs) el.setAttribute(k, attrs[k]);
      parent.appendChild(el); return el;
    };
    for (let k = 0; k <= 6; k++) mk('line', { class: 'grid-line', x1: X0 + k * STEP * PX, x2: X0 + k * STEP * PX, y1: 70, y2: 210 });
    mk('line', { class: 'axis', x1: X0 - 30, x2: X0 + 6 * STEP * PX + 30, y1: AXIS, y2: AXIS });
    const strokes = [0, 1, 2, 3, 4, 5, 6].map((k) => BY_KEY[TOY[k % 3]]);
    const marks = strokes.map((s, k) => {
      const g = mk('g', { class: 'mark' });
      const col = s.kind === 'bum' ? '#e0a93b' : s.syl === 'ta' ? '#d0623a' : '#2fb7b0';
      g.style.color = col;
      if (k === 6) g.style.opacity = '.35';
      mk('line', { class: 'stem', x1: 0, x2: 0, y1: -70, y2: -24 }, g);
      mk('circle', { class: 'core', r: s.kind === 'bum' ? 26 : 22, fill: col }, g);
      if (s.syl) mk('text', { 'text-anchor': 'middle', dy: 9 }, g).textContent = s.syl;
      return g;
    });
    const brackets = [0, 1, 2, 3, 4, 5].map((k) => ({
      path: mk('path', { class: 'gap-bracket' + (k % 3 === 1 ? ' tight' : '') }),
      label: mk('text', { class: 'gap-label' + (k % 3 === 1 ? ' tight' : ''), 'text-anchor': 'middle', y: 262 }),
    }));
    const head = mk('line', { class: 'playhead', y1: 60, y2: 220, x1: X0, x2: X0, opacity: 0 });

    let m = 1, target = 1, lastDrawnM = -1;
    const times = (mm) => {
      const o = groupOffsets(mm);
      return [o[0], o[1], o[2], 3 * STEP + o[0], 3 * STEP + o[1], 3 * STEP + o[2], 6 * STEP];
    };
    function layout() {
      const ts = times(m);
      ts.forEach((tt, k) => marks[k].setAttribute('transform', `translate(${(X0 + tt * PX).toFixed(2)} ${AXIS})`));
      brackets.forEach((b, k) => {
        const xa = X0 + ts[k] * PX + 4, xb = X0 + ts[k + 1] * PX - 4;
        b.path.setAttribute('d', `M${xa.toFixed(1)} 222 v8 H${xb.toFixed(1)} v-8`);
        b.label.setAttribute('x', ((xa + xb) / 2).toFixed(1));
        b.label.textContent = `${Math.round((ts[k + 1] - ts[k]) * 1000)} ms`;
      });
    }
    layout();

    $$('#timing [data-mode]').forEach((btn) => btn.addEventListener('click', () => {
      Engine.mode = btn.dataset.mode;
      $$('#timing [data-mode]').forEach((b) => b.setAttribute('aria-checked', String(b === btn)));
      target = Engine.mode === 'real' ? 1 : 0;
    }));

    return {
      beat(i) {
        const k = i % 6;
        const el = marks[k];
        el.classList.add('on');
        setTimeout(() => el.classList.remove('on'), 140);
      },
      frame(dt) {
        m += (target - m) * (reduced ? 1 : 1 - Math.exp(-dt * 7));
        if (Math.abs(target - m) < 0.001) m = target;
        if (m !== lastDrawnM) { layout(); lastDrawnM = m; }
        const show = Engine.running && !Engine.blind;
        head.setAttribute('opacity', show ? 1 : 0);
        if (show) {
          const ph = Engine.phase() % (6 * STEP);
          const x = (X0 + ph * PX).toFixed(1);
          head.setAttribute('x1', x); head.setAttribute('x2', x);
        }
      },
    };
  }

  // ---------- nine strokes list ----------
  function buildStrokes() {
    const ul = $('#stroke-grid');
    if (!ul) return;
    ul.innerHTML = STROKES.map((s) => {
      const col = s.hand === 'main' ? '#d0623a' : '#1f4aa8';
      let mark;
      if (s.kind === 'bum') mark = `<circle cx="20" cy="20" r="${s.small ? 4 : 7}" fill="${col}"/>`;
      else if (s.kind === 'bak') mark = `<circle cx="${s.hand === 'main' ? 33 : 7}" cy="20" r="${s.small ? 2.6 : 4.2}" fill="${col}"/>`;
      else mark = `<path d="M9 13 q-3 7 0 14" fill="none" stroke="${col}" stroke-width="2.4" stroke-linecap="round"/>`;
      const syl = s.syl ? `<span class="stroke-syl syl-${s.syl}">${s.syl}</span>` : '<span class="stroke-syl none">no syllable</span>';
      return `<li><button type="button" class="stroke" data-key="${s.key}" aria-label="Play ${s.name}, ${s.hand} hand">
        <svg class="stroke-glyph" viewBox="0 0 40 40" aria-hidden="true"><circle cx="20" cy="20" r="18" fill="#f1e4c8" stroke="#7a3d1d" stroke-width="3"/>${mark}</svg>
        <span class="stroke-name">${s.name}<span class="stroke-hand">${s.hand} hand</span></span>${syl}</button></li>`;
    }).join('');
    ul.addEventListener('click', (e) => {
      const b = e.target.closest('.stroke');
      if (!b) return;
      hit(b.dataset.key, { list: true });
      b.classList.remove('hit'); void b.offsetWidth; b.classList.add('hit');
    });
  }

  // ---------- data visuals ----------
  function buildDots() {
    // Shown per 100 strokes, so the two panels compare like with like.
    [['#dots-isolated', 0.95, 11], ['#dots-phrase', 0.48, 29]].forEach(([sel, rate, seed]) => {
      const box = $(sel);
      if (!box) return;
      const rnd = seeded(seed);
      const n = 100, hits = Math.round(rate * n);
      const order = Array.from({ length: n }, (_, i) => i).sort(() => rnd() - 0.5);
      const miss = new Set(order.slice(hits));
      const phrase = sel === '#dots-phrase';
      box.innerHTML = Array.from({ length: n }, (_, i) => {
        const jit = phrase ? `--jx:${((rnd() - 0.5) * 6).toFixed(1)}px;--jy:${((rnd() - 0.5) * 6).toFixed(1)}px;` : '';
        const cls = miss.has(i) ? (phrase ? 'miss' : 'wrong') : '';
        return `<i class="${cls}" style="--i:${i};${jit}"></i>`;
      }).join('');
      box.style.gridTemplateColumns = 'repeat(10, minmax(0, 1fr))';
      box.setAttribute('role', 'img');
      box.setAttribute('aria-label', `${hits} of every 100 strokes named correctly`);
    });
    $$('.ticks').forEach((box) => {
      const total = +(box.dataset.total || 100), lit = +box.dataset.lit;
      box.style.setProperty('--tone', `var(--${box.dataset.tone})`);
      box.setAttribute('role', 'img');
      box.setAttribute('aria-label', `${lit} of ${total}`);
      box.innerHTML = Array.from({ length: total }, (_, i) => `<i class="${i < lit ? 'lit' : ''}" style="--i:${i}"></i>`).join('');
    });
  }

  function setupReveal() {
    const ro = new IntersectionObserver((entries) => {
      entries.forEach((e) => { if (e.isIntersecting) { e.target.classList.add('in'); ro.unobserve(e.target); } });
    }, { threshold: 0.25 });
    $$('[data-reveal]').forEach((el) => ro.observe(el));
  }

  // ---------- listening game ----------
  function setupGame() {
    const play = $('#game-play'), guess = $('#game-guess'), text = $('#game-text'), score = $('#game-score');
    if (!play) return;
    let answer = null, right = 0, tries = 0;
    play.addEventListener('click', () => {
      answer = Math.random() < 0.5 ? 'real' : 'even';
      guess.hidden = true;
      play.disabled = true;
      $('.label', play).textContent = 'Listening…';
      text.textContent = 'Two to\'y cycles. Listen to the baks.';
      Sound.unlock().then(() => {
        Engine.start({
          audible: true, blind: true, mode: answer, cycles: 2,
          onEnd: () => {
            play.disabled = false;
            $('.label', play).textContent = 'Play another clip';
            text.textContent = 'Real player, or even machine timing?';
            guess.hidden = false;
            $('button', guess).focus();
            ghostCheck();
          },
        });
      });
    });
    guess.addEventListener('click', (e) => {
      const b = e.target.closest('[data-guess]');
      if (!b || !answer) return;
      tries++;
      const ok = b.dataset.guess === answer;
      if (ok) right++;
      text.textContent = `${ok ? 'Right.' : 'Not this time.'} That clip was ${answer === 'real' ? 'real-player timing' : 'even timing'}.`;
      score.textContent = `Your score: ${right} of ${tries}`;
      guess.hidden = true;
      answer = null;
    });
  }

  // ---------- scroll-driven variables ----------
  function setupScrollVars() {
    const els = $$('[data-scroll]');
    let queued = false;
    const update = () => {
      queued = false;
      const vh = window.innerHeight;
      for (const el of els) {
        const r = el.getBoundingClientRect();
        if (r.bottom < -100 || r.top > vh + 100) continue;
        el.style.setProperty('--p', clamp((vh - r.top) / (vh + r.height)).toFixed(3));
      }
    };
    window.addEventListener('scroll', () => { if (!queued) { queued = true; requestAnimationFrame(update); } }, { passive: true });
    window.addEventListener('resize', update);
    update();
  }

  // ---------- keyboard: B = bum, K = bak ----------
  window.addEventListener('keydown', (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey || e.repeat) return;
    if (e.target.closest && e.target.closest('input, textarea, select')) return;
    const k = e.key.toLowerCase();
    if (k === 'b') hit('bum_main', { drum: true });
    if (k === 'k') hit('bak_main', { drum: true });
  });
  $$('.drum-key').forEach((b) => b.addEventListener('click', () => hit(b.dataset.stroke, { drum: true })));

  // ---------- wire it together ----------
  const hero = $('#drum-canvas') ? new HeroDrum($('#drum-canvas')) : null;
  const girihs = $$('canvas[data-girih]').map((c) => new Girih(c, c.dataset.girih));
  const rain = $('#rain') ? new Rain($('#rain')) : null;
  const ambient = new Ambient($('#ambient'));
  const usul = buildUsul();
  const timing = buildTiming();
  buildStrokes();
  buildDots();
  setupReveal();
  setupGame();
  setupScrollVars();

  const readout = $('#drum-readout'), hint = $('#drum-hint');
  bus.on('hit', ({ stroke, from }) => {
    if (from && from.drum && hero) {
      hero.strike(stroke, from.x !== undefined ? from : null);
      readout.textContent = `${stroke.name} · ${stroke.hand} hand${stroke.syl ? ' · ' + stroke.syl : ''}`;
      hint.classList.add('used');
    }
    ambient.hit(stroke);
    girihs.forEach((g) => g.pulse(stroke.kind === 'bum' ? 1 : 0.6));
  });
  bus.on('beat', ({ i, stroke, blind }) => {
    if (usul) usul.beat(i);
    if (timing && !blind) timing.beat(i);
    if (rain) rain.beat(stroke, i);
    ambient.hit(stroke, i);
    girihs.forEach((g) => g.pulse(i % 3 === 0 ? (i === 0 ? 1.2 : 0.8) : 0.35));
  });
  bus.on('engine', () => { if (!Engine.running && usul) usul.reset(); });

  // Fetch the recordings once the page is idle (bytes only, nothing plays).
  (window.requestIdleCallback || ((f) => setTimeout(f, 1200)))(() => Sound.prefetch());

  let last = nowSec();
  function frame() {
    const t = nowSec();
    const dt = Math.min(0.05, t - last);
    last = t;
    // read layout first, then write, so no frame forces a second layout
    for (const g of girihs) if (visible.get(g.c)) g.p = g.progress();
    Engine.flush();
    if (hero && visible.get(hero.c)) hero.draw(t, dt);
    for (const g of girihs) if (visible.get(g.c)) g.draw(t);
    if (rain && visible.get(rain.c)) rain.draw(t, dt);
    ambient.draw(t, dt);
    if (timing) timing.frame(dt);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  // Redraw static canvases when reduced motion is switched on mid-visit.
  if (mq.addEventListener) mq.addEventListener('change', ghostCheck);
})();
