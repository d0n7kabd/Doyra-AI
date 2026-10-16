// The song-specific arranger: builds the doira part for one song, section by
// section. Used for uploads, library songs and the laptop server alike.
//
//   sections   novelty over per-bar chords + loudness, snapped to 4-bar phrases;
//              drums starting or stopping always starts a section
//   transcribe the song's own drums on the 16th grid, per section: kick -> bum,
//              snare/clap -> bak, hi-hat -> kichik bak; a bar position is kept
//              only if it is hit in at least 3 of 4 bars (drops stray hits)
//   modes      'drums' (the song's own pattern), 'groove' (style groove) or
//              'usul' (to'y etc.), each shaped by the sections:
//   energy     quiet sections: kichik strokes, softer; loud ones: full bum/bak;
//              sections without drums: a soft cycle, or silence if near-silent
//   rolls      "ta-ka-ta-ka" into every new section, rising in volume
//   variation  something small in every 4th bar / cycle
//   feel       the to'y bak-bak tightening, scaled by tempo (patterns.js)
//   seed       deterministic: same song (same seed) -> same arrangement
//
// Pure functions: runs in the browser, in a worker, and in Node.
import { STROKES, USULS } from '../usuls.js';
import { GROOVES } from '../grooves.js';
import { usulPattern, feelAmount, windowed } from '../patterns.js';

export const MODES = ['drums', 'groove', 'usul'];

// ---------------------------------------------------------------- helpers

