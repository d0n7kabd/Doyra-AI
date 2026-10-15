// Doyra Studio: pick a song, hear it with a doira in an usul.
import { audioContext, decode, toAnalysisPCM, analyze, StrokeBank } from './engine/audio.js';
import { Transport } from './engine/transport.js';
import { USULS } from './usuls.js';
import { usulPattern, groovePattern, cyclePositions } from './patterns.js';
import { GROOVES } from './grooves.js';
import { styleProfile, detectStyle } from './style.js';
import { Doira } from './doira.js';

const $ = (id) => document.getElementById(id);
const PLAYER = 'doniyor';

const state = {
  bank: null,
  transport: null,
  song: null,          // { id, title, artist, buffer, analysis }
  usul: 'auto',        // what the Rhythm control shows
  fit: true,
  feel: 'player',     // 'player' (measured gaps) or 'machine' (even)
  pattern: null,
  lastStroke: null,
  styles: null,        // data/styles.json
  style: null,         // { detected, confidence, scores, override }
};
const analyses = new Map(); // song id -> analysis (analyse each song once per visit)

const drum = new Doira($('drum'));

// ---------------------------------------------------------------- library

async function loadLibrary() {
  let songs = [];
  try {
    songs = (await (await fetch('library/index.json')).json()).songs || [];
  } catch (e) { /* no library: upload still works */ }
  const icon = '<svg viewBox="0 0 40 40" aria-hidden="true"><circle cx="20" cy="20" r="18" fill="none" stroke="#e0a93b" stroke-width="3"/><circle cx="20" cy="20" r="13" fill="#f1e4c8"/></svg>';
  $('songs').innerHTML = songs.map((s) => `
    <button class="card" data-id="${esc(s.id)}">${icon}<div><b>${esc(s.title)}</b><span>${esc(s.artist || '')}</span></div></button>`).join('') + `
    <label class="card add">
      <svg viewBox="0 0 40 40" aria-hidden="true"><circle cx="20" cy="20" r="18" fill="none" stroke="#f1e4c8" stroke-width="2" stroke-dasharray="4 4"/><path d="M20 13v14M13 20h14" stroke="#f1e4c8" stroke-width="2"/></svg>
      <div><b>Your song</b><span>choose a file</span></div>
      <input type="file" id="upload" accept="audio/*" aria-label="Choose a song file">
    </label>`;
  $('songs').querySelectorAll('[data-id]').forEach((card) => {
    const s = songs.find((x) => x.id === card.dataset.id);
    card.addEventListener('click', () => openLibrarySong(s));
  });
  $('upload').addEventListener('change', (e) => {
    const f = e.target.files[0];
    if (f) openFile(f);
    e.target.value = '';
  });
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// Library songs come with their analysis (tools/library/add_song.py), so they
// start at once. If the song's audio isn't on this computer (song files stay on
// the author's laptop, e.g. on the public website), the doira plays alone on
// the song's analysed beat.
async function openLibrarySong(s) {
  audioContext(); // inside the tap, so audio may start
  showPlayer(s.title, s.artist);
  drum.busy = true;
  try {
    const info = await (await fetch(`library/${s.id}.json`)).json();
    let audio = null;
    try {
      const r = await fetch(`library/${info.files.original}`);
      if (r.ok) audio = await r.arrayBuffer();
    } catch (e) { /* not on this computer */ }
    await startSong({ id: s.id, title: s.title, artist: s.artist, files: info.files, renderedStyle: info.style },
      audio ? await decode(audio) : null, info.analysis);
  } catch (e) {
    console.error(e);
    fail("This song couldn't be opened.");
  }
}

async function openFile(file) {
  audioContext();
  const title = file.name.replace(/\.[^.]+$/, '');
  showPlayer(title, 'your file');
  drum.busy = true;
  try {
    const id = `file:${file.name}:${file.size}`;
    const buffer = await decode(await file.arrayBuffer());
    $('subtitle').textContent = 'Listening to the song…';
    let an = analyses.get(id);
    if (!an) {
      an = await analyze(await toAnalysisPCM(buffer));
      analyses.set(id, an);
    }
    await startSong({ id, title, artist: 'your file' }, buffer, an);
  } catch (e) {
    console.error(e);
    fail("This file couldn't be read as audio. Try an mp3, m4a or wav.");
  }
}

// ---------------------------------------------------------------- song

async function startSong(meta, buffer, analysis) {
  stopSong();
  await ensureBank();
  drum.busy = false;
  state.song = { ...meta, buffer, analysis };
  state.style = await songStyle(analysis);
  const t = new Transport({ bank: state.bank });
  t.setSong(buffer, analysis.duration);
  t.onStroke(onStroke);
  state.transport = t;
  // without the song's audio only "Doira only" is possible
  const both = document.querySelector('[data-mix="both"]');
  both.disabled = !buffer;
  if (!buffer) setPressed('[data-group="mix"]', '[data-mix="doira"]');
  $('msg').textContent = buffer ? '' : "The song itself stays on the author's laptop. Here the doira plays alone, on the song's beat.";
  $('msg').hidden = !!buffer;
  applyMix();
  applyRhythm();
  $('player').hidden = false;
  t.play(0);
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
}

function showPlayer(title, artist) {
  $('songs').hidden = true;
  $('msg').hidden = true;
  $('player').hidden = true;
  $('title').textContent = title;
  $('subtitle').textContent = artist || '';
}

function fail(text) {
  drum.busy = false;
  $('msg').textContent = text;
  $('msg').hidden = false;
  $('subtitle').textContent = '';
  $('songs').hidden = false;
  $('title').textContent = 'Pick a song';
}

$('back').addEventListener('click', () => {
  stopSong();
  closeSheet();
  $('player').hidden = true;
  $('msg').hidden = true;
  $('songs').hidden = false;
  $('title').textContent = 'Pick a song';
  $('subtitle').textContent = 'or tap the drum';
  syncPP();
});

// ---------------------------------------------------------------- rhythm

// Auto plays the groove for the song's style (detected, or chosen in More).
// With no song yet, Auto shows to'y.
const currentStyle = () => (state.style ? state.style.override || state.style.detected : null);
// a style without a groove in grooves.js (e.g. a newly labelled one) plays to'y
const resolveUsul = () => (state.usul === 'auto' ? (GROOVES[currentStyle()] ? `groove:${currentStyle()}` : 'toy') : state.usul);
const isGroove = (id) => id.startsWith('groove:');

async function loadStyles() {
  if (!state.styles) {
    try { state.styles = await (await fetch('data/styles.json')).json(); } catch (e) { state.styles = { styles: {}, examples: [] }; }
  }
  return state.styles;
}

// Library songs carry their drum profile; uploads are profiled here.
async function songStyle(an) {
  const data = await loadStyles();
  const prof = an.style ? an.style : an.band16 ? styleProfile(an) : null;
  if (!prof || !prof.bars || !data.examples.length) return null;
  const r = detectStyle(prof.profile, data.examples);
  return { detected: r.style, confidence: r.confidence, scores: r.scores, override: null };
}

const styleName = (id) => (state.styles && state.styles.styles[id] ? state.styles.styles[id].name : id);

function beadsFor(id, positions) {
  if (isGroove(id)) {
    const g = GROOVES[id.slice(7)];
    const hits = [...g.steps].map((c, step) => ({ c, step })).filter((h) => h.c !== '.');
    return hits.map((h) => ({ code: h.c, pos: h.step / 16 }));
  }
  const u = USULS[id];
  const pos = positions || cyclePositions(u, u.gaps && state.feel === 'player' ? 1 : 0);
  return [...u.seq].map((code, k) => ({ code, pos: pos[k] }));
}

function applyRhythm() {
  const id = resolveUsul();
  if (isGroove(id)) return applyGroove(id.slice(7));
  const u = USULS[id];
  document.querySelector('[data-group="fit"]').hidden = id === 'toy';
  // usuls without measured gaps (1, 3) can only be played evenly
  document.querySelectorAll('[data-feel]').forEach((b) => { b.disabled = !u.gaps; });
  const s = state.song;
  if (!s) { drum.setBeads(beadsFor(id)); return; }
  state.pattern = usulPattern(s.analysis, id, { fit: state.fit, feel: state.feel });
  state.transport.setPattern(state.pattern);
  drum.setBeads(beadsFor(id, state.pattern.positions));
  const how = id === 'toy' ? 'one group per beat' : state.fit ? 'fit to the bar' : 'free against the bar';
  $('subtitle').textContent = `${s.artist ? s.artist + ' · ' : ''}${state.usul === 'auto' ? 'Auto: ' : ''}${u.name}, ${how}`;
  renderFacts();
}

function applyGroove(styleId) {
  document.querySelector('[data-group="fit"]').hidden = true;
  document.querySelectorAll('[data-feel]').forEach((b) => { b.disabled = true; });
  const s = state.song;
  state.pattern = groovePattern(s.analysis, styleId);
  state.transport.setPattern(state.pattern);
  drum.setBeads(beadsFor(`groove:${styleId}`));
  const st = state.style;
  const how = st.override ? 'your choice' : `${Math.round(st.confidence * 100)} % sure`;
  $('subtitle').textContent = `${s.artist ? s.artist + ' · ' : ''}Auto: ${styleName(styleId).toLowerCase()} (${how})`;
  renderFacts();
}

function applyMix() {
  const both = document.querySelector('[data-mix="both"]').getAttribute('aria-pressed') === 'true';
  if (state.transport) state.transport.setMix({ song: both ? 0.85 : 0, doira: 1 });
}

document.querySelectorAll('.seg').forEach((seg) => seg.addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  seg.querySelectorAll('button').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
  if (b.dataset.mix) applyMix();
  if (b.dataset.usul) { state.usul = b.dataset.usul; applyRhythm(); }
  if (b.dataset.fit) { state.fit = b.dataset.fit === 'fit'; applyRhythm(); }
  if (b.dataset.feel) { state.feel = b.dataset.feel; applyRhythm(); }
}));

