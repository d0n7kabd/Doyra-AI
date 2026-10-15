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

export function usulPattern(an, usulId, { fit = true } = {}) {
  const u = USULS[usulId];
  const gap = u.meanGap || DEFAULT_GAP;
  const slots = usulId === 'toy' ? placeToy(an) : fit ? placeFit(an, u.seq.length, gap) : placeFree(an, u.seq.length, gap);
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
      n: u.seq.length,
      cycle: s.cycle,
      next: i + 1 < slots.length ? slots[i + 1].time : s.time + gap,
      gain: Math.min(1, STROKES[code].gain * (s.k === 0 ? 1.1 : 1)),
    });
  }
  return windowed(events);
}

// Transport asks for the strokes in [from, to); binary search the precomputed list.
function windowed(events) {
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

function placeToy(an) {
  const out = [];
  const { beats, downbeat, period } = an;
  for (let i = downbeat, c = 0; i < beats.length; i++) {
    const g = (i - downbeat) % 4;
    if (g === 0 && i > downbeat) c++;
    for (let j = 0; j < 3; j++) out.push({ time: beatTime(beats, period, i + j / 3), k: g * 3 + j, cycle: c });
  }
  return out;
}

function placeFit(an, n, gap) {
  const { beats, downbeat, period } = an;
  const bars = Math.max(1, Math.round((n * gap) / (4 * period)));
  const span = 4 * bars; // beats per cycle
  const out = [];
  for (let s = downbeat, c = 0; s < beats.length; s += span, c++) {
    for (let k = 0; k < n; k++) out.push({ time: beatTime(beats, period, s + (k * span) / n), k, cycle: c });
  }
  return out;
}

function placeFree(an, n, gap) {
  const { grid16, firstBeat16, downbeat, period } = an;
  const step = Math.max(1, Math.round(gap / (period / 4)));
  const out = [];
  for (let g = firstBeat16 + downbeat * 4, s = 0; g < grid16.length; g += step, s++) {
    out.push({ time: grid16[g], k: s % n, cycle: Math.floor(s / n) });
  }
  return out;
}
