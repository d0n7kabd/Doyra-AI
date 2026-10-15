// Doyra Studio: pick a song (or bring your own) and hear it with a doira part
// built for that song: its own drums, a style groove, or an usul.
import { audioContext, decode, toAnalysisPCM, analyze, StrokeBank } from './engine/audio.js';
import { Transport } from './engine/transport.js';
import { arrange, bytesSeed } from './engine/arranger.js';
import { USULS } from './usuls.js';
import { usulPattern, cyclePositions } from './patterns.js';
import { GROOVES } from './grooves.js';
import { styleProfile, detectStyle } from './style.js';
import { Doira } from './doira.js';
import { detectEngine, processOnServer } from './engine-client.js';
import { saveSong, listSongs, getSong, hasSong, removeSong } from './mysongs.js';

const $ = (id) => document.getElementById(id);
const PLAYER = 'doniyor';
const LEVEL_NAME = { silent: 'no doira', none: 'soft cycle (no drums)', low: 'light', mid: 'medium', high: 'full' };

const state = {
  bank: null,
  transport: null,
  song: null,       // { id, title, artist, kind: library|upload|mine, buffer, analysis, seed, drums16, files, bytes, name }
  rhythm: 'auto',   // 'auto' or an usul id
  autoKind: 'drums',// what Auto plays: the song's own drums, or a style groove
  fit: true,
  feel: 'player',
  pattern: null,
  lastStroke: null,
  section: -1,
  styles: null,
  style: null,      // { detected, confidence, scores, override }
  engine: { kind: 'browser', demucs: false },
  job: 0,           // guards against a slow upload finishing after another song was opened
};

const drum = new Doira($('drum'));

// ---------------------------------------------------------------- engine

async function initEngine() {
  state.engine = await detectEngine();
  const el = $('engine');
  el.textContent = state.engine.kind === 'full'
    ? `AI engine: full (laptop)${state.engine.demucs ? '' : ', no Demucs'}` : 'AI engine: browser';
  el.classList.toggle('full', state.engine.kind === 'full');
}

// ---------------------------------------------------------------- song list

const ICON = '<svg viewBox="0 0 40 40" aria-hidden="true"><circle cx="20" cy="20" r="18" fill="none" stroke="#e0a93b" stroke-width="3"/><circle cx="20" cy="20" r="13" fill="#f1e4c8"/></svg>';

