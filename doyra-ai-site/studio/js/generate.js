// Generate: new doira playing, live, with no song.
//
// Two sources:
//   recorded  Whole usul cycles cut from Doniyor's free playing (generate/*.m4a,
//             built by doyra_v2/generator/build_studio_assets.py). The next cycle is chosen
//             while the last one plays. A cycle is never cut inside, so every
//             stroke and pause in it is his; only the joins are new.
//   pattern   The usul as taught (usuls.js), with the measured feel, played with
//             strokes cut from his taught recordings. Tempo is free.
//
// Everything is scheduled on the audio clock ~0.6 s ahead, so timing never
// depends on the page. Every planned cycle is kept, so "Save" renders exactly
// the take that was heard.
import { audioContext } from './engine/audio.js';
import { USULS, STROKES, DEFAULT_GAP } from './usuls.js';
import { cyclePositions, feelAmount } from './patterns.js';

const BASE = new URL('../generate/', import.meta.url);
const LOOKAHEAD = 0.6;   // seconds planned and scheduled ahead
const TICK = 40;         // ms between scheduler runs
const XF_IN = 0.008;     // fade-in of a cycle (its cut sits 12 ms before the first stroke)
const XF_OUT = 0.03;     // the previous cycle rings 30 ms into the next and fades
const PRE = 0.003;       // stroke takes start 3 ms before their attack
const CHOKE = 0.012;     // a stroke is stopped 12 ms after the next one starts, as a hand would

export const GEN_USULS = ['toy', 'u1', 'u3', 'u4', 'u5', 'u6'];
export const BLIND_TESTED = new Set(['toy', 'u3', 'u4', 'u6']); // November 2026 teacher test

// ---------------------------------------------------------------- loading

let dataP = null;
export function loadData() {
  if (!dataP) {
    dataP = fetch(new URL('generate.json', BASE)).then((r) => {
      if (!r.ok) throw new Error(`generate.json: ${r.status}`);
      return r.json();
    }).then(prepareData);
    dataP.catch(() => { dataP = null; });
  }
  return dataP;
}

const skel = (typ) => typ.replace(/[Ls]/g, ''); // beat type without loudness marks

function prepareData(d) {
  for (const u of Object.values(d.usuls)) {
    // junctions he played, by stroke types (loudness marks ignored)
    u.seenSet = new Set();
    for (let i = 0; i + 1 < u.cycles.length; i++) {
      const a = u.cycles[i], b = u.cycles[i + 1];
      if (b.idx === a.idx + u.per) u.seenSet.add(`${skel(a.last)}>${skel(b.first)}`);
    }
    const gaps = [];
    u.cycles.forEach((c) => { for (let i = 1; i < c.s.length; i++) gaps.push(c.s[i][0] - c.s[i - 1][0]); });
    gaps.sort((x, y) => x - y);
    u.strokeGap = gaps.length ? gaps[gaps.length >> 1] : DEFAULT_GAP;
    u.cycleDur = median(u.cycles.map((c) => c.b - c.a));
    u.minutes = (u.cycles[u.cycles.length - 1].b - u.cycles[0].a) / 60;
  }
  return d;
}

const clips = new Map();
// Decode a file and measure the codec delay: the builder stored where the
// first attack is; the decoded copy may start a little later or earlier.
function loadClip(file, firstAttack, searchSec) {
  if (!clips.has(file)) {
    const p = (async () => {
      const ctx = audioContext();
      const r = await fetch(new URL(file, BASE));
      if (!r.ok) throw new Error(`${file}: ${r.status}`);
      const bytes = await r.arrayBuffer();
      const buf = await new Promise((res, rej) => ctx.decodeAudioData(bytes, res, rej));
      const x = buf.getChannelData(0), n = Math.min(x.length, Math.round(searchSec * buf.sampleRate));
      let pk = 0;
      for (let i = 0; i < n; i++) pk = Math.max(pk, Math.abs(x[i]));
      let i = 0;
      while (i < n && Math.abs(x[i]) < 0.1 * pk) i++;
      const shift = i / buf.sampleRate - firstAttack;
      return { buf, shift: Math.abs(shift) < 0.08 ? shift : 0 };
    })();
    clips.set(file, p);
    p.catch(() => clips.delete(file));
  }
  return clips.get(file);
}

