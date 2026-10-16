// Tunes the browser transcription (full mix) against Demucs (drum stem) on the
// library songs that have exact drums (add_song.py with Demucs).
//
//   node tools/tune_transcription.mjs
//
// Reference: the Demucs stem transcribed with the current settings
// (TRANSCRIBE in js/engine/arranger.js). Agreement: positions both found,
// over positions either found, per section and band, counting only sections
// Demucs actually separated (elsewhere both use the full mix and would agree
// by default). Settings are chosen on the TUNE songs and reported on the TEST
// songs, which the choice never saw.
import { readFileSync } from 'node:fs';
import { arrange, TRANSCRIBE } from '../doyra-ai-site/studio/js/engine/arranger.js';

const TUNE = ['despacito', 'gasolina', 'levitating', 'lose-control', 'shape-of-you'];
const root = new URL('../doyra-ai-site/studio/library/', import.meta.url);
const index = JSON.parse(readFileSync(new URL('index.json', root), 'utf8'));
const songs = index.songs.map((s) => JSON.parse(readFileSync(new URL(`${s.id}.json`, root), 'utf8'))).filter((s) => s.drums16);

const BANDS = ['low', 'mid', 'high'];

// Did Demucs separate any bar of this section? (covered: grid index ranges)
function separated(song, s) {
  const grid = song.analysis.grid16;
  const idx = (t) => { let lo = 0, hi = grid.length; while (lo < hi) { const m = (lo + hi) >> 1; if (grid[m] < t) lo = m + 1; else hi = m; } return lo; };
  const a = idx(s.start - 1e-3), z = idx(s.end - 1e-3);
  return song.drums16.covered.some(([from, to]) => from < z && to > a);
}

export function agreement(song, params) {
  const common = { mode: 'drums', seed: song.seed };
  const ref = arrange(song.analysis, { ...common, drums16: song.drums16 }); // Demucs, current settings
  const mix = arrange(song.analysis, { ...common, transcribe: params });
  const tally = Object.fromEntries(BANDS.map((b) => [b, { both: 0, any: 0 }]));
  ref.sections.forEach((s, i) => {
    const r = s.transcription, m = mix.sections[i] && mix.sections[i].transcription;
    if (!r || !m || ['silent', 'none'].includes(s.level)) return;
    if (song.drums16.covered && !separated(song, s)) return;
    for (const b of BANDS) for (let p = 0; p < 16; p++) {
      if (r.hits[b][p] || m.hits[b][p]) { tally[b].any++; if (r.hits[b][p] && m.hits[b][p]) tally[b].both++; }
    }
  });
  const both = BANDS.reduce((a, b) => a + tally[b].both, 0), any = BANDS.reduce((a, b) => a + tally[b].any, 0);
  const pct = (t) => (t.any ? (100 * t.both) / t.any : 100);
  return { all: any ? (100 * both) / any : 100, both, any, kick: pct(tally.low), bak: pct(tally.mid), hat: pct(tally.high) };
}

const mean = (xs) => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);
const score = (ids, params) => {
  const r = songs.filter((s) => ids.includes(s.id)).map((s) => agreement(s, params));
  return { all: mean(r.map((x) => x.all)), bak: mean(r.map((x) => x.bak)) };
};

// candidate settings: stricter baks in three principled ways, alone and combined
const grid = [];
for (const sal of [0.55, 0.65, 0.75]) for (const peak of [0, 1.0, 1.15]) for (const maxBaks of [16, 4, 3]) {
  for (const low of [0.55, 0.7]) for (const high of [0.55, 0.7]) {
    grid.push({ salience: { mid: sal, low, high }, midPeak: peak, maxBaks });
  }
}

const testIds = songs.map((s) => s.id).filter((id) => !TUNE.includes(id));
console.log(`songs with Demucs exact drums: ${songs.length} (tune: ${TUNE.filter((id) => songs.some((s) => s.id === id)).join(', ')}; test: ${testIds.join(', ')})\n`);
const ranked = grid.map((p) => ({ p, tune: score(TUNE, p) })).sort((a, b) => b.tune.all - a.tune.all);
const show = (p) => `bak ${p.salience.mid}, peak ${p.midPeak || 'off'}, max ${p.maxBaks === 16 ? 'any' : p.maxBaks}, kick ${p.salience.low}, hat ${p.salience.high}`;
console.log('best settings on the tune songs:');
ranked.slice(0, 5).forEach((r) => console.log(`  ${show(r.p).padEnd(52)} agreement ${r.tune.all.toFixed(1)} %  (baks ${r.tune.bak.toFixed(1)} %)`));
const current = { salience: { ...TRANSCRIBE.salience }, midPeak: TRANSCRIBE.midPeak, maxBaks: TRANSCRIBE.maxBaks };
const best = ranked[0].p;
console.log(`\nper song (current -> best):`);
for (const s of songs) {
  const a = agreement(s, current), b = agreement(s, best);
  console.log(`  ${(TUNE.includes(s.id) ? 'tune ' : 'TEST ') + s.title.slice(0, 34).padEnd(36)} all ${a.all.toFixed(0).padStart(3)} % -> ${b.all.toFixed(0).padStart(3)} %   baks ${a.bak.toFixed(0).padStart(3)} % -> ${b.bak.toFixed(0).padStart(3)} %   kick ${b.kick.toFixed(0)} %  hat ${b.hat.toFixed(0)} %`);
}
const t0 = score(testIds, current), t1 = score(testIds, best);
console.log(`\nTEST songs (never used for choosing): ${t0.all.toFixed(1)} % -> ${t1.all.toFixed(1)} %  (baks ${t0.bak.toFixed(1)} % -> ${t1.bak.toFixed(1)} %)`);
console.log(`chosen: ${JSON.stringify(best)}`);