function renderFacts() {
  const s = state.song;
  if (!s) return;
  const an = s.analysis, id = resolveUsul();
  const rows = [['Tempo', `${an.bpm.toFixed(1)} BPM`]];
  if (isGroove(id)) {
    const g = GROOVES[id.slice(7)];
    rows.push(['Rhythm', `${g.name}: ${g.steps.replace(/\./g, '·')} (a studio groove, not from the research)`]);
  } else {
    const u = USULS[id];
    rows.push(['Usul', `${u.name} · ${u.seq.length} strokes${u.note ? ` (${u.note})` : ''}`],
      ['Cycle', u.seq.split('').join(' ')], ['Feel', feelText(u)]);
  }
  rows.push(['Strokes', `${state.bank.label}, recorded`]);
  let html = rows.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('');

  // style: detected + confidence, and a choice that overrides it
  const st = state.style;
  if (st) {
    const detail = st.scores.map((x) => `${styleName(x.style)} ${Math.round(x.probability * 100)} %`).join(' · ');
    const pick = Object.keys(state.styles.styles).map((k) =>
      `<button data-style-pick="${esc(k)}" aria-pressed="${currentStyle() === k}">${esc(styleName(k))}</button>`).join('');
    html += `<dt>Style</dt><dd>Detected: ${esc(detail)}${st.override ? ` · <button class="link-btn" data-style-pick="">use detected</button>` : ''}
      <div class="seg small style-pick">${pick}</div></dd>`;
  } else {
    html += '<dt>Style</dt><dd>Not detected (no steady drums found)</dd>';
  }
  // the to'y renders made by add_song.py
  const f = s.files;
  if (f) {
    const links = [];
    if (s.buffer) {
      links.push([`library/${f.merged}`, "Song + doira (to'y)"], [`library/${f.doira}`, "Doira only (to'y)"]);
      if (f.grooveMerged) links.push([`library/${f.grooveMerged}`, `Song + doira (${s.renderedStyle ? styleName(s.renderedStyle.detected).toLowerCase() : 'style'} groove)`], [`library/${f.grooveDoira}`, 'Doira only (groove)']);
    }
    else links.push([`library/${f.doiraPublic}`, "Doira only (to'y)"]);
    html += `<dt>Download</dt><dd>${links.map(([href, label]) => `<a class="dl" href="${esc(href)}" download>${esc(label)}</a>`).join('<br>')}</dd>`;
  }
  $('facts').innerHTML = html;
}

