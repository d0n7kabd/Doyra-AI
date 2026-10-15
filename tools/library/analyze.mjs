// Bridge for add_song.py: runs the studio's own analysis and usul placement
// (the same code the browser runs) on a .f32 file and writes JSON.
//
//   node tools/library/analyze.mjs song.f32 out.json
import { readFileSync, writeFileSync } from 'node:fs';
import { analyzeSong, ANALYSIS_SR } from '../../doyra-ai-site/studio/js/engine/analysis.js';
import { usulPattern } from '../../doyra-ai-site/studio/js/patterns.js';

const [, , inPath, outPath] = process.argv;
if (!inPath || !outPath) { console.error('usage: node tools/library/analyze.mjs in.f32 out.json'); process.exit(1); }
const buf = readFileSync(inPath);
const an = analyzeSong(new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4), ANALYSIS_SR);

const r4 = (v) => Math.round(v * 1e4) / 1e4; // 0.1 ms
const analysis = {
  duration: r4(an.duration),
  bpm: Math.round(an.bpm * 100) / 100,
  period: an.period,
  tempoConfidence: Math.round(an.tempoConfidence * 100) / 100,
  constantTempo: an.constantTempo,
  beats: Array.from(an.beats, r4),
  downbeat: an.downbeat,
  grid16: Array.from(an.grid16, r4),
  firstBeat16: an.firstBeat16,
  drumWindows: an.drumWindows.map((w) => ({ start: r4(w.start), end: r4(w.end) })),
};
const parts = {
  toy: usulPattern(an, 'toy').events.map((e) => ({ time: r4(e.time), code: e.code, gain: Math.round(e.gain * 100) / 100 })),
};
writeFileSync(outPath, JSON.stringify({ analysis, parts }));