async function loadLibrary() {
  let songs = [];
  try { songs = (await (await fetch('library/index.json')).json()).songs || []; } catch (e) { /* upload still works */ }
  const mine = await listSongs();
  $('songs').innerHTML = mine.map((s) => `
    <div class="card-wrap"><button class="card" data-mine="${esc(s.id)}">${ICON}<div><b>${esc(s.title)}</b><span class="where">on this device</span></div></button>
    <button class="remove" data-remove="${esc(s.id)}" aria-label="Remove ${esc(s.title)} from my songs">×</button></div>`).join('')
    + songs.map((s) => `
    <button class="card" data-id="${esc(s.id)}">${ICON}<div><b>${esc(s.title)}</b><span>${esc(s.artist || '')}</span></div></button>`).join('') + `
    <label class="card add">
      <svg viewBox="0 0 40 40" aria-hidden="true"><circle cx="20" cy="20" r="18" fill="none" stroke="#f1e4c8" stroke-width="2" stroke-dasharray="4 4"/><path d="M20 13v14M13 20h14" stroke="#f1e4c8" stroke-width="2"/></svg>
      <div><b>Your song</b><span>choose a file</span></div>
      <input type="file" id="upload" accept="audio/*" aria-label="Choose a song file">
    </label>`;
  $('songs').querySelectorAll('[data-id]').forEach((c) => c.addEventListener('click', () => openLibrarySong(songs.find((x) => x.id === c.dataset.id))));
  $('songs').querySelectorAll('[data-mine]').forEach((c) => c.addEventListener('click', () => openMine(mine.find((x) => x.id === c.dataset.mine))));
  $('songs').querySelectorAll('[data-remove]').forEach((b) => b.addEventListener('click', async () => { await removeSong(b.dataset.remove); loadLibrary(); }));
  $('upload').addEventListener('change', (e) => { const f = e.target.files[0]; if (f) openFile(f); e.target.value = ''; });
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ---------------------------------------------------------------- opening songs

// Library songs come with their analysis (tools/library/add_song.py). If the
// song's audio isn't on this computer (the public website), the doira plays
// alone on the song's analysed beat.
async function openLibrarySong(s) {
  audioContext(); // inside the tap, so audio may start
  const job = ++state.job;
  showPlayer(s.title, s.artist);
  drum.busy = true;
  try {
    const info = await (await fetch(`library/${s.id}.json`)).json();
    let audio = null;
    try {
      const r = await fetch(`library/${info.files.original}`);
      if (r.ok) audio = await r.arrayBuffer();
    } catch (e) { /* not on this computer */ }
    const buffer = audio ? await decode(audio) : null;
    if (job !== state.job) return;
    await startSong({ id: s.id, title: s.title, artist: s.artist, kind: 'library', files: info.files,
      seed: info.seed, drums16: info.drums16 || null }, buffer, info.analysis);
  } catch (e) {
    console.error(e);
    fail("This song couldn't be opened.");
  }
}

// An upload: the laptop server when it's running (full pipeline, Demucs), else
// the browser. Either way the doira part is arranged for this song.
async function openFile(file) {
  audioContext();
  const job = ++state.job;
  const title = file.name.replace(/\.[^.]+$/, '');
  showPlayer(title, 'your file');
  drum.busy = true;
  try {
    const bytes = await file.arrayBuffer();
    const seed = bytesSeed(new Uint8Array(bytes));
    const buffer = await decode(bytes.slice(0)); // decoding detaches the buffer it's given
    const meta = { id: `upload:${seed}`, title, artist: '', kind: 'upload', seed, bytes, name: file.name };
    if (state.engine.kind === 'full') {
      $('subtitle').textContent = 'Listening to the song (laptop engine)…';
      let started = false;
      const result = await processOnServer(file, async (stage, partial, secs) => {
        if (job !== state.job) return;
        // the analysis arrives before Demucs finishes: start playing at once
        if (partial && partial.analysis && !started) {
          started = true;
          await startSong({ ...meta, engine: 'full' }, buffer, partial.analysis);
          if (state.engine.demucs) note(`Separating the drums (Demucs) for exact drums… this takes a few minutes on this laptop.`);
        }
        if (stage === 'separating drums' && started) note(`Separating the drums (Demucs)… ${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`);
      });
      if (job !== state.job) return;
      if (!started) await startSong({ ...meta, engine: 'full' }, buffer, result.analysis);
      if (result.drums16) {
        state.song.drums16 = result.drums16;
        applyRhythm();
        note('Exact drums ready: the doira now follows the separated drum track (Demucs).');
      } else note('');
    } else {
      $('subtitle').textContent = 'Listening to the song…';
      const an = await analyze(await toAnalysisPCM(buffer));
      if (job !== state.job) return;
      await startSong({ ...meta, engine: 'browser' }, buffer, an);
    }
    showKeep();
  } catch (e) {
    console.error(e);
    fail("This file couldn't be processed. Try an mp3, m4a or wav.");
  }
}

async function openMine(m) {
  audioContext();
  const job = ++state.job;
  showPlayer(m.title, m.artist);
  drum.busy = true;
  try {
    const d = await getSong(m.id);
    const buffer = await decode(d.bytes.slice(0));
    if (job !== state.job) return;
    await startSong({ id: m.id, title: m.title, artist: m.artist, kind: 'mine', seed: d.seed, drums16: d.drums16 || null, engine: d.engine },
      buffer, d.analysis);
  } catch (e) {
    console.error(e);
    fail("This song couldn't be opened from this browser's storage.");
  }
}

// ---------------------------------------------------------------- song

async function startSong(meta, buffer, analysis) {
  stopSong();
  await ensureBank();
  drum.busy = false;
  state.song = { ...meta, buffer, analysis };
  state.style = await songStyle(analysis);
  state.section = -1;
  const t = new Transport({ bank: state.bank });
  t.setSong(buffer, analysis.duration);
  t.onStroke(onStroke);
  state.transport = t;
  const both = document.querySelector('[data-mix="both"]');
  both.disabled = !buffer;
  setPressed('[data-group="mix"]', buffer ? '[data-mix="both"]' : '[data-mix="doira"]');
  note(buffer ? '' : "The song itself stays on the author's laptop. Here the doira plays alone, on the song's beat.");
  applyMix();
  applyRhythm();
  $('player').hidden = false;
  t.play(0);
  // browsers only start sound after a tap; if this start came too late, ask for one
  if (audioContext().state !== 'running') {
    t.stop(true);
    note('Tap ▶ to start the sound.');
  }
  syncPP();
}

function setPressed(groupSel, btnSel) {
  const g = document.querySelector(groupSel), b = document.querySelector(btnSel);
  g.querySelectorAll('button').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
}

async function ensureBank() {
  if (!state.bank) state.bank = await StrokeBank.load(new URL(`sounds/players/${PLAYER}/`, location.href));
  return state.bank;
}

function stopSong() {
  if (state.transport) state.transport.stop();
  state.transport = null;
  state.lastStroke = null;
  drum.progress = -1;
  $('keep-row').hidden = true;
}

function showPlayer(title, artist) {
  $('songs').hidden = true;
  $('msg').hidden = true;
  $('player').hidden = true;
  $('keep-row').hidden = true;
  $('title').textContent = title;
  $('subtitle').textContent = artist || '';
}

function note(text) {
  $('msg').textContent = text;
  $('msg').hidden = !text;
}

function fail(text) {
  drum.busy = false;
  note(text);
  $('subtitle').textContent = '';
  $('songs').hidden = false;
  $('title').textContent = 'Pick a song';
}

$('back').addEventListener('click', () => {
  state.job++;
  stopSong();
  closeSheet();
  $('player').hidden = true;
  note('');
  $('songs').hidden = false;
  $('title').textContent = 'Pick a song';
  $('subtitle').textContent = 'or tap the drum';
  syncPP();
});

// ---------------------------------------------------------------- keep an upload

async function showKeep() {
  const s = state.song;
  if (!s || s.kind !== 'upload') return;
  const kept = await hasSong(s.id);
  $('keep-row').hidden = false;
  $('keep').disabled = kept;
  $('keep').textContent = kept ? 'In my songs' : 'Add to my songs';
}

$('keep').addEventListener('click', async () => {
  const s = state.song;
  if (!s || !s.bytes) return;
  $('keep').disabled = true;
  try {
    await saveSong({ id: s.id, title: s.title, artist: s.artist },
      { bytes: s.bytes, analysis: s.analysis, seed: s.seed, drums16: s.drums16 || null, engine: s.engine });
    $('keep').textContent = 'In my songs';
    loadLibrary();
  } catch (e) {
    console.error(e);
    $('keep').disabled = false;
    $('keep-note').textContent = "couldn't save: this browser's storage is full or blocked";
  }
});

// ---------------------------------------------------------------- style

async function loadStyles() {
  if (!state.styles) {
    try { state.styles = await (await fetch('data/styles.json')).json(); } catch (e) { state.styles = { styles: {}, examples: [] }; }
  }
  return state.styles;
}

// Library and laptop analyses carry the drum profile; browser analyses are profiled here.
async function songStyle(an) {
  const data = await loadStyles();
  const prof = an.style && an.style.profile ? an.style : an.band16 ? styleProfile(an) : null;
  if (!prof || !prof.bars || !data.examples.length) return null;
  const r = detectStyle(prof.profile, data.examples);
  return { detected: r.style, confidence: r.confidence, scores: r.scores, override: null };
}
const currentStyle = () => (state.style ? state.style.override || state.style.detected : null);
const styleName = (id) => (state.styles && state.styles.styles[id] ? state.styles.styles[id].name : id);

// ---------------------------------------------------------------- rhythm

function modeNow() {
  if (state.rhythm !== 'auto') return 'usul';
  if (state.autoKind === 'groove' && GROOVES[currentStyle()]) return 'groove';
  return state.song && state.song.analysis.band16 ? 'drums' : 'usul';
}
const usulNow = () => (state.rhythm === 'auto' ? 'toy' : state.rhythm);

function applyRhythm() {
  const mode = modeNow(), usul = usulNow(), u = USULS[usul];
  document.querySelector('[data-group="fit"]').hidden = !(mode === 'usul' && usul !== 'toy');
  // usuls without measured gaps (1, 3) can only be played evenly
  document.querySelectorAll('[data-feel]').forEach((b) => { b.disabled = mode === 'usul' && !u.gaps; });
  const s = state.song;
  if (!s) { drum.setBeads([...u.seq].map((code, k) => ({ code, pos: cyclePositions(u, state.feel === 'player' ? 1 : 0)[k] }))); return; }
  state.pattern = arrange(s.analysis, {
    mode, usul, fit: state.fit, feel: state.feel, style: currentStyle(), seed: s.seed, drums16: s.drums16,
  });
  state.transport.setPattern(state.pattern);
  state.section = -1; // the frame loop shows the beads of the section being played
  drawSections();
  const who = s.artist ? `${s.artist} · ` : '';
  if (mode === 'drums') $('subtitle').textContent = `${who}Auto: the song's own drums${s.drums16 ? ' (exact, Demucs)' : ''}`;
  else if (mode === 'groove') {
    const st = state.style;
    $('subtitle').textContent = `${who}Auto: ${styleName(currentStyle()).toLowerCase()} groove (${st.override ? 'your choice' : `${Math.round(st.confidence * 100)} % sure`})`;
  } else {
    const how = usul === 'toy' ? 'one group per beat' : state.fit ? 'fit to the bar' : 'free against the bar';
    $('subtitle').textContent = `${who}${u.name}, ${how}`;
  }
  renderFacts();
}

function applyMix() {
  const both = document.querySelector('[data-mix="both"]').getAttribute('aria-pressed') === 'true';
  if (state.transport) state.transport.setMix({ song: both ? 0.85 : 0, doira: 1 });
}

document.querySelectorAll('.seg').forEach((seg) => seg.addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b || b.disabled) return;
  seg.querySelectorAll('button').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
  if (b.dataset.mix) applyMix();
  if (b.dataset.usul) { state.rhythm = b.dataset.usul; applyRhythm(); }
  if (b.dataset.fit) { state.fit = b.dataset.fit === 'fit'; applyRhythm(); }
  if (b.dataset.feel) { state.feel = b.dataset.feel; applyRhythm(); }
}));