// choosing a style in More overrides the detection; Auto then plays that groove
$('facts').addEventListener('click', (e) => {
  const b = e.target.closest('[data-style-pick]');
  if (!b || !state.style) return;
  state.style.override = b.dataset.stylePick || null;
  state.usul = 'auto';
  document.querySelectorAll('[data-usul]').forEach((x) => x.setAttribute('aria-pressed', String(x.dataset.usul === 'auto')));
  applyRhythm();
});

function feelText(u) {
  const p = state.pattern;
  if (!u.gaps) return 'Even: no measured gaps for this usul';
  if (state.feel === 'machine') return 'Machine: strokes evenly spaced';
  const pct = Math.round(p.feel * 100);
  const gapMs = Math.round(p.strokeGap * 1000);
  let why;
  if (!u.slow) why = 'no slow-tempo measurement, so the full measured feel is used';
  else if (pct === 100) why = `strokes ${gapMs} ms apart; recorded at ${Math.round(u.meanGap * 1000)} ms`;
  else why = `strokes ${gapMs} ms apart, slower than the recording (${Math.round(u.meanGap * 1000)} ms); the feel fades toward the slow recording (${Math.round(u.slow.gap * 1000)} ms)`;
  return `Player: ${pct} % of the measured feel (${why})`;
}

