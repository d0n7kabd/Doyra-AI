// Song analysis: tempo, beats, downbeats, 16th-note grid and drum-activity windows.
// Pure functions on a mono Float32Array at ANALYSIS_SR; no browser APIs, so it
// runs in a Web Worker and in Node (tools/check_engine.mjs).
import { FFT } from './fft.js';

export const ANALYSIS_SR = 22050;
const N = 1024;              // FFT size (46 ms)
const HOP = 256;             // 11.6 ms between frames
const BANDS = {              // Hz
  low: [30, 160],            // kick
  mid: [160, 3500],          // snare, clap, body
  high: [5000, 11025],       // hi-hats, shakers
};
// Flux peaks trail the true attack slightly; measured with tools/check_engine.mjs
// against synthetic tracks with known onset times.
const ONSET_LATENCY = -0.0095;

export function analyzeSong(x, sr = ANALYSIS_SR) {
  if (sr !== ANALYSIS_SR) throw new Error(`analyzeSong expects ${ANALYSIS_SR} Hz audio`);
  const fps = sr / HOP;
  const spec = spectralFeatures(x, sr);
  const low = normalizeEnv(spec.low, fps);
  const mid = normalizeEnv(spec.mid, fps);
  const high = normalizeEnv(spec.high, fps);
  const onset = new Float32Array(spec.n);
  for (let t = 0; t < spec.n; t++) onset[t] = low[t] + mid[t] + 0.6 * high[t];

  const tempo = estimateTempo(onset, fps);
  const rough = trackBeats(onset, fps, tempo.bpm);
  const grid = fitGrid(rough, onset, fps, tempo.bpm);
  const beats = grid.beats;

  const at = (env, time, radius = 2) => {
    const c = Math.round(time * fps);
    let m = 0;
    for (let k = c - radius; k <= c + radius; k++) if (k >= 0 && k < env.length && env[k] > m) m = env[k];
    return m;
  };
  const chromaBeats = beatChroma(spec.chroma, beats, fps);
  const energyBeats = beatAverage(spec.energy, beats, fps);
  const downbeat = findDownbeat(beats, (t) => at(low, t), chromaBeats);

  // 16th-note grid: four steps per beat, extended back to the song start.
  const grid16 = [];
  const period = beats.length > 1 ? (beats[beats.length - 1] - beats[0]) / (beats.length - 1) : 60 / tempo.bpm;
  for (let t = beats[0] - period / 4; t > 0; t -= period / 4) grid16.unshift(t);
  for (let i = 0; i < beats.length; i++) {
    const next = i + 1 < beats.length ? beats[i + 1] : beats[i] + period;
    for (let s = 0; s < 4; s++) grid16.push(beats[i] + ((next - beats[i]) * s) / 4);
  }
  const band16 = {
    low: Float32Array.from(grid16, (t) => at(low, t, 1)),
    mid: Float32Array.from(grid16, (t) => at(mid, t, 1)),
    high: Float32Array.from(grid16, (t) => at(high, t, 1)),
  };

  return {
    duration: x.length / sr,
    bpm: 60 / period,
    period,
    tempoConfidence: tempo.confidence,
    constantTempo: grid.constant,
    beats: Float64Array.from(beats),
    downbeat,                          // index into beats of the first bar line
    grid16: Float64Array.from(grid16),
    firstBeat16: grid16.length - beats.length * 4, // index in grid16 of beats[0]
    band16,
    drumWindows: drumWindows(beats, (t) => at(low, t) + at(high, t) + 0.5 * at(mid, t)),
    chromaBeats,                       // beats.length × 12, for section detection
    energyBeats,
    tempoCandidates: tempo.candidates,
  };
}

// Kick / snare / hi-hat onset strength of signal x at given grid times
// (e.g. a Demucs drum stem, measured on the full song's 16th grid).
export function bandsOnGrid(x, grid16, sr = ANALYSIS_SR) {
  const fps = sr / HOP;
  const spec = spectralFeatures(x, sr);
  const env = { low: normalizeEnv(spec.low, fps), mid: normalizeEnv(spec.mid, fps), high: normalizeEnv(spec.high, fps) };
  const at = (e, time) => {
    const c = Math.round(time * fps);
    let m = 0;
    for (let k = c - 1; k <= c + 1; k++) if (k >= 0 && k < e.length && e[k] > m) m = e[k];
    return m;
  };
  return {
    low: Float32Array.from(grid16, (t) => at(env.low, t)),
    mid: Float32Array.from(grid16, (t) => at(env.mid, t)),
    high: Float32Array.from(grid16, (t) => at(env.high, t)),
  };
}

// ---------------------------------------------------------------- features

