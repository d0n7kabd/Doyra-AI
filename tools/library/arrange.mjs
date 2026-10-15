// Bridge for the pipeline: the studio's arranger (js/engine/arranger.js) on a
// song's stored analysis, giving the strokes to render.
//
//   node tools/library/arrange.mjs song.json out.json
// song.json: { analysis, drums16?, seed, style? }  ->  { drums, groove, toy } stroke lists
import { readFileSync, writeFileSync } from 'node:fs';
import { arrange } from '../../doyra-ai-site/studio/js/engine/arranger.js';

const [, , inPath, outPath] = process.argv;
const song = JSON.parse(readFileSync(inPath, 'utf8'));
const style = song.style ? song.style.detected : null;
const common = { seed: song.seed, style };
const ev = (fn) => fn.events.map((e) => ({ time: Math.round(e.time * 1e4) / 1e4, code: e.code, gain: Math.round(e.gain * 100) / 100 }));
const out = {
  drums: ev(arrange(song.analysis, { ...common, mode: 'drums', drums16: song.drums16 || null })),
  toy: ev(arrange(song.analysis, { ...common, mode: 'usul', usul: 'toy' })),
};
if (style) out.groove = ev(arrange(song.analysis, { ...common, mode: 'groove' }));
writeFileSync(outPath, JSON.stringify(out));
