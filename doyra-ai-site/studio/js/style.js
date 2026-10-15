// Style detection: house (four-on-the-floor), reggaeton (dembow), pop (backbeat).
//
// Feature: the song's drum onset profile per bar position - mean kick (low),
// snare/clap (mid) and hi-hat (high) onset strength at each of the 16 sixteenth
// positions of a bar, over the bars where drums play. 48 numbers.
// Classifier: nearest neighbour (cosine similarity) against labelled profiles in
// data/styles.json, so new styles ("Uzbek pop") are added by labelling songs
// (tools/library/label_style.py). Pure functions: runs in the browser and in Node.

export const PROFILE_LEN = 48;

export function styleProfile(an) {
  const { grid16, firstBeat16, downbeat, band16, beats } = an;
  const prof = new Float64Array(PROFILE_LEN);
  const inDrums = (t) => !an.drumWindows.length || an.drumWindows.some((w) => t >= w.start && t < w.end);
  let bars = 0;
  for (let b = downbeat; b + 4 <= beats.length; b += 4) {
    const g = firstBeat16 + b * 4;
    if (g + 16 > grid16.length) break;
    if (!inDrums(grid16[g])) continue;
    for (let p = 0; p < 16; p++) {
      prof[p] += band16.low[g + p];
      prof[16 + p] += band16.mid[g + p];
      prof[32 + p] += band16.high[g + p];
    }
    bars++;
  }
  // each band's shape counts equally, whatever its loudness
  for (let k = 0; k < 3; k++) {
    let m = 0;
    for (let p = 0; p < 16; p++) m = Math.max(m, prof[k * 16 + p]);
    for (let p = 0; p < 16; p++) prof[k * 16 + p] = m ? prof[k * 16 + p] / m : 0;
  }
  return { profile: Array.from(prof, (v) => Math.round(v * 1000) / 1000), bars };
}

// Cosine similarity, allowing the bar line to be off by a whole beat
// (shift all bands by 0, 4, 8 or 12 sixteenths).
function similarity(a, b) {
  let best = -1;
  for (const shift of [0, 4, 8, 12]) {
    let dot = 0, na = 0, nb = 0;
    for (let k = 0; k < 3; k++) {
      for (let p = 0; p < 16; p++) {
        const x = a[k * 16 + ((p + shift) % 16)], y = b[k * 16 + p];
        dot += x * y; na += x * x; nb += y * y;
      }
    }
    best = Math.max(best, na && nb ? dot / Math.sqrt(na * nb) : 0);
  }
  return best;
}

// -> { style, confidence (0..1), scores: [{style, similarity, probability}], nearest }
export function detectStyle(profile, examples, { temperature = 0.03 } = {}) {
  const best = {};
  let nearest = null;
  for (const ex of examples) {
    const s = similarity(profile, ex.profile);
    if (!(ex.style in best) || s > best[ex.style].similarity) best[ex.style] = { similarity: s, example: ex.id };
    if (!nearest || s > nearest.similarity) nearest = { id: ex.id, style: ex.style, similarity: s };
  }
  const styles = Object.keys(best);
  const exps = styles.map((st) => Math.exp((best[st].similarity - nearest.similarity) / temperature));
  const sum = exps.reduce((p, q) => p + q, 0);
  const scores = styles.map((st, i) => ({ style: st, similarity: best[st].similarity, probability: exps[i] / sum }))
    .sort((p, q) => q.probability - p.probability);
  return { style: scores[0].style, confidence: scores[0].probability, scores, nearest };
}