function rng(seed) { // mulberry32
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6D2B79F5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// FNV-1a over the song file's bytes (every k-th byte), the arrangement's seed.
// tools/library/pipeline.py computes the same number, so the browser and the
// laptop server arrange a file the same way.
export function bytesSeed(u8) {
  let h = 0x811c9dc5;
  const step = Math.max(1, Math.floor(u8.length / 200000));
  for (let i = 0; i < u8.length; i += step) {
    h ^= u8[i];
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

// FNV-1a over a sample of the audio: a fallback seed when no file bytes exist.
export function audioSeed(samples) {
  let h = 0x811c9dc5;
  const step = Math.max(1, Math.floor(samples.length / 50000));
  for (let i = 0; i < samples.length; i += step) {
    h ^= Math.round(samples[i] * 32767) & 0xffff;
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

const quantile = (arr, q) => {
  const s = [...arr].sort((a, b) => a - b);
  return s.length ? s[Math.min(s.length - 1, Math.floor(q * (s.length - 1)))] : 0;
};

// How much tighter two adjacent baks are than other strokes in to'y,
// from the measured gaps (K->K vs the rest): about 11 %.
const BAK_TIGHTEN = (() => {
  const u = USULS.toy, kk = [], other = [];
  for (let i = 0; i < u.seq.length; i++) {
    const a = u.seq[i], b = u.seq[(i + 1) % u.seq.length];
    (STROKES[a].kind === 'bak' && STROKES[b].kind === 'bak' ? kk : other).push(u.gaps[i]);
  }
  const mean = (x) => x.reduce((p, q) => p + q, 0) / x.length;
  return 1 - mean(kk) / mean(other);
})();

// Quiet sections use kichik strokes; loud ones upgrade kichik bums to full bums.
const LIGHTER = { B: 'M', b: 'm', T: 'K', t: 'k' };
const FULLER_BUM = { M: 'B', m: 'b' };
const LEVEL_GAIN = { none: 0.4, low: 0.6, mid: 0.85, high: 1 };

// ---------------------------------------------------------------- bars

export function barsOf(an) {
  const { beats, downbeat, period, firstBeat16, drumWindows } = an;
  const inDrums = (t) => (drumWindows || []).some((w) => t >= w.start - 0.05 && t < w.end);
  const bars = [];
  for (let b = downbeat; b + 1 < beats.length; b += 4) {
    const start = beats[b];
    const end = b + 4 < beats.length ? beats[b + 4] : start + 4 * period;
    if (end > an.duration) break;
    const chroma = new Array(12).fill(0);
    let energy = 0, n = 0;
    for (let i = b; i < Math.min(b + 4, beats.length); i++) { // older analyses may lack these
      for (let p = 0; p < 12; p++) chroma[p] += (an.chromaBeats && an.chromaBeats[i * 12 + p]) || 0;
      energy += (an.energyBeats && an.energyBeats[i]) || 0; n++;
    }
    bars.push({ index: bars.length, beat: b, g: firstBeat16 + b * 4, start, end, chroma, energy: energy / Math.max(1, n), drums: inDrums(start + 0.01) });
  }
  return bars;
}

// ---------------------------------------------------------------- sections

export function findSections(bars) {
  const n = bars.length;
  if (!n) return [];
  const es = bars.map((b) => b.energy);
  // loudness is log-energy; a spread under 0.5 means the song is about equally loud throughout
  const eLo = quantile(es, 0.1), eHi = quantile(es, 0.9), eMed = quantile(es, 0.5), eSpan = Math.max(0.5, eHi - eLo);
  const cos = (a, b) => {
    let d = 0, na = 0, nb = 0;
    for (let p = 0; p < 12; p++) { d += a[p] * b[p]; na += a[p] * a[p]; nb += b[p] * b[p]; }
    return na && nb ? d / Math.sqrt(na * nb) : 1;
  };
  const mean = (from, to, f) => {
    const out = new Array(12).fill(0); let e = 0, c = 0;
    for (let i = Math.max(0, from); i < Math.min(n, to); i++) { bars[i].chroma.forEach((v, p) => { out[p] += v; }); e += bars[i].energy; c++; }
    return { chroma: out, energy: c ? e / c : 0 };
  };
  // novelty at each bar line: change in chords and loudness, 4 bars either side
  const nov = bars.map((_, j) => {
    if (j < 2 || j > n - 2) return 0;
    const a = mean(j - 4, j), b = mean(j, j + 4);
    return (1 - cos(a.chroma, b.chroma)) + Math.abs(a.energy - b.energy) / eSpan;
  });
  const nm = nov.reduce((p, q) => p + q, 0) / n;
  const ns = Math.sqrt(nov.reduce((p, q) => p + (q - nm) ** 2, 0) / n) || 1;
  const cuts = new Set([0]);
  for (let j = 1; j < n; j++) if (bars[j].drums !== bars[j - 1].drums) cuts.add(j); // drums in / out
  for (let j = 4; j < n - 3; j += 4) { // phrase lines only
    const local = Math.max(nov[j - 4] || 0, nov[j + 4] || 0);
    if (nov[j] > nm + 0.5 * ns && nov[j] >= local) cuts.add(j);
  }
  // keep sections at least 8 bars long (drums coming in or out: 2)
  const sorted = [...cuts].sort((a, b) => a - b);
  const keep = [0];
  for (const j of sorted.slice(1)) {
    const prev = keep[keep.length - 1];
    const drumChange = bars[j].drums !== bars[j - 1].drums;
    if (j - prev >= (drumChange ? 2 : 8)) keep.push(j);
  }
  const sections = keep.map((j, i) => ({ from: j, to: i + 1 < keep.length ? keep[i + 1] : n }));
  // level from loudness and drums; letters for sections that sound alike
  const labels = [];
  sections.forEach((s) => {
    const m = mean(s.from, s.to);
    m.energy = quantile(bars.slice(s.from, s.to).map((b) => b.energy), 0.5); // median: a fade-out bar doesn't count
    const drumBars = bars.slice(s.from, s.to).filter((b) => b.drums).length;
    const e = (m.energy - eMed) / eSpan; // 0 = the song's typical loudness
    s.energy = Math.round(e * 100) / 100;
    const nearSilent = m.energy < eLo - 0.5 * eSpan;
    s.level = drumBars < (s.to - s.from) / 2 ? (nearSilent ? 'silent' : 'none') : e < -0.2 ? 'low' : e > 0.2 ? 'high' : 'mid';
    let letter = null;
    for (const l of labels) if (cos(l.chroma, m.chroma) > 0.97 && Math.abs(l.energy - m.energy) / eSpan < 0.25) { letter = l.letter; break; }
    if (!letter) { letter = String.fromCharCode(65 + labels.length); labels.push({ letter, chroma: m.chroma, energy: m.energy }); }
    s.label = letter;
    s.start = bars[s.from].start;
    s.end = bars[s.to - 1].end;
  });
  return sections;
}

// ---------------------------------------------------------------- transcription

// The song's own drum pattern in one section: 16 steps, each a stroke code or '.'.
// bands: { low, mid, high } values on the 16th grid (from the mix, or the
// Demucs drum stem on the laptop).
// How the transcription decides. Tuned with tools/tune_transcription.mjs against
// Demucs drum stems of the library songs (see that file for the numbers).
export const TRANSCRIBE = {
  hitRel: 0.35,       // a bar's hit: at least this share of the band's 90th percentile
  salience: { low: 0.55, mid: 0.55, high: 0.55 }, // and this strong vs. the band's strongest position
  midPeak: 0,         // a snare is a peak: its strength >= this x its neighbours' (16ths either side); 0 = off
  maxBaks: 16,        // at most this many snare/clap positions per bar (the strongest)
  snareOverKick: 0.75,// where kick and snare both hit, bak needs this snare salience
};

// bands.covered (optional): [from, to) ranges of grid indices where the bands
// exist (Demucs may separate only a few bars per section); other bars use
// `fallback` (the full mix).
export function transcribeSection(bars, section, bands, fallback = null, params = TRANSCRIBE) {
  const P = { ...TRANSCRIBE, ...params, salience: { ...TRANSCRIBE.salience, ...(params.salience || {}) } };
  let secBars = bars.slice(section.from, section.to);
  if (bands.covered) {
    const inside = secBars.filter((b) => bands.covered.some(([a, z]) => b.g >= a && b.g + 16 <= z));
    if (inside.length) secBars = inside;
    else if (fallback) bands = fallback;
  }
  const hits = {}, salience = {};
  for (const band of ['low', 'mid', 'high']) {
    const v = secBars.map((b) => Array.from({ length: 16 }, (_, p) => bands[band][b.g + p] || 0));
    const thr = P.hitRel * quantile(v.flat(), 0.9);
    const hit = v.map((row) => row.map((x) => thr > 0 && x >= thr));
    // consistency: hit in >= 3 of 4 bars, in at least half of the 4-bar windows
    const count = new Array(16).fill(0);
    let windows = 0;
    for (let w = 0; w + 4 <= hit.length; w += 4) {
      windows++;
      for (let p = 0; p < 16; p++) if (hit.slice(w, w + 4).filter((h) => h[p]).length >= 3) count[p]++;
    }
    if (!windows) { // a section shorter than 4 bars: 75 % of its bars
      windows = 1;
      for (let p = 0; p < 16; p++) if (hit.filter((h) => h[p]).length >= 0.75 * hit.length) count[p]++;
    }
    // strength: a position must be strong enough vs. the band's strongest one,
    // so bleed from the other drums (hi-hats in the snare band) is left out
    const mean = Array.from({ length: 16 }, (_, p) => v.reduce((acc, row) => acc + row[p], 0) / Math.max(1, v.length));
    const top = Math.max(...mean) || 1;
    salience[band] = mean.map((m) => m / top);
    hits[band] = count.map((c, p) => c >= windows / 2 && c > 0 && salience[band][p] >= P.salience[band]);
    if (band === 'mid') {
      // snares are sharp: stronger than the 16ths either side (guitar and voice are smeared)
      hits.mid = hits.mid.map((h, p) => h && mean[p] >= P.midPeak * Math.max(mean[(p + 15) % 16], mean[(p + 1) % 16]) - 1e-9);
      // and few: keep only the strongest maxBaks positions
      const on = hits.mid.map((h, p) => (h ? p : -1)).filter((p) => p >= 0).sort((x, y) => mean[y] - mean[x]);
      const keep = new Set(on.slice(0, P.maxBaks));
      hits.mid = hits.mid.map((h, p) => h && keep.has(p));
    }
  }
  // one stroke per step: a clear snare/clap -> bak, kick -> bum, hi-hat -> kichik bak
  // (hands alternate: main on the beat side, secondary on the off 16ths)
  const steps = [];
  for (let p = 0; p < 16; p++) {
    let code = '.';
    const snare = hits.mid[p], kick = hits.low[p];
    if (snare && (!kick || salience.mid[p] >= P.snareOverKick)) code = p % 2 ? 't' : 'T';
    else if (kick) code = p % 4 === 0 ? 'B' : 'b';
    else if (snare) code = p % 2 ? 't' : 'T';
    else if (hits.high[p]) code = p % 2 ? 'k' : 'K';
    steps.push(code);
  }
  return { steps: steps.join(''), hits };
}

// ---------------------------------------------------------------- arrange

export function arrange(an, opts = {}) {
  const { mode = 'drums', usul = 'toy', fit = true, feel = 'player', style = null, drums16 = null, transcribe = TRANSCRIBE } = opts;
  const rand = rng(opts.seed ?? audioSeed(Float64Array.from(an.beats)));
  const bars = barsOf(an);
  const sections = findSections(bars);
  const bands = drums16 || an.band16;
  const sixteenth = an.period / 4;
  const grid = (i) => an.grid16[Math.min(i, an.grid16.length - 1)];
  const events = [];

  const levelOf = (s) => (s.level === 'silent' ? 'silent' : s.level);
  const shape = (code, level) => {
    if (level === 'low' || level === 'none') return LIGHTER[code] || code;
    if (level === 'high') return FULLER_BUM[code] || code;
    return code;
  };

  // --- the part for each section
  sections.forEach((s) => {
    const level = levelOf(s);
    if (mode === 'drums' || mode === 'groove') {
      let steps;
      if (mode === 'drums') {
        s.transcription = transcribeSection(bars, s, bands, an.band16, transcribe);
        steps = s.transcription.steps;
        if (!/[^.]/.test(steps) && style && GROOVES[style]) steps = GROOVES[style].steps; // nothing found: the style's groove
      } else {
        steps = GROOVES[style] ? GROOVES[style].steps : GROOVES.pop.steps;
      }
      // very fast songs: hi-hat 16ths become 8ths, so the drum stays playable
      if (sixteenth < 0.11) steps = [...steps].map((c, p) => (p % 2 && (c === 'k' || c === 'K') ? '.' : c)).join('');
      if (level === 'none') steps = 'M.......K.......'; // no drums: a soft cycle
      s.steps = level === 'silent' ? '................' : steps;
      const hitsIdx = [...s.steps].map((c, p) => ({ c, p })).filter((h) => h.c !== '.');
      s.beads = hitsIdx.map((h) => ({ code: shape(h.c, level), pos: h.p / 16 }));
      for (let bi = s.from; bi < s.to; bi++) {
        const bar = bars[bi];
        hitsIdx.forEach((h, k) => {
          const code = shape(h.c, level);
          events.push({ time: grid(bar.g + h.p), code, k, n: hitsIdx.length, cycle: bi, section: s.label, level,
            gain: STROKES[code].gain * LEVEL_GAIN[level === 'silent' ? 'none' : level] * (h.p === 0 ? 1.08 : 1) });
        });
      }
    }
  });

  if (mode === 'usul') {
    const pat = usulPattern(an, usul, { fit, feel });
    const secAt = (t) => sections.find((s) => t >= s.start - 1e-3 && t < s.end - 1e-3);
    for (const e of pat.events) {
      const s = secAt(e.time);
      if (!s) continue;
      const level = levelOf(s);
      if (level === 'silent') continue;
      if (level === 'none' && e.k !== 0) continue; // no drums: only each cycle's first stroke, softly
      const code = shape(e.code, level);
      events.push({ ...e, code, section: s.label, level, gain: STROKES[code].gain * LEVEL_GAIN[level] * (e.k === 0 ? 1.08 : 1) });
    }
    sections.forEach((s) => { s.beads = [...USULS[usul].seq].map((c, k) => ({ code: shape(c, levelOf(s)), pos: pat.positions[k] })); });
  }

  events.sort((a, b) => a.time - b.time);

  // --- rolls into every new section: ta-ka-ta-ka on 16ths, rising
  for (let i = 1; i < sections.length; i++) {
    const s = sections[i];
    if (s.level === 'silent') continue;
    const at = bars[s.from];
    const loud = s.level === 'high' || s.level === 'mid';
    const beatsLong = loud && sixteenth >= 0.09 ? 2 : 1;
    const count = beatsLong * 4;
    const first = at.g - count;
    if (first < 0) continue;
    const from = grid(first), to = at.start;
    for (let j = events.length - 1; j >= 0; j--) if (events[j].time >= from - 1e-4 && events[j].time < to - 1e-4) events.splice(j, 1);
    for (let r = 0; r < count; r++) {
      const code = loud ? (r % 2 ? 't' : 'T') : (r % 2 ? 'k' : 'K');
      events.push({ time: grid(first + r), code, k: -1, n: 0, cycle: -1, section: s.label, level: 'roll', roll: true,
        gain: STROKES[code].gain * (0.45 + 0.55 * ((r + 1) / count)) });
    }
  }
  events.sort((a, b) => a.time - b.time);

  // --- small variations: the 4th bar (or cycle) of each phrase
  const variations = [];
  const byCycle = new Map();
  events.forEach((e, i) => { if (!e.roll && e.level !== 'none') (byCycle.get(e.cycle) || byCycle.set(e.cycle, []).get(e.cycle)).push(i); });
  const cycles = [...byCycle.keys()].filter((c) => c >= 0).sort((a, b) => a - b);
  cycles.forEach((c, ci) => {
    if (ci % 4 !== 3) return;
    const idx = byCycle.get(c);
    const last = events[idx[idx.length - 1]];
    const nextT = (events.find((e) => e.time > last.time + 1e-4) || { time: last.time + 2 * sixteenth }).time;
    if (nextT - last.time < 1.5 * sixteenth) return; // no room
    const kind = Math.floor(rand() * 3);
    const t = last.time + (nextT - last.time) / 2;
    if (kind === 0) events.push({ time: t, code: 'n', k: -1, n: 0, cycle: c, section: last.section, level: 'variation', gain: STROKES.n.gain });
    else if (kind === 1) events.push({ time: t, code: 'k', k: -1, n: 0, cycle: c, section: last.section, level: 'variation', gain: STROKES.k.gain * 0.8 });
    else { // a bak answers the last stroke
      events.push({ time: t, code: 't', k: -1, n: 0, cycle: c, section: last.section, level: 'variation', gain: STROKES.t.gain * 0.85 });
    }
    variations.push(c);
  });
  events.sort((a, b) => a.time - b.time);

  // --- feel for drum and groove parts: adjacent baks come closer, as measured
  // in to'y (usul parts already carry their own measured feel)
  let feelUsed = 0;
  if (mode !== 'usul' && feel === 'player') {
    feelUsed = feelAmount(USULS.toy, sixteenth * 2);
    for (let i = 1; i < events.length; i++) {
      const a = events[i - 1], b = events[i];
      const gap = b.time - a.time;
      if (STROKES[a.code].kind === 'bak' && STROKES[b.code].kind === 'bak' && gap <= 1.6 * sixteenth && gap > 0) {
        b.time -= gap * BAK_TIGHTEN * feelUsed;
      }
    }
  }

  // --- timing for the drum's display
  const end = an.duration - 0.15;
  const out = events.filter((e) => e.time >= 0 && e.time <= end);
  out.forEach((e, i) => { e.next = i + 1 < out.length ? out[i + 1].time : e.time + sixteenth; e.gain = Math.min(1, e.gain); });
  const fn = windowed(out);
  Object.assign(fn, {
    mode, sections, feel: feelUsed, bakTighten: BAK_TIGHTEN, variations: variations.length,
    positions: sections[0] ? sections[0].beads.map((b) => b.pos) : [],
  });
  return fn;
}