// ---------------------------------------------------------------- randomness

function rngFrom(seed) { // mulberry32
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const gumbel = (rng) => -Math.log(-Math.log(Math.min(1 - 1e-9, Math.max(1e-9, rng()))));
const gauss = (rng) => Math.sqrt(-2 * Math.log(Math.max(1e-9, rng()))) * Math.cos(2 * Math.PI * rng());
function median(a) { const s = [...a].sort((x, y) => x - y); return s.length ? s[s.length >> 1] : 0; }
const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));

// Loudness wanted for cycle k, relative to his median cycle (1 = typical).
function energyTarget(u, opts, k, start) {
  const L = u.sortedLoud || (u.sortedLoud = u.cycles.map((c) => c.loud).sort((x, y) => x - y));
  const q = (p) => L[clamp(Math.floor(p * L.length), 0, L.length - 1)];
  switch (opts.energy) {
    case 'calm': return q(0.2);
    case 'full': return q(0.85);
    case 'build': return q(0.1 + 0.85 * ((k % 16) / 15)); // rises over 16 cycles, then starts again
    default: return u.cycles[(start + k) % u.cycles.length].loud; // his own phrase shape
  }
}

// ---------------------------------------------------------------- recorded

class RecordedPlan {
  constructor(id, u, opts, rng) {
    Object.assign(this, { id, u, opts, rng, t: 0, k: 0, hist: [], joins: 0 });
    this.start = Math.floor(rng() * u.cycles.length);
  }

  cost(j, prevJ, target) {
    const c = this.u.cycles, x = c[j];
    let cost = Math.abs(Math.log(x.loud / target)) * 3;
    if (prevJ >= 0) {
      const p = c[prevJ];
      const cont = x.idx === p.idx + this.u.per;
      if (cont) cost += this.opts.variation === 'steady' ? -1.2 : 0.8;
      else {
        cost += this.u.seenSet.has(`${skel(p.last)}>${skel(x.first)}`) ? 0 : 1.5; // a join he plays
        cost += Math.abs(Math.log((x.l0 + 0.02) / (p.l1 + 0.02))) * 1.2;        // loudness across the join
        cost += Math.abs(Math.log((x.b - x.a) / (p.b - p.a))) * 6;              // tempo across the join
      }
      if (this.hist.slice(-6).includes(j)) cost += 3;
    }
    return cost + gumbel(this.rng) * 0.4;
  }

  next() {
    const c = this.u.cycles, prevJ = this.hist.length ? this.hist[this.hist.length - 1] : -1;
    const target = energyTarget(this.u, this.opts, this.k, this.start);
    let best = 0, bc = Infinity;
    for (let j = 0; j < c.length; j++) {
      const v = this.cost(j, prevJ, target);
      if (v < bc) { bc = v; best = j; }
    }
    const x = c[best], dur = x.b - x.a;
    const newJoin = prevJ >= 0 && x.idx !== c[prevJ].idx + this.u.per;
    if (newJoin) this.joins++;
    const item = {
      kind: 'recorded', k: this.k, at: this.t, dur, from: x.a, loud: x.loud, newJoin, cycle: best,
      strokes: x.s.map(([tt, code, amp], i) => ({ time: this.t + tt, code, gain: amp, b: i })),
      beads: x.s.map(([tt, code]) => ({ code, pos: tt / dur })),
    };
    this.hist.push(best);
    this.t += dur;
    this.k++;
    return item;
  }
}

// ---------------------------------------------------------------- pattern

class PatternPlan {
  constructor(id, u, d, opts, rng) {
    Object.assign(this, { id, u, d, opts, rng, t: 0, k: 0, joins: 0 });
    this.start = Math.floor(rng() * d.cycles.length);
  }

  baseGap() { return this.u.meanGap || this.d.cycleDur / this.u.seq.length; } // no measured gap: one taught cycle per recorded cycle
  gap() { return this.baseGap() * 100 / this.opts.tempo; }

