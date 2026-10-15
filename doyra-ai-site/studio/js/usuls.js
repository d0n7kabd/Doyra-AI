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

// gaps: measured inter-stroke gaps relative to the mean gap (normal tempo);
// null where no measurement exists. meanGap in seconds where measured.
export const USULS = {
  toy: {
    name: "To'y", note: 'weddings, yor-yor',
    seq: 'MKKMKKMKKMKK',
    gaps: [1.151, 0.886, 1.033, 1.092, 0.919, 1.038, 1.006, 0.936, 1.061, 0.938, 0.941, 1.0],
    meanGap: 0.236,
  },
  u1: { name: 'Usul 1', seq: 'KMKKtMKtKtMKKtM', gaps: null, meanGap: null },
  u3: { name: 'Usul 3', seq: 'KKtMKKtM', gaps: null, meanGap: null },
  u4: {
    name: 'Usul 4', note: 'a phrase repeats it 3 times, the last phrase 4 times',
    seq: 'MKKMK', gaps: [0.652, 1.27, 0.748, 1.148, 1.274], meanGap: 0.334,
  },
  u5: {
    name: 'Usul 5', note: 'long gap into each new cycle',
    seq: 'MKKKMKK', gaps: [0.924, 0.935, 0.882, 1.027, 0.92, 0.897, 1.831], meanGap: 0.195,
  },
  u6: {
    name: 'Usul 6', note: 'keeps speeding up',
    seq: 'KtKtKtK', gaps: [1.28, 0.996, 0.971, 0.962, 0.927, 0.864], meanGap: 0.192, // 6 gaps measured for 7 strokes
  },
};

// Typical stroke spacing used to choose how a cycle sits on a song when the
// usul has no measured mean gap: the to'y value, the most measured usul.
export const DEFAULT_GAP = USULS.toy.meanGap;