// song sections on the timeline
function drawSections() {
  const s = state.song, p = state.pattern;
  if (!s || !p || !p.sections) { $('sections').innerHTML = ''; return; }
  const d = s.analysis.duration;
  $('sections').innerHTML = p.sections.map((x) =>
    `<i class="${x.level}" style="left:${(x.start / d) * 100}%;width:${((x.end - x.start) / d) * 100}%" title="${x.label}: ${LEVEL_NAME[x.level]}"></i>`).join('');
}

// ---------------------------------------------------------------- More

function renderFacts() {
  const s = state.song;
  if (!s) return;
  const an = s.analysis, mode = modeNow(), p = state.pattern;
  const rows = [['Tempo', `${an.bpm.toFixed(1)} BPM`]];
  if (mode === 'drums') {
    rows.push(['Rhythm', `The song's own drums, transcribed per section (kick → bum, snare/clap → bak, hi-hat → kichik bak; a position counts if it repeats in 3 of 4 bars)${s.drums16 ? ', from the drum track separated by Demucs' : ', from the full mix'}`]);
  } else if (mode === 'groove') {
    const g = GROOVES[currentStyle()];
    rows.push(['Rhythm', `${g.name}: ${g.steps.replace(/\./g, '·')} (a studio groove, not from the research)`]);
  } else {
    const u = USULS[usulNow()];
    rows.push(['Usul', `${u.name} · ${u.seq.length} strokes${u.note ? ` (${u.note})` : ''}`], ['Cycle', u.seq.split('').join(' ')]);
  }
  rows.push(['Feel', feelText(mode)]);
  if (p && p.sections) {
    rows.push(['Sections', p.sections.map((x) => `${x.label} ${fmt(x.start)} ${LEVEL_NAME[x.level]}`).join(' · ')
      + '. A roll leads into each new section; every 4th bar or cycle varies a little.']);
  }
  rows.push(['Strokes', `${state.bank.label}, recorded`]);
  rows.push(['AI engine', s.kind === 'library' ? 'analysed on the author\'s laptop (add_song.py)'
    : s.engine === 'full' ? `full (laptop)${s.drums16 ? ', exact drums by Demucs' : ''}` : 'browser (no drum separation)']);
  let html = rows.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('');

  // style: detected + confidence; choosing one plays its groove
  const st = state.style;
  if (st) {
    const detail = st.scores.map((x) => `${styleName(x.style)} ${Math.round(x.probability * 100)} %`).join(' · ');
    const grooveOn = mode === 'groove';
    const pick = `<button data-own-drums aria-pressed="${state.rhythm === 'auto' && !grooveOn}">Song's drums</button>`
      + Object.keys(state.styles.styles).filter((k) => GROOVES[k]).map((k) =>
        `<button data-style-pick="${esc(k)}" aria-pressed="${grooveOn && currentStyle() === k}">${esc(styleName(k))} groove</button>`).join('');
    html += `<dt>Style</dt><dd>Detected: ${esc(detail)}${st.override ? ` · <button class="link-btn" data-style-pick="">use detected</button>` : ''}
      <div class="seg small style-pick">${pick}</div></dd>`;
  } else {
    html += '<dt>Style</dt><dd>Not detected (no steady drums found)</dd>';
  }
  const f = s.files;
  if (f) {
    const links = [];
    if (s.buffer) {
      if (f.merged) links.push([`library/${f.merged}`, 'Song + doira (Auto)'], [`library/${f.doira}`, 'Doira only (Auto)']);
      if (f.toyMerged) links.push([`library/${f.toyMerged}`, "Song + doira (to'y)"]);
      if (f.grooveMerged) links.push([`library/${f.grooveMerged}`, 'Song + doira (style groove)']);
    } else if (f.doiraPublic) links.push([`library/${f.doiraPublic}`, 'Doira only (Auto)']);
    if (links.length) html += `<dt>Download</dt><dd>${links.map(([href, label]) => `<a class="dl" href="${esc(href)}" download>${esc(label)}</a>`).join('<br>')}</dd>`;
  }
  $('facts').innerHTML = html;
}

