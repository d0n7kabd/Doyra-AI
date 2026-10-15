// Bridge for the pipeline: kick / snare / hi-hat strength of a drum stem
// (Demucs) on the song's 16th grid, with the studio's own analysis code.
//
//   node tools/library/drum_bands.mjs stem.f32 grid.json out.json
import { readFileSync, writeFileSync } from 'node:fs';
import { bandsOnGrid } from '../../doyra-ai-site/studio/js/engine/analysis.js';

const [, , stemPath, gridPath, outPath] = process.argv;
const b = readFileSync(stemPath);
const grid16 = JSON.parse(readFileSync(gridPath, 'utf8'));
const bands = bandsOnGrid(new Float32Array(b.buffer, b.byteOffset, b.byteLength / 4), grid16);
const r2 = (arr) => Array.from(arr, (v) => Math.round(v * 100) / 100);
writeFileSync(outPath, JSON.stringify({ low: r2(bands.low), mid: r2(bands.mid), high: r2(bands.high) }));
