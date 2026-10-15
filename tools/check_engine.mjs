// Runs the studio's song analysis (doyra-ai-site/studio/js/engine/analysis.js)
// in Node on a .f32 file from tools/make_engine_test.py, and scores it against
// the answer key when one exists next to the file.
//
//   node tools/check_engine.mjs test.f32
import { readFileSync, existsSync } from 'node:fs';
import { analyzeSong, ANALYSIS_SR } from '../doyra-ai-site/studio/js/engine/analysis.js';

const file = process.argv[2];
if (!file) { console.error('usage: node tools/check_engine.mjs file.f32'); process.exit(1); }
const buf = readFileSync(file);
const x = new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);

const t0 = performance.now();
const r = analyzeSong(x, ANALYSIS_SR);
const ms = performance.now() - t0;

const fmt = (v, d = 1) => Number(v).toFixed(d);
console.log(`file        ${file}  (${fmt(r.duration)} s, analysed in ${fmt(ms / 1000, 2)} s)`);
console.log(`tempo       ${fmt(r.bpm, 2)} BPM  confidence ${fmt(r.tempoConfidence, 2)}  constant tempo: ${r.constantTempo}`);
console.log(`candidates  ${r.tempoCandidates.map((c) => `${fmt(c.bpm)}:${fmt(c.score, 2)}`).join('  ')}`);
console.log(`beats       ${r.beats.length}, first at ${fmt(r.beats[0], 3)} s, first bar line at beat ${r.downbeat} (${fmt(r.beats[r.downbeat], 3)} s)`);
console.log(`drums       ${r.drumWindows.map((w) => `${fmt(w.start)}–${fmt(w.end)} s`).join(', ') || 'none found'}`);

const keyPath = file.replace(/\.f32$/, '.json');
if (existsSync(keyPath)) {
  const key = JSON.parse(readFileSync(keyPath, 'utf8'));
  const truth = key.beats;
  // beat F-measure with ±70 ms tolerance (MIREX), plus timing error of the matches
  const est = Array.from(r.beats);
  const used = new Set();
  const errs = [];
  for (const t of truth) {
    let bi = -1, bd = Infinity;
    est.forEach((e, i) => { const d = Math.abs(e - t); if (d < bd && !used.has(i)) { bd = d; bi = i; } });
    if (bd <= 0.07) { used.add(bi); errs.push(est[bi] - t); }
  }
  const p = used.size / est.length, rec = used.size / truth.length;
  const f = p + rec ? (2 * p * rec) / (p + rec) : 0;
  const mean = errs.reduce((s, v) => s + v, 0) / (errs.length || 1);
  const mad = errs.reduce((s, v) => s + Math.abs(v - mean), 0) / (errs.length || 1);
  const db = r.beats[r.downbeat];
  const barErr = ((db - key.downbeat_time) / (60 / key.bpm)) % 4;
  console.log(`answer key  ${key.bpm} BPM ${key.style}`);
  console.log(`score       tempo error ${fmt(r.bpm - key.bpm, 2)} BPM, beat F ${fmt(f, 3)}, ` +
    `offset ${fmt(mean * 1000)} ms (spread ${fmt(mad * 1000)} ms), bar line ${Math.round(barErr) === 0 ? 'correct' : 'WRONG'}`);
}
