// Checks the song-specific arranger (studio/js/engine/arranger.js) on a song.
//
//   node tools/check_arranger.mjs song.f32 [--key key.json] [--stem drums.f32 | --drums16 bands.json]
//
// song.f32 / drums.f32: mono float32 at 22050 Hz (tools/make_engine_test.py decode,
// or the Demucs drum stem). --key: answer key from make_engine_test.py synth.
// Reports tempo, style, sections with their transcribed bar pattern, the share of
// the real drum hits the transcription matched (with --key), agreement between
// the browser transcription (full mix) and the Demucs one (with --stem), and
// that the arrangement is the same when run twice.
import { readFileSync } from 'node:fs';
import { analyzeSong, bandsOnGrid } from '../doyra-ai-site/studio/js/engine/analysis.js';
import { arrange, audioSeed } from '../doyra-ai-site/studio/js/engine/arranger.js';
import { styleProfile, detectStyle } from '../doyra-ai-site/studio/js/style.js';

const args = process.argv.slice(2);
const opt = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : null; };
const load = (p) => { const b = readFileSync(p); return new Float32Array(b.buffer, b.byteOffset, b.byteLength / 4); };
const x = load(args[0]);
const an = analyzeSong(x);
const examples = JSON.parse(readFileSync(new URL('../doyra-ai-site/studio/data/styles.json', import.meta.url), 'utf8')).examples;
const st = detectStyle(styleProfile(an).profile, examples);
const seed = audioSeed(x);

const browser = arrange(an, { mode: 'drums', seed, style: st.style });
const again = arrange(an, { mode: 'drums', seed, style: st.style });
const same = browser.events.length === again.events.length && browser.events.every((e, i) => e.time === again.events[i].time && e.code === again.events[i].code);

console.log(`tempo ${an.bpm.toFixed(2)} BPM · style ${st.style} (${Math.round(st.confidence * 100)} %) · ${browser.events.length} strokes · deterministic: ${same ? 'yes' : 'NO'}`);
console.log('sections (bars, level, transcribed pattern: B/b bum, T/t bak, K/k kichik bak):');
for (const s of browser.sections) {
  console.log(`  ${s.label}  ${String(s.from).padStart(3)}-${String(s.to).padEnd(3)} ${s.level.padEnd(6)} ${s.transcription ? s.transcription.steps : '-'}   played: ${s.steps}`);
}

const bandSets = (arr) => arr.sections.map((s) => s.transcription && s.transcription.hits);

// --- against an answer key: share of real drum hits whose bar position the
// transcription of their section contains
const keyPath = opt('--key');
if (keyPath) {
  const key = JSON.parse(readFileSync(keyPath, 'utf8'));
  const g0 = an.firstBeat16 + an.downbeat * 4;
  const result = {};
  for (const [inst, band] of [['kick', 'low'], ['snare', 'mid'], ['hat', 'high']]) {
    let matched = 0, total = 0;
    for (const t of key.onsets[inst]) {
      let i = 0, best = Infinity;
      for (let j = 0; j < an.grid16.length; j++) { const d = Math.abs(an.grid16[j] - t); if (d < best) { best = d; i = j; } }
      const sec = browser.sections.find((s) => t >= s.start - 0.05 && t < s.end);
      total++;
      if (!sec || !sec.transcription || best > 0.03) continue;
      const pos = (((i - g0) % 16) + 16) % 16;
      if (sec.transcription.hits[band][pos]) matched++;
    }
    result[inst] = `${Math.round((100 * matched) / total)} % of ${total}`;
  }
  // and nothing extra: transcribed positions that are not in the real pattern
  const extra = {};
  for (const [inst, band] of [['kick', 'low'], ['snare', 'mid'], ['hat', 'high']]) {
    const truth = new Set(key.onsets[inst].map((t) => {
      let i = 0, best = Infinity;
      for (let j = 0; j < an.grid16.length; j++) { const d = Math.abs(an.grid16[j] - t); if (d < best) { best = d; i = j; } }
      return (((i - g0) % 16) + 16) % 16;
    }));
    const sec = browser.sections.filter((s) => s.transcription && s.level !== 'none' && s.level !== 'silent');
    extra[inst] = [...new Set(sec.flatMap((s) => s.transcription.hits[band].map((h, p) => (h && !truth.has(p) ? p : -1)).filter((p) => p >= 0)))];
  }
  console.log(`answer key  hits matched: kick ${result.kick}, snare ${result.snare}, hi-hat ${result.hat}`);
  console.log(`            extra positions (not in the real pattern): kick [${extra.kick}], snare [${extra.snare}], hi-hat [${extra.hat}]`);
}

// --- browser (full mix) vs Demucs (drum stem) transcription
const stemPath = opt('--stem'), bandsPath = opt('--drums16');
if (stemPath || bandsPath) {
  // --drums16: exact drums as the laptop pipeline stores them (may cover only some bars)
  const drums16 = stemPath ? bandsOnGrid(load(stemPath), an.grid16) : JSON.parse(readFileSync(bandsPath, 'utf8'));
  const demucs = arrange(an, { mode: 'drums', seed, style: st.style, drums16 });
  console.log('Demucs (drum stem) patterns:');
  demucs.sections.forEach((s) => console.log(`  ${s.label}  ${String(s.from).padStart(3)}-${String(s.to).padEnd(3)} ${s.transcription ? s.transcription.steps : '-'}`));
  const a = bandSets(browser), b = bandSets(demucs);
  let agree = 0, union = 0;
  a.forEach((ha, i) => {
    if (!ha || !b[i]) return;
    for (const band of ['low', 'mid', 'high']) for (let p = 0; p < 16; p++) {
      if (ha[band][p] || b[i][band][p]) { union++; if (ha[band][p] && b[i][band][p]) agree++; }
    }
  });
  console.log(`browser vs Demucs: ${union ? Math.round((100 * agree) / union) : 100} % of drum hits in common (${agree}/${union} positions)`);
}