  next() {
    const { u, opts, rng } = this, n = u.seq.length, gap = this.gap();
    const player = opts.feel === 'player';
    const amount = player ? feelAmount(u, gap) : 0;
    const pos = cyclePositions(u, amount), dur = n * gap;
    const level = clamp(Math.pow(energyTarget(this.d, opts, this.k, this.start), 0.6), 0.5, 1.2) * 0.85;
    let strokes = pos.map((p, i) => {
      const code = u.seq[i];
      return {
        time: this.t + p * dur + (player && i ? gauss(rng) * 0.004 : 0),
        code, b: i, p,
        gain: STROKES[code].gain * level * (i === 0 ? 1.12 : 1) * (player ? 1 + (rng() - 0.5) * 0.12 : 1),
      };
    });
    let fill = null;
    if (opts.variation === 'varied') {
      if (this.k % 8 === 7) {
        // rez: a roll of alternating hands over the end of the cycle, rising into the next phrase
        fill = 'rez';
        const from = 0.6;
        strokes = strokes.filter((s) => s.p < from);
        const step = gap / 2, t0 = this.t + from * dur, t1 = this.t + dur - step * 0.75;
        let i = 0;
        for (let tt = t0; tt <= t1; tt += step, i++) {
          const f = (tt - t0) / Math.max(1e-3, t1 - t0);
          const code = i % 2 ? 't' : 'K';
          strokes.push({ time: tt + (player ? gauss(rng) * 0.003 : 0), code, b: -1, gain: STROKES[code].gain * level * (0.45 + 0.6 * f) });
        }
      } else if (this.k % 4 === 3) {
        // a grace stroke from the other hand between two strokes
        const cand = [];
        for (let i = 1; i + 1 < strokes.length; i++) {
          if (STROKES[strokes[i].code].kind === 'bak' && strokes[i + 1].time - strokes[i].time > gap * 0.85) cand.push(i);
        }
        if (cand.length) {
          fill = 'grace';
          const i = cand[Math.floor(rng() * cand.length)], s = strokes[i];
          const code = STROKES[s.code].hand === 'main' ? 't' : 'K';
          strokes.push({ time: (s.time + strokes[i + 1].time) / 2, code, b: -1, gain: STROKES[code].gain * level * 0.55 });
        }
      }
    }
    strokes.sort((x, y) => x.time - y.time);
    const item = {
      kind: 'pattern', k: this.k, at: this.t, dur, fill, loud: level / 0.85, newJoin: !!fill,
      strokes: strokes.map(({ time, code, gain, b }) => ({ time, code, gain, b })),
      beads: pos.map((p, i) => ({ code: u.seq[i], pos: p })),
      gap, feel: amount,
    };
    if (fill) this.joins++;
    this.t += dur;
    this.k++;
    return item;
  }
}

// ---------------------------------------------------------------- the generator

export class Generator {
  constructor() {
    this.ctx = audioContext();
    this.opts = { usul: 'u4', source: 'recorded', energy: 'him', variation: 'steady', tempo: 100, feel: 'player' };
    this.playing = false;
    this.items = [];
    this.visual = [];
    this.sources = [];
    this.lastTake = { u: {} };
  }

  async prepare(opts = this.opts) {
    const data = await loadData();
    const s = data.strokes;
    const jobs = [loadClip(s.file, s.firstAttack, 0.65)];
    if (opts.source === 'recorded') { const u = data.usuls[opts.usul]; jobs.push(loadClip(u.file, u.firstAttack, Infinity)); }
    const [sprite, clip] = await Promise.all(jobs);
    this.data = data;
    this.sprite = sprite;
    if (!this.takesByCode) {
      this.takesByCode = {};
      s.takes.forEach((t) => (this.takesByCode[t.code] = this.takesByCode[t.code] || []).push(t));
    }
    return { data, sprite, clip };
  }

  usulData(id = this.opts.usul) { return this.data && this.data.usuls[id]; }