function spectralFeatures(x, sr) {
  const n = Math.ceil(x.length / HOP);
  const fft = new FFT(N);
  const re = new Float64Array(N), im = new Float64Array(N);
  const win = new Float64Array(N);
  for (let i = 0; i < N; i++) win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N);
  const binHz = sr / N, nb = N / 2 + 1;
  const bandOf = new Int8Array(nb).fill(-1);
  const names = Object.keys(BANDS);
  for (let k = 0; k < nb; k++) names.forEach((b, j) => { const [lo, hi] = BANDS[b]; if (k * binHz >= lo && k * binHz < hi) bandOf[k] = j; });
  const pitchOf = new Int8Array(nb).fill(-1);
  for (let k = 1; k < nb; k++) {
    const f = k * binHz;
    if (f >= 65 && f <= 2100) pitchOf[k] = ((Math.round(12 * Math.log2(f / 440)) + 69) % 12 + 12) % 12;
  }

  const flux = names.map(() => new Float32Array(n));
  const chroma = new Float32Array(n * 12);
  const energy = new Float32Array(n);
  let prev = new Float64Array(nb), cur = new Float64Array(nb);
  for (let t = 0; t < n; t++) {
    const start = t * HOP - N / 2; // centred frames
    for (let i = 0; i < N; i++) {
      const s = start + i;
      re[i] = s >= 0 && s < x.length ? x[s] * win[i] : 0;
      im[i] = 0;
    }
    fft.transform(re, im);
    let e = 0;
    for (let k = 0; k < nb; k++) {
      const p = re[k] * re[k] + im[k] * im[k];
      e += p;
      const m = Math.sqrt(p);
      cur[k] = Math.log1p(10 * m);
      const d = cur[k] - prev[k];
      if (d > 0 && bandOf[k] >= 0) flux[bandOf[k]][t] += d;
      if (pitchOf[k] >= 0) chroma[t * 12 + pitchOf[k]] += p;
    }
    energy[t] = Math.log1p(e);
    const tmp = prev; prev = cur; cur = tmp;
  }
  return { n, low: flux[0], mid: flux[1], high: flux[2], chroma, energy };
}

// Remove the slow trend, keep rises, scale to unit spread.
function normalizeEnv(e, fps) {
  const w = Math.max(3, Math.round(0.4 * fps));
  const out = new Float32Array(e.length);
  let acc = 0;
  const pre = new Float64Array(e.length + 1);
  for (let i = 0; i < e.length; i++) { acc += e[i]; pre[i + 1] = acc; }
  for (let i = 0; i < e.length; i++) {
    const a = Math.max(0, i - w), b = Math.min(e.length, i + w + 1);
    out[i] = Math.max(0, e[i] - (pre[b] - pre[a]) / (b - a));
  }
  let s = 0;
  for (const v of out) s += v * v;
  const sd = Math.sqrt(s / Math.max(1, out.length)) || 1;
  for (let i = 0; i < out.length; i++) out[i] /= sd;
  return out;
}

// ---------------------------------------------------------------- tempo

const prior = (bpm) => Math.exp(-0.5 * (Math.log2(bpm / 105) / 0.75) ** 2);

function estimateTempo(env, fps) {
  const maxLag = Math.ceil((60 * fps) / 50) * 2 + 2;
  const ac = new Float64Array(maxLag + 1);
  for (let l = 1; l <= maxLag; l++) {
    let s = 0;
    for (let t = 0; t + l < env.length; t++) s += env[t] * env[t + l];
    ac[l] = s / (env.length - l);
  }
  const acAt = (lag) => {
    const i = Math.floor(lag), f = lag - i;
    return i + 1 > maxLag ? 0 : ac[i] * (1 - f) + ac[i + 1] * f;
  };
  // harmonic-sum autocorrelation score, weighted by a broad tempo prior
  let best = 0, bestScore = -Infinity;
  for (let bpm = 55; bpm <= 215; bpm += 0.1) {
    const lag = (60 * fps) / bpm;
    const s = (acAt(lag) + 0.5 * acAt(2 * lag) + 0.25 * acAt(4 * lag)) * prior(bpm);
    if (s > bestScore) { bestScore = s; best = bpm; }
  }
  // 2:1, 3:2 and 4:3 checks (dembow groups 3+3+2 sixteenths, which looks like 4:3):
  // compare how well each related tempo's grid fits the onsets
  const cands = [1, 2, 0.5, 1.5, 2 / 3, 0.75, 4 / 3].map((r) => best * r).filter((b) => b >= 60 && b <= 200);
  const scored = cands.map((bpm) => {
    const fit = gridFitScore(env, (60 * fps) / bpm);
    return { bpm, fit, score: fit * prior(bpm) };
  }).sort((a, b) => b.score - a.score);
  const top = scored[0];
  return { bpm: top.bpm, confidence: Math.max(0, Math.min(1, (top.fit - 1) / 1.5)), candidates: scored };
}

