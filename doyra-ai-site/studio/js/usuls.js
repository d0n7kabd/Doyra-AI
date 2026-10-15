// The research data: strokes and usuls (from the paper; do not edit by guesswork).

// Stroke codes: type and hand. Main-hand baks are chanted "ta", secondary "ka";
// bums have no syllable.
export const STROKES = {
  B: { name: 'bum', hand: 'main', kind: 'bum', syl: null, gain: 1.0 },
  b: { name: 'bum', hand: 'secondary', kind: 'bum', syl: null, gain: 0.95 },
  T: { name: 'bak', hand: 'main', kind: 'bak', syl: 'ta', gain: 0.9 },
  t: { name: 'bak', hand: 'secondary', kind: 'bak', syl: 'ka', gain: 0.85 },
  K: { name: 'kichik bak', hand: 'main', kind: 'bak', syl: 'ta', small: true, gain: 0.8 },
  k: { name: 'kichik bak', hand: 'secondary', kind: 'bak', syl: 'ka', small: true, gain: 0.75 },
  M: { name: 'kichik bum', hand: 'main', kind: 'bum', syl: null, small: true, gain: 0.9 },
  m: { name: 'kichik bum', hand: 'secondary', kind: 'bum', syl: null, small: true, gain: 0.85 },
  n: { name: 'noxun', hand: 'secondary', kind: 'noxun', syl: 'ka', small: true, gain: 0.7 },
};

// gaps: measured inter-stroke gaps relative to the mean gap (normal tempo):
// gaps[i] is the gap from stroke i to stroke i + 1; null where not measured.
// meanGap: seconds, normal tempo (paper).
// slow.gap: mean gap of the slow-tempo recording, measured by
//   tools/measure_usul_tempo.py from Usul_*_slow.m4a (not a paper number);
// slow.keep: share of the unevenness left at slow tempo (paper).
export const USULS = {
  toy: {
    name: "To'y", note: 'weddings, yor-yor',
    seq: 'MKKMKKMKKMKK',
    gaps: [1.151, 0.886, 1.033, 1.092, 0.919, 1.038, 1.006, 0.936, 1.061, 0.938, 0.941, 1.0],
    meanGap: 0.236,
    slow: { gap: 1.048, keep: 0.05 / 0.14 }, // bak-bak ratio 1.14 at normal tempo, 1.05 slow
  },
  u1: { name: 'Usul 1', seq: 'KMKKtMKtKtMKKtM', gaps: null, meanGap: null },
  u3: { name: 'Usul 3', seq: 'KKtMKKtM', gaps: null, meanGap: null },
  u4: {
    name: 'Usul 4', note: 'a phrase repeats it 3 times, the last phrase 4 times',
    seq: 'MKKMK', gaps: [0.652, 1.27, 0.748, 1.148, 1.274], meanGap: 0.334,
    slow: { gap: 0.776, keep: 7 / 25 },      // unevenness 25 % normal, 7 % slow
  },
  u5: {
    name: 'Usul 5', note: 'long gap into each new cycle',
    seq: 'MKKKMKK', gaps: [0.924, 0.935, 0.882, 1.027, 0.92, 0.897, 1.831], meanGap: 0.195,
    slow: { gap: 0.806, keep: 4 / 8 },       // unevenness 8 % normal, 4 % slow
  },
  u6: {
    name: 'Usul 6', note: 'keeps speeding up',
    seq: 'KtKtKtK', gaps: [1.28, 0.996, 0.971, 0.962, 0.927, 0.864], meanGap: 0.192, // 6 gaps measured for 7 strokes
    lastGap: 1.0, // the gap into the next cycle was not measured: the mean gap is assumed
    slow: null,   // no validated slow measurement: full feel at every tempo
  },
};

// Typical stroke spacing used to choose how a cycle sits on a song when the
// usul has no measured mean gap: the to'y value, the most measured usul.
export const DEFAULT_GAP = USULS.toy.meanGap;
