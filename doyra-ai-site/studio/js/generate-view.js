// The Generate screen: pick an usul, press play, and new doira playing keeps
// coming, with no song. The drum shows each stroke; the strip shows each cycle.
import { Generator, loadData, BLIND_TESTED } from './generate.js';
import { USULS } from './usuls.js';

const $ = (id) => document.getElementById(id);
const fmt = (sec) => `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, '0')}`;
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const SOURCE_NAME = { recorded: 'his playing', pattern: 'taught pattern' };
const ENERGY_NAME = { him: 'like him', calm: 'calm', build: 'build', full: 'full' };
const usulName = (id) => (id === 'u6' ? 'Usul 6 (rez)' : USULS[id].name);

export function initGenerateView({ drum, onOpen, onClose, openSheet }) {
  const gen = new Generator();
  let open = false, shownItem = -1, stripKey = '', busy = false;

  // ------------------------------------------------------------ open / close

  async function show() {
    onOpen();
    open = true;
    $('gen').hidden = false;
    $('title').textContent = 'Generate';
    resetStrip();
    status();
    beadsForIdle();
    drum.busy = true;
    try {
      gen.data = await loadData();
      gen.prepare().catch(() => {});
      tempoLabel();
      $('gen-msg').hidden = true;
    } catch (e) {
      console.error(e);
      msg("The generator's recordings aren't on this computer (studio/generate/).");
    }
    drum.busy = false;
    syncControls();
  }

  function hide() {
    gen.stop();
    open = false;
    $('gen').hidden = true;
    drum.progress = -1;
    syncPP();
    onClose();
  }

  function msg(text) { $('gen-msg').textContent = text; $('gen-msg').hidden = !text; }

  // ------------------------------------------------------------ controls

  function syncControls() {
    const o = gen.opts;
    document.querySelectorAll('#gen [data-gen]').forEach((seg) => {
      const key = seg.dataset.gen;
      seg.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.v === String(o[key]))));
    });
    $('gen-pattern-ctl').hidden = o.source !== 'pattern';
    $('gen-recorded-note').hidden = o.source !== 'recorded';
    const d = gen.usulData();
    if (d) $('gen-recorded-note').textContent = `Tempo: his own, about ${Math.round(60 / d.beat)} beats a minute. Every stroke and pause inside a cycle is his.`;
    tempoLabel();
  }

  function tempoLabel() {
    const o = gen.opts, u = USULS[o.usul], d = gen.usulData();
    const base = u.meanGap || (d && d.cycleDur / u.seq.length);
    if (!base) { $('gen-tempo-val').textContent = `${o.tempo} %`; return; }
    const spm = Math.round(60 / (base * 100 / o.tempo));
    $('gen-tempo-val').textContent = `${o.tempo} % · ${spm} strokes a minute`;
  }

  document.querySelectorAll('#gen [data-gen]').forEach((seg) => seg.addEventListener('click', async (e) => {
    const b = e.target.closest('button');
    if (!b || b.disabled) return;
    const key = seg.dataset.gen;
    const restart = key === 'usul' || key === 'source';
    if (restart && gen.playing) drum.busy = true;
    try {
      await gen.set({ [key]: b.dataset.v });
    } catch (err) {
      console.error(err);
      msg("This usul's recording couldn't be loaded.");
    }
    drum.busy = false;
    if (restart) { shownItem = -1; resetStrip(); if (!gen.playing) beadsForIdle(); }
    syncControls();
    status();
  }));

  $('gen-tempo').addEventListener('input', (e) => { gen.set({ tempo: Number(e.target.value) }); tempoLabel(); });

  // ------------------------------------------------------------ play

  async function toggle() {
    if (busy) return;
    if (gen.playing) { gen.stop(); drum.progress = -1; syncPP(); status(); updateSave(); return; }
    busy = true;
    drum.busy = true;
    try {
      await gen.play();
      msg('');
    } catch (e) {
      console.error(e);
      msg("The generator couldn't start: its recordings didn't load.");
    }
    drum.busy = false;
    busy = false;
    shownItem = -1;
    if (gen.playing) resetStrip();
    syncPP();
  }
  $('gen-pp').addEventListener('click', toggle);
  document.addEventListener('keydown', (e) => {
    if (open && e.code === 'Space' && !e.target.closest('button, input')) { e.preventDefault(); toggle(); }
  });

  function syncPP() {
    $('gen-pp').setAttribute('aria-pressed', String(gen.playing));
    $('gen-pp').setAttribute('aria-label', gen.playing ? 'Stop' : 'Play');
  }

  // ------------------------------------------------------------ save

  function updateSave() {
    const t = gen.playing ? gen.elapsed : gen.lastTake.length || 0;
    $('gen-save').textContent = t > 2 ? `Save this take (${fmt(Math.min(t, 300))})` : 'Save 1 minute';
  }

  $('gen-save').addEventListener('click', async () => {
    const btn = $('gen-save');
    btn.disabled = true;
    const label = btn.textContent;
    btn.textContent = 'Rendering…';
    try {
      const { blob, opts } = await gen.render();
      const a = document.createElement('a');
      const d = new Date(), stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}-${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}`;
      a.href = URL.createObjectURL(blob);
      a.download = `doyra_${opts.usul}_${opts.source}_${stamp}.wav`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 10000);
      btn.textContent = 'Saved';
      setTimeout(updateSave, 1500);
    } catch (e) {
      console.error(e);
      btn.textContent = label;
      msg("Couldn't render the take.");
    }
    btn.disabled = false;
  });

  // ------------------------------------------------------------ how it works

  $('gen-more').addEventListener('click', () => {
    const o = gen.opts, d = gen.usulData(), u = USULS[o.usul];
    const rows = [['Usul', `${usulName(o.usul)} · taught cycle: ${u.seq.split('').join(' ')} (${u.seq.length} strokes)`]];
    if (o.source === 'recorded') {
      rows.push(['Source', `His playing: ${d ? d.cycles.length : '…'} whole cycles of ${d ? d.per : '…'} beats cut from his free take${d ? ` (${d.minutes.toFixed(1)} min)` : ''}. Nothing inside a cycle is changed.`]);
      rows.push(['How the next cycle is chosen', 'While one cycle plays, the next is picked by cost: a join only where the beat types on both sides match a join he played, close in loudness and in tempo across the join, near the loudness the energy asks for, and not one of the last six cycles. Steady prefers his own next cycle; Varied prefers a new one. The cycles meet with a 30 ms crossfade.']);
      rows.push(['Tested', BLIND_TESTED.has(o.usul)
        ? 'In the blind test (Nov 2026) his current doira teacher picked the real take in most pairs, and the joins between cycles gave it away. Since then a join must also match loudness and tempo; that version has not been re-tested.'
        : 'This usul was not in the blind test.']);
    } else {
      rows.push(['Source', 'The taught cycle, played with strokes cut from his taught recordings (kichik bum, kichik bak, bak). Each stroke is stopped 12 ms after the next one starts, as a hand would.']);
      rows.push(['Feel', u.gaps ? (o.feel === 'player' ? 'Player: the measured gaps of this usul, fading toward even at slow tempos as measured; ±4 ms of human scatter' : 'Machine: strokes evenly spaced') : 'Even: no measured gaps for this usul yet']);
      rows.push(['Variation', o.variation === 'varied' ? 'Varied: a grace stroke from the other hand every 4th cycle, a rez roll (alternating hands, rising) into every 8th' : 'Steady: the cycle as taught, every time']);
    }
    rows.push(['Energy', { him: 'Like him: the loudness of each cycle follows his own take, from a random point in it', calm: 'Calm: his quieter cycles', build: 'Build: rises over 16 cycles, then starts again', full: 'Full: his louder cycles' }[o.energy]]);
    if (gen.playing) rows.push(['This take', `${gen.items.filter((it) => it.at <= gen.elapsed).length} cycles · ${gen.joins} ${o.source === 'recorded' ? 'new joins' : 'variations'} · seed ${gen.seed}`]);
    rows.push(['Save', 'Renders exactly the take you heard (up to 5 min) as a WAV file; with nothing played, a new minute.']);
    $('facts').innerHTML = rows.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('');
    openSheet();
  });

  $('gen-back').addEventListener('click', hide);

  // ------------------------------------------------------------ drawing

  function beadsForIdle() {
    const u = USULS[gen.opts.usul];
    const n = u.seq.length;
    drum.setBeads([...u.seq].map((code, i) => ({ code, pos: i / n })));
    drum.progress = -1;
  }

  function status() {
    const o = gen.opts;
    let s = `${usulName(o.usul)} · ${SOURCE_NAME[o.source]} · ${ENERGY_NAME[o.energy]}`;
    if (gen.playing) {
      const n = gen.items.filter((it) => it.at <= gen.elapsed).length;
      s += ` · cycle ${n}`;
    } else s = `${s} · press play`;
    $('subtitle').textContent = s;
  }

  function resetStrip() {
    stripKey = '';
    $('gen-strip').innerHTML = '';
    $('gen-time').textContent = '0:00';
    updateSave();
  }

  function drawStrip(current) {
    const items = gen.items.filter((it) => it.at <= gen.elapsed + 0.05).slice(-28);
    const key = `${items.length}:${current ? current.k : -1}`;
    if (key === stripKey) return;
    stripKey = key;
    $('gen-strip').innerHTML = items.map((it) => {
      const h = Math.round(Math.max(0.18, Math.min(1, it.loud / 1.6)) * 100);
      const cls = [it === current ? 'now' : '', it.newJoin ? 'join' : ''].join(' ').trim();
      return `<i class="${cls}" style="height:${h}%"></i>`;
    }).join('');
  }

  let lastStatus = 0;
  function frame(now) {
    if (open && gen.playing) {
      const { strokes, item } = gen.poll();
      if (item && item.k !== shownItem) {
        shownItem = item.k;
        drum.setBeads(item.beads);
      }
      strokes.forEach((s) => drum.strike(s.code, s.b >= 0 ? s.b : undefined));
      if (item) drum.progress = Math.max(0, Math.min(1, (gen.elapsed - item.at) / item.dur));
      $('gen-time').textContent = fmt(gen.elapsed);
      drawStrip(item);
      if (now - lastStatus > 250) { lastStatus = now; status(); updateSave(); }
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  return { show, hide, get open() { return open; } };
}