// Mean onset strength on the best-phase comb, relative to the overall mean.
function gridFitScore(env, P) {
  let mean = 0;
  for (const v of env) mean += v;
  mean /= env.length || 1;
  let best = 0;
  for (let ph = 0; ph < P; ph += 0.5) {
    let s = 0, c = 0;
    for (let t = ph; t < env.length; t += P) { s += env[Math.round(t)] || 0; c++; }
    best = Math.max(best, s / Math.max(1, c));
  }
  return best / (mean || 1);
}

// ---------------------------------------------------------------- beats

// Dynamic-programming beat tracker (Ellis 2007): onsets vs. steady spacing.
function trackBeats(env, fps, bpm) {
  const P = (60 * fps) / bpm, n = env.length, alpha = 400;
  const cum = new Float64Array(n), back = new Int32Array(n).fill(-1);
  for (let t = 0; t < n; t++) {
    let bestV = -Infinity, bestP = -1;
    const lo = Math.max(0, Math.round(t - 2 * P)), hi = t - Math.round(P / 2);
    for (let p = lo; p <= hi; p++) {
      const v = cum[p] - alpha * Math.log((t - p) / P) ** 2;
      if (v > bestV) { bestV = v; bestP = p; }
    }
    cum[t] = env[t] + (bestP >= 0 ? Math.max(0, bestV) : 0);
    back[t] = bestV > 0 ? bestP : -1;
  }
  let end = n - 1;
  for (let t = Math.max(0, Math.round(n - 2 * P)); t < n; t++) if (cum[t] > cum[end]) end = t;
  const frames = [];
  for (let t = end; t >= 0; t = back[t]) frames.unshift(t);
  return frames.map((f) => f / fps);
}

// Snap the tracked beats to a clean grid. The tracked beats are split into
// steady stretches (a line fits within 30 ms; a stray beat is skipped, three in
// a row end the stretch). Each stretch gets a fine search over period and phase
// on the onset envelope, which gives sub-millisecond beat positions. Gaps
// between stretches (breakdowns, edits) are bridged with evenly spaced beats.
function fitGrid(beats, env, fps, bpm) {
  if (beats.length < 8) return { beats: beats.map((t) => t - ONSET_LATENCY), constant: false };
  const val = (time) => {
    const f = time * fps, i = Math.floor(f), r = f - i;
    return i < 0 || i + 1 >= env.length ? 0 : env[i] * (1 - r) + env[i + 1] * r;
  };
  const segs = [];
  for (const run of steadyRuns(beats)) {
    if (run.length < 8) continue;
    let [a, b] = lineFit(run, run.map((i) => beats[i]));
    const k0 = run[0], k1 = run[run.length - 1], mid = (k0 + k1) / 2;
    let best = [a, b], bestS = -Infinity;
    for (let dp = -0.003; dp <= 0.003 + 1e-9; dp += 0.0002) {
      const bb = b * (1 + dp);
      for (let da = -0.02; da <= 0.02 + 1e-9; da += 0.001) {
        const aa = a + da + (b - bb) * mid; // pivot around the middle of the stretch
        let sc = 0;
        for (let k = k0; k <= k1; k++) sc += val(aa + bb * k);
        if (sc > bestS) { bestS = sc; best = [aa, bb]; }
      }
    }
    [a, b] = best;
    segs.push({ t0: a + b * k0, t1: a + b * k1, a, b, k0, k1 });
  }
  if (!segs.length) return { beats: beats.map((t) => t - ONSET_LATENCY), constant: false };

  const out = [];
  const s0 = segs[0];
  for (let k = s0.k0 - 1; s0.a + s0.b * k >= 0; k--) out.unshift(s0.a + s0.b * k);
  segs.forEach((sg, j) => {
    if (j > 0) { // bridge from the previous stretch
      const prev = out[out.length - 1], gap = sg.t0 - prev;
      const n = Math.max(1, Math.round(gap / ((sg.b + segs[j - 1].b) / 2)));
      for (let m = 1; m < n; m++) out.push(prev + (gap * m) / n);
    }
    for (let k = sg.k0; k <= sg.k1; k++) {
      const t = sg.a + sg.b * k;
      if (!out.length || t > out[out.length - 1] + sg.b / 2) out.push(t);
    }
  });
  const last = segs[segs.length - 1];
  for (let t = out[out.length - 1] + last.b; t < beats[beats.length - 1] + last.b / 2; t += last.b) out.push(t);

  const span = beats[beats.length - 1] - beats[0];
  const longest = Math.max(...segs.map((sg) => sg.t1 - sg.t0));
  return { beats: out.map((t) => t - ONSET_LATENCY), constant: segs.length === 1 && longest > 0.8 * span };
}