  makePlan(opts, seed) {
    const rng = rngFrom(seed), d = this.data.usuls[opts.usul];
    return opts.source === 'recorded' ? new RecordedPlan(opts.usul, d, opts, rng) : new PatternPlan(opts.usul, USULS[opts.usul], d, opts, rng);
  }

  async play() {
    const ctx = audioContext();
    const { clip } = await this.prepare();
    this.stop();
    this.clip = clip;
    this.seed = (Math.random() * 2 ** 32) >>> 0;
    this.plan = this.makePlan(this.opts, this.seed);
    this.planOpts = { ...this.opts };
    this.items = [];
    this.visual = [];
    this.bus = ctx.createGain();
    this.bus.connect(ctx.destination);
    this.t0 = ctx.currentTime + 0.12;
    this.playing = true;
    this.timer = setInterval(() => this.schedule(), TICK);
    this.schedule();
  }

  stop() {
    if (!this.playing) return;
    this.playing = false;
    clearInterval(this.timer);
    const ctx = this.ctx, bus = this.bus, now = ctx.currentTime;
    bus.gain.setValueAtTime(bus.gain.value, now);
    bus.gain.linearRampToValueAtTime(0, now + 0.08);
    const srcs = this.sources;
    this.sources = [];
    setTimeout(() => { srcs.forEach((s) => { try { s.stop(); } catch (e) { /* done */ } }); bus.disconnect(); }, 150);
    // what was heard stays saveable
    const heard = this.elapsed;
    this.lastTake = { items: this.items.filter((it) => it.at < heard), length: heard, opts: this.planOpts, clip: this.clip, seed: this.seed };
    this.visual = [];
  }

  // Change settings. Usul or source: a new take starts. Others shape the next cycles.
  async set(change) {
    const restart = ('usul' in change && change.usul !== this.opts.usul) || ('source' in change && change.source !== this.opts.source);
    Object.assign(this.opts, change);
    if (this.playing) {
      if (restart) await this.play();
      else Object.assign(this.plan.opts, change);
    }
  }

  get elapsed() { return this.playing ? Math.max(0, this.ctx.currentTime - this.t0) : 0; }

  get joins() { return this.plan ? this.plan.joins : 0; }

  schedule() {
    if (!this.playing) return;
    const ahead = this.ctx.currentTime - this.t0 + LOOKAHEAD;
    while (this.plan.t < ahead) {
      const it = this.plan.next();
      this.items.push(it);
      this.sources.push(...this.scheduleItem(this.ctx, this.bus, it, this.t0, this.clip));
      it.strokes.forEach((s) => this.visual.push({ ...s, k: it.k }));
    }
    const now = this.ctx.currentTime;
    if (this.sources.length > 400) this.sources = this.sources.filter((s) => s.endsAt > now);
  }

  // Strokes due now (for the drum), and the cycle being heard.
  poll() {
    if (!this.playing) return { strokes: [], item: null };
    const now = this.elapsed, out = [];
    while (this.visual.length && this.visual[0].time <= now) out.push(this.visual.shift());
    let item = null;
    for (let i = this.items.length - 1; i >= 0; i--) if (this.items[i].at <= now) { item = this.items[i]; break; }
    return { strokes: out, item };
  }

  scheduleItem(ctx, dest, it, t0, clip) {
    return it.kind === 'recorded' ? [this.scheduleCycle(ctx, dest, it, t0, clip)] : this.scheduleStrokes(ctx, dest, it, t0);
  }

  // One whole recorded cycle; it rings XF_OUT into the next one.
  scheduleCycle(ctx, dest, it, t0, clip) {
    const start = t0 + it.at, now = ctx.currentTime, late = Math.max(0, now - start);
    const src = ctx.createBufferSource();
    src.buffer = clip.buf;
    const g = ctx.createGain();
    if (it.k > 0) { g.gain.setValueAtTime(0, start); g.gain.linearRampToValueAtTime(1, start + XF_IN); }
    else g.gain.setValueAtTime(1, start);
    g.gain.setValueAtTime(1, start + it.dur);
    g.gain.linearRampToValueAtTime(0, start + it.dur + XF_OUT);
    src.connect(g).connect(dest);
    src.start(start + late, it.from + clip.shift + late, Math.max(0.01, it.dur + XF_OUT - late));
    src.endsAt = start + it.dur + XF_OUT;
    return src;
  }

