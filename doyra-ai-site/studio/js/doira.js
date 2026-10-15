// The animated doira: skin ripples on bums, rim sparks on baks, the rings
// jingle, and the usul cycle as a bead string around the drum.
// Three colours only: ink, skin, gold (same as the landing page).
import { STROKES } from './usuls.js';

const TAU = Math.PI * 2;
const C = { ink: '#0a1430', skin: '#f1e4c8', gold: '#e0a93b' };
const rgba = (hex, a) => { const n = parseInt(hex.slice(1), 16); return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`; };
const reducedMQ = matchMedia('(prefers-reduced-motion: reduce)');

export class Doira {
  constructor(canvas, { orbit = true } = {}) {
    this.c = canvas;
    this.ctx = canvas.getContext('2d');
    this.orbit = orbit;
    this.ripples = []; this.sparks = []; this.words = [];
    this.energy = 0; this.kick = 0;
    this.beads = [];          // { code, pos (0..1 round the cycle), shown (0..1 fade) }
    this.lit = -1; this.litT = 0;
    this.progress = -1;       // 0..1 through the current cycle, -1 = hidden
    this.busy = false;        // "listening" while a song is analysed
    this.rings = Array.from({ length: 40 }, (_, i) => ({ a: (i / 40) * TAU, ph: Math.random() * TAU, f: 22 + Math.random() * 14 }));
    if ('ResizeObserver' in window) new ResizeObserver(() => this.fit()).observe(canvas);
    this.fit();
  }

  get reduced() { return reducedMQ.matches; }

  fit() {
    const r = this.c.getBoundingClientRect(), dpr = Math.min(2, devicePixelRatio || 1);
    this.c.width = Math.max(1, Math.round(r.width * dpr));
    this.c.height = Math.max(1, Math.round(r.height * dpr));
    this.dpr = dpr; this.w = r.width;
    this.R = (r.width / 2) * (this.orbit ? 0.74 : 0.78);
    this.Ri = this.R * 0.85;
  }

  // Bead positions round the cycle (0..1). Same count: beads glide; new usul: fade in.
  setBeads(list) {
    if (list.length === this.beads.length && list.every((b, i) => b.code === this.beads[i].code)) {
      list.forEach((b, i) => { this.beads[i].target = b.pos; });
    } else {
      this.beads = list.map((b) => ({ code: b.code, pos: b.pos, target: b.pos, shown: 0 }));
      this.lit = -1;
    }
  }

  // Angle on the drum for a position round the cycle; 0 = top.
  angleOf(pos) { return -Math.PI / 2 + TAU * pos; }

  // A stroke is heard. k = its bead (or undefined), at = {x, y} for a tap.
  strike(code, k, at) {
    const s = STROKES[code], t = performance.now() / 1000, R = this.R;
    if (k !== undefined) { this.lit = k; this.litT = t; }
    if (s.kind === 'bum') {
      const x = at ? at.x : 0, y = at ? at.y : 0;
      this.ripples.push({ x, y, t, life: s.small ? 1.1 : 1.6, speed: R * (s.small ? 0.8 : 1), w: R * (s.small ? 0.035 : 0.055), s: s.small ? 0.7 : 1 });
      this.kick = s.small ? 0.6 : 1;
      this.energy = Math.min(1.5, this.energy + 0.4);
    } else {
      const a = at ? Math.atan2(at.y, at.x) : k !== undefined && this.beads[k] ? this.angleOf(this.beads[k].pos) : -Math.PI / 4;
      const x = Math.cos(a) * this.Ri * 0.98, y = Math.sin(a) * this.Ri * 0.98;
      this.ripples.push({ x, y, t, life: 0.7, speed: R * 1.6, w: R * 0.02, s: 0.8 });
      this.energy = Math.min(1.8, this.energy + (s.small ? 0.7 : 1));
      if (!this.reduced) {
        for (let i = 0; i < (s.small ? 12 : 22); i++) {
          const sa = a + (Math.random() - 0.5) * 1.6, sp = R * (0.8 + Math.random() * 2);
          this.sparks.push({ x, y, vx: Math.cos(sa) * sp, vy: Math.sin(sa) * sp, t, life: 0.4 + Math.random() * 0.4 });
        }
      }
      if (s.syl) this.words.push({ text: s.syl, a, t });
    }
    if (this.ripples.length > 12) this.ripples.shift();
    if (this.sparks.length > 200) this.sparks.splice(0, this.sparks.length - 200);
    if (this.words.length > 8) this.words.shift();
  }

  // Which part of the drum a tap at (x, y) from the centre hits.
  hitTest(x, y) {
    const d = Math.hypot(x, y) / this.R;
    if (d > 1.05) return null;
    return d < 0.68 ? 'B' : x < 0 ? 't' : 'T';
  }

  draw(t, dt) {
    const { ctx, dpr, w, R, Ri } = this;
    if (!w) return;
    const reduced = this.reduced;
    this.kick *= Math.exp(-dt * 7);
    this.energy *= Math.exp(-dt * 2.6);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, w);
    ctx.translate(w / 2, w / 2);

    if (this.orbit) this.drawBeads(t, dt);

    const s = 1 + this.kick * 0.02;
    ctx.save(); ctx.scale(s, s);
    if (this.energy > 0.03) {
      const g = ctx.createRadialGradient(0, 0, R * 0.8, 0, 0, R * 1.25);
      g.addColorStop(0, rgba(C.gold, 0.25 * Math.min(1, this.energy))); g.addColorStop(1, rgba(C.gold, 0));
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, R * 1.25, 0, TAU); ctx.fill();
    }
    // frame
    ctx.fillStyle = C.gold;
    ctx.beginPath(); ctx.arc(0, 0, R, 0, TAU); ctx.arc(0, 0, Ri, 0, TAU, true); ctx.fill();
    ctx.fillStyle = rgba(C.ink, 0.25);
    ctx.beginPath(); ctx.arc(0, 0, R * 0.965, 0, TAU); ctx.arc(0, 0, Ri * 1.02, 0, TAU, true); ctx.fill();
    // skin
    ctx.save();
    ctx.beginPath(); ctx.arc(0, 0, Ri, 0, TAU); ctx.clip();
    ctx.fillStyle = C.skin; ctx.fillRect(-Ri, -Ri, Ri * 2, Ri * 2);
    const v = ctx.createRadialGradient(0, 0, Ri * 0.55, 0, 0, Ri);
    v.addColorStop(0, rgba(C.gold, 0)); v.addColorStop(1, rgba(C.gold, 0.35));
    ctx.fillStyle = v; ctx.fillRect(-Ri, -Ri, Ri * 2, Ri * 2);
    for (let i = this.ripples.length - 1; i >= 0; i--) {
      const rp = this.ripples[i], age = t - rp.t;
      if (age > rp.life) { this.ripples.splice(i, 1); continue; }
      const f = age / rp.life, fade = Math.pow(1 - f, 1.5) * rp.s;
      for (let j = 0; j < 3; j++) {
        const rr = rp.speed * age - j * rp.w * 2.2;
        if (rr <= 0) continue;
        ctx.lineWidth = rp.w * (1 - f * 0.5);
        ctx.strokeStyle = rgba(C.gold, fade * 0.45 * (1 - j * 0.3));
        ctx.beginPath(); ctx.arc(rp.x, rp.y, rr, 0, TAU); ctx.stroke();
      }
    }
    ctx.restore();
    // jingle rings; while "listening" they shimmer in a slow wave
    ctx.strokeStyle = C.gold;
    ctx.lineWidth = Math.max(1, R * 0.008);
    for (const ring of this.rings) {
      let wob = reduced ? 0 : Math.sin(t * ring.f + ring.ph) * this.energy;
      if (this.busy && !reduced) wob += Math.sin(t * 6 - ring.a * 3) * 0.35;
      const a = ring.a + wob * 0.015, rr = Ri * 0.93 + wob * R * 0.012;
      ctx.beginPath(); ctx.ellipse(Math.cos(a) * rr, Math.sin(a) * rr, R * 0.026, R * 0.015, a + wob * 0.6, 0, TAU); ctx.stroke();
    }
    ctx.restore();

    // sparks
    ctx.lineCap = 'round';
    for (let i = this.sparks.length - 1; i >= 0; i--) {
      const p = this.sparks[i], age = t - p.t;
      if (age > p.life) { this.sparks.splice(i, 1); continue; }
      p.vx *= Math.exp(-dt * 2.5); p.vy *= Math.exp(-dt * 2.5); p.vy += R * 1.2 * dt;
      p.x += p.vx * dt; p.y += p.vy * dt;
      const f = 1 - age / p.life;
      ctx.strokeStyle = rgba(C.gold, f); ctx.lineWidth = 1 + f * 2;
      ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x - p.vx * 0.03, p.y - p.vy * 0.03); ctx.stroke();
    }
    // ta / ka by the rim
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    for (let i = this.words.length - 1; i >= 0; i--) {
      const wd = this.words[i], age = t - wd.t;
      if (age > 0.9) { this.words.splice(i, 1); continue; }
      const f = age / 0.9, d = R * (1.04 + (reduced ? 0 : f * 0.1));
      ctx.globalAlpha = 1 - f;
      ctx.font = `700 ${R * 0.12}px Unbounded, sans-serif`;
      ctx.fillStyle = C.skin;
      ctx.fillText(wd.text, Math.cos(wd.a) * d, Math.sin(wd.a) * d);
    }
    ctx.globalAlpha = 1;
  }

  drawBeads(t, dt) {
    const { ctx, R } = this;
    const Ro = R * 1.22;
    ctx.strokeStyle = rgba(C.skin, 0.18); ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(0, 0, Ro, 0, TAU); ctx.stroke();
    if (this.busy && !this.reduced) { // listening: a slow gold arc travels round
      const a = t * 1.6;
      ctx.strokeStyle = rgba(C.gold, 0.6); ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(0, 0, Ro, a, a + 0.9); ctx.stroke();
    }
    if (this.progress >= 0) {
      ctx.strokeStyle = rgba(C.gold, 0.7); ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(0, 0, Ro, -Math.PI / 2, this.angleOf(this.progress)); ctx.stroke();
    }
    const glide = this.reduced ? 1 : 1 - Math.exp(-dt * 6);
    this.beads.forEach((b, i) => {
      b.pos += (b.target - b.pos) * glide;
      b.shown = Math.min(1, b.shown + dt * 3);
      const s = STROKES[b.code], a = this.angleOf(b.pos);
      const on = i === this.lit && t - this.litT < 0.35;
      const pulse = on ? 1 - (t - this.litT) / 0.35 : 0;
      const r = (s.kind === 'bum' ? R * 0.05 : R * 0.035) * (1 + pulse * 0.6);
      const x = Math.cos(a) * Ro, y = Math.sin(a) * Ro;
      ctx.globalAlpha = (0.55 + pulse * 0.45) * b.shown;
      ctx.fillStyle = s.kind === 'bum' ? C.skin : C.gold;
      ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill();
      if (on && !this.reduced) {
        ctx.strokeStyle = rgba(C.gold, pulse); ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(x, y, r + R * 0.06 * (1 - pulse), 0, TAU); ctx.stroke();
      }
    });
    ctx.globalAlpha = 1;
  }
}