$('facts').addEventListener('click', (e) => {
  const own = e.target.closest('[data-own-drums]');
  const b = e.target.closest('[data-style-pick]');
  if (!own && !b) return;
  if (own) state.autoKind = 'drums';
  else if (state.style) {
    state.style.override = b.dataset.stylePick || null;
    state.autoKind = b.dataset.stylePick ? 'groove' : state.autoKind;
  }
  state.rhythm = 'auto';
  document.querySelectorAll('[data-usul]').forEach((x) => x.setAttribute('aria-pressed', String(x.dataset.usul === 'auto')));
  applyRhythm();
});

function feelText(mode) {
  if (state.feel === 'machine') return 'Machine: strokes on the grid, evenly';
  const s = state.song;
  if (mode !== 'usul') {
    const p = state.pattern;
    return `Player: adjacent baks come ${Math.round(p.bakTighten * 100 * p.feel)} % closer, as measured in to'y (${Math.round(p.feel * 100)} % of the measured feel at this tempo)`;
  }
  const u = USULS[usulNow()];
  if (!u.gaps) return 'Even: no measured gaps for this usul';
  const up = usulPattern(s.analysis, usulNow(), { fit: state.fit, feel: state.feel });
  const pct = Math.round(up.feel * 100), gapMs = Math.round(up.strokeGap * 1000);
  let why;
  if (!u.slow) why = 'no slow-tempo measurement, so the full measured feel is used';
  else if (pct === 100) why = `strokes ${gapMs} ms apart; recorded at ${Math.round(u.meanGap * 1000)} ms`;
  else why = `strokes ${gapMs} ms apart, slower than the recording (${Math.round(u.meanGap * 1000)} ms); the feel fades toward the slow recording (${Math.round(u.slow.gap * 1000)} ms)`;
  return `Player: ${pct} % of the measured feel (${why})`;
}

