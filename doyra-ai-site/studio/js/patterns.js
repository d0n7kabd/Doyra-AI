// Placing an usul cycle on a song's beat grid.
//
// To'y fits 4/4 naturally: one group (M K K) per beat, one cycle per bar.
// Other usuls (5, 7, 8 or 15 strokes) either
//   fit:  stretch the cycle over whole bars, so every cycle starts on a bar line;
//   free: step along the song's 16th-note grid and let the cycle drift against
//         the bar (polymeter).
// In both cases the number of bars / grid steps is chosen so the strokes come
// as close as possible to the usul's own measured spacing.
import { USULS, STROKES, DEFAULT_GAP } from './usuls.js';
import { GROOVES } from './grooves.js';

// ---------------------------------------------------------------- feel
// "Player" timing uses the measured gaps; "machine" spaces strokes evenly.
// The measured unevenness is strong at performance tempo and nearly gone when
// slow, so it is scaled by the song's stroke spacing: full at the recorded
// tempo or faster, shrinking linearly to the share kept at the slow
// recording's tempo (usuls.js: slow.gap, slow.keep), and no further.
export function feelAmount(u, strokeGap) {
  if (!u.gaps) return 0;
  if (!u.slow) return 1;
  const g0 = u.meanGap, g1 = u.slow.gap;
  if (strokeGap <= g0) return 1;
  if (strokeGap >= g1) return u.slow.keep;
  return 1 + ((strokeGap - g0) / (g1 - g0)) * (u.slow.keep - 1);
}

// Where each stroke sits in the cycle (0..1), with feel amount f (0 = even).
export function cyclePositions(u, f) {
  const n = u.seq.length;
  let gaps = u.gaps ? [...u.gaps] : [];
  while (gaps.length < n) gaps.push(u.lastGap ?? 1);
  if (!u.gaps) gaps = gaps.map(() => 1);
  const g = gaps.map((x) => 1 + f * (x - 1));
  const tot = g.reduce((p, q) => p + q, 0);
  const pos = [];
  let cum = 0;
  for (let i = 0; i < n; i++) { pos.push(cum / tot); cum += g[i]; }
  return pos;
}

// ---------------------------------------------------------------- placing

export function usulPattern(an, usulId, { fit = true, feel = 'player' } = {}) {
  const u = USULS[usulId], n = u.seq.length;
  const gap = u.meanGap || DEFAULT_GAP;
  const { period } = an;
  // the cycle's span on the song, and so the stroke spacing the feel is scaled by
  let place, strokeGap;
  if (usulId === 'toy') {
    strokeGap = (4 * period) / n;
    place = (pos) => placeSpan(an, 4, pos);
  } else if (fit) {
    const span = 4 * Math.max(1, Math.round((n * gap) / (4 * period)));
    strokeGap = (span * period) / n;
    place = (pos) => placeSpan(an, span, pos);
  } else {
    const step = Math.max(1, Math.round(gap / (period / 4)));
    strokeGap = (step * period) / 4;
    place = (pos) => placeFree(an, n, step, pos);
  }
  const amount = feel === 'player' ? feelAmount(u, strokeGap) : 0;
  const positions = cyclePositions(u, amount);
  const slots = place(positions);

  const end = an.duration - 0.15;
  const events = [];
  for (let i = 0; i < slots.length; i++) {
    const s = slots[i];
    if (s.time < 0 || s.time > end) continue;
    const code = u.seq[s.k];
    events.push({
      time: s.time,
      code,
      k: s.k,                   // position in the cycle
      n,
      cycle: s.cycle,
      next: i + 1 < slots.length ? slots[i + 1].time : s.time + strokeGap,
      gain: Math.min(1, STROKES[code].gain * (s.k === 0 ? 1.1 : 1)),
    });
  }
  const fn = windowed(events);
  Object.assign(fn, { feel: amount, positions, strokeGap, usul: usulId });
  return fn;
}

// A style groove: one bar of 16 steps on the song's 16th-note grid, from the
// first bar line. Grooves have no measured feel, so they are always even.
export function groovePattern(an, styleId) {
  const g = GROOVES[styleId];
  const hits = [...g.steps].map((c, step) => ({ c, step })).filter((h) => h.c !== '.');
  const n = hits.length;
  const { grid16, firstBeat16, downbeat, period } = an;
  const g0 = firstBeat16 + downbeat * 4;
  const end = an.duration - 0.15;
  const slots = [];
  for (let bar = 0; g0 + bar * 16 < grid16.length; bar++) {
    hits.forEach((h, k) => {
      const i = g0 + bar * 16 + h.step;
      if (i < grid16.length) slots.push({ time: grid16[i], k, code: h.c, cycle: bar });
    });
  }
  const events = [];
  for (let i = 0; i < slots.length; i++) {
    const s = slots[i];
    if (s.time < 0 || s.time > end) continue;
    events.push({
      time: s.time, code: s.code, k: s.k, n, cycle: s.cycle,
      next: i + 1 < slots.length ? slots[i + 1].time : s.time + period / 4,
      gain: Math.min(1, STROKES[s.code].gain * (s.k === 0 ? 1.1 : 1)),
    });
  }
  const fn = windowed(events);
  Object.assign(fn, { feel: 0, positions: hits.map((h) => h.step / 16), strokeGap: period / 4, groove: styleId, seq: hits.map((h) => h.c).join('') });
  return fn;
}

// Transport asks for the strokes in [from, to); binary search the precomputed list.
export function windowed(events) {
  const fn = (from, to) => {
    let lo = 0, hi = events.length;
    while (lo < hi) { const m = (lo + hi) >> 1; if (events[m].time < from) lo = m + 1; else hi = m; }
    const out = [];
    for (let i = lo; i < events.length && events[i].time < to; i++) out.push(events[i]);
    return out;
  };
  fn.events = events;
  return fn;
}

// Time at fractional beat position p (beats may drift; interpolate between them).
function beatTime(beats, period, p) {
  const i = Math.floor(p), f = p - i;
  if (i < 0) return beats[0] + p * period;
  if (i + 1 >= beats.length) return beats[beats.length - 1] + (p - (beats.length - 1)) * period;
  return beats[i] + f * (beats[i + 1] - beats[i]);
}

// Cycles of `span` beats starting on bar lines; strokes at their cycle positions.
function placeSpan(an, span, positions) {
  const { beats, downbeat, period } = an;
  const out = [];
  for (let s = downbeat, c = 0; s < beats.length; s += span, c++) {
    positions.forEach((pos, k) => out.push({ time: beatTime(beats, period, s + span * pos), k, cycle: c }));
  }
  return out;
}

// Free: one stroke every `step` sixteenths, the cycle drifting against the bar.
// With feel, strokes move off their grid points by the measured deviations.
function placeFree(an, n, step, positions) {
  const { grid16, firstBeat16, downbeat } = an;
  const at = (x) => {
    const i = Math.floor(x), f = x - i;
    if (i + 1 >= grid16.length) return grid16[grid16.length - 1] + (x - (grid16.length - 1)) * (grid16[1] - grid16[0]);
    return grid16[i] + f * (grid16[i + 1] - grid16[i]);
  };
  const out = [];
  const g0 = firstBeat16 + downbeat * 4;
  for (let s = 0; g0 + s * step < grid16.length; s++) {
    const k = s % n, cycleStart = s - k;
    out.push({ time: at(g0 + (cycleStart + n * positions[k]) * step), k, cycle: Math.floor(s / n) });
  }
  return out;
}
