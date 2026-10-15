// Audio context, file decoding, and the bank of real recorded strokes.
import { ANALYSIS_SR } from './analysis.js';

let ctx = null;
export function audioContext() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    ctx = new AC({ latencyHint: 'interactive' });
  }
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

export function decode(arrayBuffer) {
  const c = audioContext();
  return new Promise((res, rej) => c.decodeAudioData(arrayBuffer, res, rej));
}

// Mono, 22050 Hz copy for analysis (the browser does the resampling).
export async function toAnalysisPCM(buffer) {
  const len = Math.ceil(buffer.duration * ANALYSIS_SR);
  const off = new OfflineAudioContext(1, len, ANALYSIS_SR);
  const src = off.createBufferSource();
  src.buffer = buffer;
  src.connect(off.destination);
  src.start();
  const rendered = await off.startRendering();
  return rendered.getChannelData(0);
}

// Analysis runs in a worker so the page never freezes.
export function analyze(pcm) {
  return new Promise((res, rej) => {
    const w = new Worker(new URL('./analysis-worker.js', import.meta.url), { type: 'module' });
    w.onmessage = (e) => { w.terminate(); e.data.error ? rej(new Error(e.data.error)) : res(e.data.result); };
    w.onerror = (e) => { w.terminate(); rej(e); };
    w.postMessage({ pcm }, [pcm.buffer]);
  });
}

// The stroke bank: several takes of each of the 9 strokes from one player.
// Each take is aligned to its attack on load, so a stroke scheduled at time t
// is heard at t, whatever silence or codec padding the file starts with.
const PRE_ROLL = 0.002; // keep 2 ms before the attack so it isn't clipped

export class StrokeBank {
  static async load(baseUrl) {
    const c = audioContext();
    const manifest = await (await fetch(new URL('manifest.json', baseUrl))).json();
    const bank = new StrokeBank(manifest);
    await Promise.all(Object.entries(manifest.strokes).map(async ([code, s]) => {
      bank.takes[code] = await Promise.all(s.files.map(async (f) => {
        const buf = await decode(await (await fetch(new URL(f, baseUrl))).arrayBuffer());
        return { buf, offset: Math.max(0, attackTime(buf) - PRE_ROLL) };
      }));
    }));
    bank.ctx = c;
    return bank;
  }

  constructor(manifest) {
    this.manifest = manifest;
    this.label = manifest.label;
    this.takes = {};
    this.last = {};
  }

  // Play stroke `code` so its attack lands exactly at context time `when`.
  play(code, when, { gain = 1, destination } = {}) {
    const takes = this.takes[code];
    if (!takes || !takes.length) return;
    let i = Math.floor(Math.random() * takes.length);
    if (takes.length > 1 && i === this.last[code]) i = (i + 1) % takes.length; // no machine-gun repeats
    this.last[code] = i;
    const { buf, offset } = takes[i];
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const g = this.ctx.createGain();
    g.gain.value = gain;
    src.connect(g).connect(destination || this.ctx.destination);
    const start = when - PRE_ROLL;
    const now = this.ctx.currentTime;
    if (start >= now) src.start(start, offset);
    else src.start(now, offset + (now - start)); // late: skip ahead, stay on the grid
  }
}

// First sample louder than 10 % of the peak.
function attackTime(buf) {
  const x = buf.getChannelData(0);
  let peak = 0;
  for (let i = 0; i < x.length; i++) peak = Math.max(peak, Math.abs(x[i]));
  const thr = 0.1 * peak;
  for (let i = 0; i < x.length; i++) if (Math.abs(x[i]) >= thr) return i / buf.sampleRate;
  return 0;
}