// ---------------------------------------------------------------- playback

function onStroke(ev) {
  drum.strike(ev.code, ev.k >= 0 ? ev.k : undefined);
  if (ev.k >= 0) state.lastStroke = ev;
}

$('pp').addEventListener('click', togglePlay);
function togglePlay() {
  const t = state.transport;
  if (!t) return;
  audioContext();
  if (t.playing) t.stop(true);
  else {
    if ($('msg').textContent.startsWith('Tap ▶')) note('');
    t.play(t.position >= t.duration - 0.1 ? 0 : t.position);
  }
  syncPP();
}
function syncPP() {
  const on = !!(state.transport && state.transport.playing);
  $('pp').setAttribute('aria-pressed', String(on));
  $('pp').setAttribute('aria-label', on ? 'Pause' : 'Play');
}

const scrub = $('scrub');
function seekFromPointer(e) {
  const t = state.transport;
  if (!t) return;
  const r = scrub.getBoundingClientRect();
  t.seek(Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * t.duration);
  state.lastStroke = null;
}
scrub.addEventListener('pointerdown', (e) => { scrub.setPointerCapture(e.pointerId); seekFromPointer(e); });
scrub.addEventListener('pointermove', (e) => { if (scrub.hasPointerCapture(e.pointerId)) seekFromPointer(e); });
scrub.addEventListener('keydown', (e) => {
  const t = state.transport;
  if (!t) return;
  if (e.key === 'ArrowRight') t.seek(t.position + 5);
  if (e.key === 'ArrowLeft') t.seek(t.position - 5);
});
document.addEventListener('keydown', (e) => {
  if (e.code === 'Space' && state.transport && !e.target.closest('button, input')) { e.preventDefault(); togglePlay(); }
});

