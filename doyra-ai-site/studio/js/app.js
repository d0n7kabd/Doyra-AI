// Doyra Studio: pick a song, hear it with a doira in an usul.
import { audioContext, decode, toAnalysisPCM, analyze, StrokeBank } from './engine/audio.js';
import { Transport } from './engine/transport.js';
import { USULS } from './usuls.js';
import { usulPattern } from './patterns.js';
import { Doira } from './doira.js';

const $ = (id) => document.getElementById(id);
const PLAYER = 'doniyor';

const state = {
  bank: null,
  transport: null,
  song: null,          // { id, title, artist, buffer, analysis }
  usul: 'auto',        // what the Rhythm control shows
  fit: true,
  pattern: null,
  lastStroke: null,
};
const analyses = new Map(); // song id -> analysis (analyse each song once per visit)

const drum = new Doira($('drum'));
drum.setBeads(beadsFor('toy'));

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

async function openLibrarySong(s) {
  audioContext(); // inside the tap, so audio may start
  showPlayer(s.title, s.artist);
  try {
    const r = await fetch(`library/${s.original}`);
    if (!r.ok) throw new Error('missing');
    await openSong({ id: s.id, title: s.title, artist: s.artist }, await r.arrayBuffer());
  } catch (e) {
    fail("This song's audio isn't on this computer. Song files stay on the author's laptop; choose your own file instead.");
  }
}

async function openFile(file) {
  audioContext();
  const title = file.name.replace(/\.[^.]+$/, '');
  showPlayer(title, 'your file');
  try {
    await openSong({ id: `file:${file.name}:${file.size}`, title, artist: 'your file' }, await file.arrayBuffer());
  } catch (e) {
    console.error(e);
    fail("This file couldn't be read as audio. Try an mp3, m4a or wav.");
  }
}

// ---------------------------------------------------------------- song

async function openSong(meta, arrayBuffer) {
  stopSong();
  drum.busy = true;
  $('subtitle').textContent = 'Listening to the song…';
  const buffer = await decode(arrayBuffer);
  let an = analyses.get(meta.id);
  if (!an) {
    [an] = await Promise.all([analyze(await toAnalysisPCM(buffer)), ensureBank()]);
    analyses.set(meta.id, an);
  }
  await ensureBank();
  drum.busy = false;
  state.song = { ...meta, buffer, analysis: an };
  const t = new Transport({ bank: state.bank });
  t.setSong(buffer);
  t.onStroke(onStroke);
  state.transport = t;
  applyMix();
  applyRhythm();
  $('player').hidden = false;
  t.play(0);
  syncPP();
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
  $('songs').hidden = false;
  $('title').textContent = 'Pick a song';
  $('subtitle').textContent = 'or tap the drum';
  syncPP();
});

// ---------------------------------------------------------------- rhythm

// Until style detection exists, Auto plays to'y: it fits 4/4 songs naturally.
const resolveUsul = () => (state.usul === 'auto' ? 'toy' : state.usul);

function beadsFor(id) {
  const u = USULS[id];
  return [...u.seq].map((code, k) => ({ code, pos: k / u.seq.length }));
}

function applyRhythm() {
  const id = resolveUsul();
  const u = USULS[id];
  document.querySelector('[data-group="fit"]').hidden = id === 'toy';
  drum.setBeads(beadsFor(id));
  const s = state.song;
  if (!s) return;
  state.pattern = usulPattern(s.analysis, id, { fit: state.fit });
  state.transport.setPattern(state.pattern);
  const how = id === 'toy' ? 'one group per beat' : state.fit ? 'fit to the bar' : 'free against the bar';
  $('subtitle').textContent = `${s.artist ? s.artist + ' · ' : ''}${state.usul === 'auto' ? 'Auto: ' : ''}${u.name}, ${how}`;
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
}));

function renderFacts() {
  const s = state.song;
  if (!s) return;
  const an = s.analysis, u = USULS[resolveUsul()];
  const rows = [
    ['Tempo', `${an.bpm.toFixed(1)} BPM`],
    ['Usul', `${u.name} · ${u.seq.length} strokes${u.note ? ` (${u.note})` : ''}`],
    ['Cycle', u.seq.split('').join(' ')],
    ['Strokes', `${state.bank.label}, recorded`],
  ];
  $('facts').innerHTML = rows.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('');
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

loadLibrary();