// ---------------------------------------------------------------- playback

function onStroke(ev) {
  drum.strike(ev.code, ev.k);
  state.lastStroke = ev;
}

$('pp').addEventListener('click', togglePlay);
function togglePlay() {
  const t = state.transport;
  if (!t) return;
  audioContext();
  if (t.playing) t.stop(true);
  else t.play(t.position >= t.duration - 0.1 ? 0 : t.position);
  syncPP();
}
function syncPP() {
  const on = !!(state.transport && state.transport.playing);
  $('pp').setAttribute('aria-pressed', String(on));
  $('pp').setAttribute('aria-label', on ? 'Pause' : 'Play');
}

// scrub bar
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

// "More" sheet
const sheet = $('sheet');
function closeSheet() { sheet.classList.remove('open'); }
$('more').addEventListener('click', () => { renderFacts(); sheet.classList.add('open'); $('close').focus(); });
$('close').addEventListener('click', closeSheet);
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeSheet(); });

// ---------------------------------------------------------------- frame loop

const fmt = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
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
    const ev = state.lastStroke;
    if (ev && t.playing) {
      const f = Math.max(0, Math.min(1, (pos - ev.time) / Math.max(0.01, ev.next - ev.time)));
      drum.progress = (ev.k + f) / ev.n;
    } else if (!ev) {
      drum.progress = -1;
    } // paused: the arc stays where it stopped
    if (!t.playing && $('pp').getAttribute('aria-pressed') === 'true') syncPP();
  }
  drum.draw(now, dt);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

drum.setBeads(beadsFor('toy'));
loadLibrary();
