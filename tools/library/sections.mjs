// Bridge for the pipeline: the arranger's bars and sections for a stored
// analysis, so Demucs can separate just a few bars of each drum section.
//
//   node tools/library/sections.mjs analysis.json out.json
import { readFileSync, writeFileSync } from 'node:fs';
import { barsOf, findSections } from '../../doyra-ai-site/studio/js/engine/arranger.js';

const [, , inPath, outPath] = process.argv;
const an = JSON.parse(readFileSync(inPath, 'utf8'));
const bars = barsOf(an);
const sections = findSections(bars).map((s) => ({ from: s.from, to: s.to, level: s.level }));
writeFileSync(outPath, JSON.stringify({ bars: bars.map((b) => ({ g: b.g, start: b.start, end: b.end })), sections }));