  // Taught pattern: one take per stroke, stopped by the next stroke.
  scheduleStrokes(ctx, dest, it, t0) {
    const out = [], S = it.strokes, sprite = this.sprite;
    this.lastPick = this.lastPick || {};
    for (let i = 0; i < S.length; i++) {
      const s = S[i];
      const code = this.takesByCode[s.code] ? s.code : STROKES[s.code].kind === 'bum' ? 'M' : STROKES[s.code].hand === 'main' ? 'K' : 't';
      const takes = this.takesByCode[code];
      let j = Math.floor(Math.random() * takes.length);
      if (takes.length > 1 && j === this.lastPick[code]) j = (j + 1) % takes.length;
      this.lastPick[code] = j;
      const take = takes[j];
      const when = t0 + s.time, start = when - PRE;
      const nextT = t0 + (i + 1 < S.length ? S[i + 1].time : it.at + it.dur);
      const ring = Math.max(0.03, Math.min(take.dur, nextT - start + CHOKE));
      const late = Math.max(0, ctx.currentTime - start);
      if (late >= ring) continue;
      const src = ctx.createBufferSource();
      src.buffer = sprite.buf;
      const g = ctx.createGain();
      g.gain.setValueAtTime(s.gain, Math.max(0, start));
      g.gain.setValueAtTime(s.gain, Math.max(0, start + ring - 0.012));
      g.gain.linearRampToValueAtTime(0, start + ring);
      src.connect(g).connect(dest);
      src.start(start + late, take.at + sprite.shift + late, ring - late);
      src.endsAt = start + ring;
      out.push(src);
    }
    return out;
  }

  // ---------------------------------------------------------------- save

  // The take that was heard (up to 5 min), or a fresh minute if nothing was played yet.
  async render() {
    const MAX = 300;
    let items, length, opts, clip;
    if (this.playing) {
      length = this.elapsed;
      items = this.items.filter((it) => it.at < length);
      opts = this.planOpts; clip = this.clip;
    } else if (this.lastTake.items && this.lastTake.items.length && this.lastTake.length > 2) {
      ({ items, length, opts, clip } = this.lastTake);
    } else {
      const r = await this.prepare();
      opts = { ...this.opts }; clip = r.clip; length = 60;
      const plan = this.makePlan(opts, (Math.random() * 2 ** 32) >>> 0);
      items = [];
      while (plan.t < length) items.push(plan.next());
    }
    length = Math.min(Math.max(length, 2), MAX);
    if (opts.source === 'recorded' && !clip) clip = (await this.prepare(opts)).clip;
    const SR = 44100, tail = 0.4;
    const off = new OfflineAudioContext(1, Math.ceil((length + tail) * SR), SR);
    const bus = off.createGain();
    bus.connect(off.destination);
    bus.gain.setValueAtTime(1, Math.max(0, length - 1.2));
    bus.gain.linearRampToValueAtTime(0, length + tail * 0.5);
    for (const it of items) if (it.at < length) this.scheduleItem(off, bus, it, 0, clip);
    const buf = await off.startRendering();
    const x = buf.getChannelData(0);
    let pk = 0;
    for (let i = 0; i < x.length; i++) pk = Math.max(pk, Math.abs(x[i]));
    const norm = pk > 0 ? 0.89 / pk : 1; // -1 dBFS
    return { blob: wavBlob(x, SR, norm), seconds: length, opts };
  }
}

function wavBlob(x, sr, gain) {
  const n = x.length, buf = new ArrayBuffer(44 + n * 2), v = new DataView(buf);
  const w = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  w(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); w(8, 'WAVE'); w(12, 'fmt ');
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, sr, true); v.setUint32(28, sr * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  w(36, 'data'); v.setUint32(40, n * 2, true);
  for (let i = 0; i < n; i++) v.setInt16(44 + i * 2, clamp(x[i] * gain, -1, 1) * 32767, true);
  return new Blob([buf], { type: 'audio/wav' });
}
