// Style detection on every library song, using the studio's own code.
// A song's own label is left out when it is classified (leave-one-out), so the
// report shows how detection would do on a song it has never seen.
//
//   node tools/library/style_report.mjs
import { readFileSync } from 'node:fs';
import { detectStyle } from '../../doyra-ai-site/studio/js/style.js';

const root = new URL('../../doyra-ai-site/studio/', import.meta.url);
const data = JSON.parse(readFileSync(new URL('data/styles.json', root), 'utf8'));
const index = JSON.parse(readFileSync(new URL('library/index.json', root), 'utf8'));
const name = (id) => (data.styles[id] ? data.styles[id].name : id);

let right = 0, labelled = 0;
for (const s of index.songs) {
  const song = JSON.parse(readFileSync(new URL(`library/${s.id}.json`, root), 'utf8'));
  const prof = song.analysis.style;
  if (!prof || !prof.bars) { console.log(`${s.title.padEnd(42)} no drum profile`); continue; }
  const label = data.examples.find((e) => e.id === s.id);
  const r = detectStyle(prof.profile, data.examples.filter((e) => e.id !== s.id));
  const scores = r.scores.map((x) => `${name(x.style)} ${Math.round(x.probability * 100)}%`).join(', ');
  let mark = '';
  if (label) { labelled++; if (label.style === r.style) { right++; mark = '  ✓ label: ' + name(label.style); } else mark = '  ✗ label: ' + name(label.style); }
  console.log(`${s.title.padEnd(42)} ${name(r.style).padEnd(10)} (${scores}; nearest: ${r.nearest.id})${mark}`);
}
if (labelled) console.log(`\nlabelled songs detected correctly (leave-one-out): ${right}/${labelled}`);