// Index lists of tracked beats that fall on one straight line (steady tempo).
function steadyRuns(beats) {
  const runs = [];
  let s = 0;
  while (s < beats.length - 1) {
    const good = [s, s + 1];
    let bad = 0;
    for (let e = s + 2; e < beats.length; e++) {
      const [a, b] = lineFit(good.slice(-24), good.slice(-24).map((i) => beats[i]));
      if (Math.abs(beats[e] - (a + b * e)) < 0.03) { good.push(e); bad = 0; }
      else if (++bad >= 3) break;
    }
    runs.push(good);
    s = good[good.length - 1] + 1;
  }
  return runs;
}

function lineFit(xs, ys) {
  const n = xs.length;
  let sx = 0, sy = 0, sxx = 0, sxy = 0;
  for (let i = 0; i < n; i++) { sx += xs[i]; sy += ys[i]; sxx += xs[i] * xs[i]; sxy += xs[i] * ys[i]; }
  const b = (n * sxy - sx * sy) / (n * sxx - sx * sx || 1);
  return [(sy - b * sx) / n, b];
}

// ---------------------------------------------------------------- bars

function beatChroma(chroma, beats, fps) {
  const out = new Float32Array(beats.length * 12);
  for (let i = 0; i < beats.length; i++) {
    const a = Math.round(beats[i] * fps), b = Math.round((i + 1 < beats.length ? beats[i + 1] : beats[i] + 0.5) * fps);
    let norm = 0;
    for (let t = Math.max(0, a); t < b && t * 12 < chroma.length; t++) for (let p = 0; p < 12; p++) out[i * 12 + p] += chroma[t * 12 + p];
    for (let p = 0; p < 12; p++) norm += out[i * 12 + p] ** 2;
    norm = Math.sqrt(norm) || 1;
    for (let p = 0; p < 12; p++) out[i * 12 + p] /= norm;
  }
  return out;
}

function beatAverage(e, beats, fps) {
  return Float32Array.from(beats, (t, i) => {
    const a = Math.max(0, Math.round(t * fps)), b = Math.min(e.length, Math.round((i + 1 < beats.length ? beats[i + 1] : t + 0.5) * fps));
    let s = 0;
    for (let k = a; k < b; k++) s += e[k];
    return b > a ? s / (b - a) : 0;
  });
}

// Bar line = the beat position (of 4) with the strongest kick and the most chord changes.
function findDownbeat(beats, lowAt, chromaBeats) {
  const n = beats.length;
  if (n < 8) return 0;
  const low = beats.map(lowAt);
  // harmonic change: chroma of the two beats before vs. the two beats after
  // (two-beat windows keep drum noise from looking like chord changes)
  const change = beats.map((_, i) => {
    if (i < 2 || i + 2 > n) return 0;
    let dot = 0, na = 0, nb = 0;
    for (let p = 0; p < 12; p++) {
      const a = chromaBeats[(i - 2) * 12 + p] + chromaBeats[(i - 1) * 12 + p];
      const b = chromaBeats[i * 12 + p] + chromaBeats[(i + 1) * 12 + p];
      dot += a * b; na += a * a; nb += b * b;
    }
    return na * nb > 1e-12 ? 1 - dot / Math.sqrt(na * nb) : 0; // silence is not a chord change
  });
  const z = (arr) => {
    const m = arr.reduce((s, v) => s + v, 0) / arr.length;
    const sd = Math.sqrt(arr.reduce((s, v) => s + (v - m) ** 2, 0) / arr.length) || 1;
    return arr.map((v) => (v - m) / sd);
  };
  const zl = z(low), zc = z(change);
  let best = 0, bestS = -Infinity;
  for (let r = 0; r < 4; r++) {
    let s = 0, c = 0;
    for (let i = r; i < n; i += 4) { s += zl[i] + 2 * zc[i]; c++; }
    s /= c;
    if (s > bestS) { bestS = s; best = r; }
  }
  return best;
}

// Stretches of the song where the drums are playing, in seconds.
function drumWindows(beats, drumAt) {
  const d = beats.map(drumAt);
  const sm = d.map((_, i) => {
    const w = d.slice(Math.max(0, i - 4), Math.min(d.length, i + 4));
    return w.reduce((s, v) => s + v, 0) / w.length;
  });
  const sorted = [...sm].sort((p, q) => p - q);
  const thr = 0.35 * (sorted[Math.floor(0.9 * (sorted.length - 1))] || 0);
  const out = [];
  let start = -1;
  for (let i = 0; i <= sm.length; i++) {
    const on = i < sm.length && sm[i] > thr;
    if (on && start < 0) start = i;
    if (!on && start >= 0) {
      if (i - start >= 8) out.push({ start: beats[start], end: i < beats.length ? beats[i] : beats[beats.length - 1] });
      start = -1;
    }
  }
  return out;
}