// tap the drum: centre = bum, rim = bak (real strokes, any time)
$('drum').addEventListener('pointerdown', async (e) => {
  const r = $('drum').getBoundingClientRect();
  const x = e.clientX - r.left - r.width / 2, y = e.clientY - r.top - r.height / 2;
  const code = drum.hitTest(x, y);
  if (!code) return;
  drum.strike(code, undefined, { x, y });
  const ctx = audioContext();
  const t0 = ctx.currentTime;
  await ensureBank();
  if (ctx.currentTime - t0 < 0.5) state.bank.play(code, ctx.currentTime, { destination: state.transport ? state.transport.master : undefined });
});

const sheet = $('sheet');
function closeSheet() { sheet.classList.remove('open'); }
$('more').addEventListener('click', () => { renderFacts(); sheet.classList.add('open'); $('close').focus(); });
$('close').addEventListener('click', closeSheet);
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeSheet(); });

// ---------------------------------------------------------------- frame loop

const fmt = (sec) => `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, '0')}`;
let last = performance.now() / 1000;
function frame() {
  const now = performance.now() / 1000, dt = Math.min(0.05, now - last);
  last = now;
  const t = state.transport;
  if (t) {
    t.tick();
    const pos = t.position;
    $('scrub-fill').style.width = `${(pos / t.duration) * 100}%`;
    scrub.setAttribute('aria-valuenow', String(Math.round((pos / t.duration) * 100)));
    $('time').textContent = fmt(pos);
    // the beads show the pattern of the section being played
    const secs = state.pattern && state.pattern.sections;
    if (secs && secs.length) {
      let i = secs.findIndex((x) => pos >= x.start - 0.05 && pos < x.end);
      if (i < 0) i = pos < secs[0].start ? 0 : secs.length - 1;
      if (i !== state.section) { state.section = i; if (secs[i].beads && secs[i].beads.length) drum.setBeads(secs[i].beads); }
    }
    const ev = state.lastStroke;
    const beads = drum.beads;
    if (ev && t.playing && beads[ev.k]) {
      const f = Math.max(0, Math.min(1, (pos - ev.time) / Math.max(0.01, ev.next - ev.time)));
      const a = beads[ev.k].target, b = ev.k + 1 < beads.length ? beads[ev.k + 1].target : 1;
      drum.progress = a + f * (b - a);
    } else if (!ev) {
      drum.progress = -1;
    }
    if (!t.playing && $('pp').getAttribute('aria-pressed') === 'true') syncPP();
  }
  drum.draw(now, dt);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

applyRhythm();
initEngine();
loadLibrary();
