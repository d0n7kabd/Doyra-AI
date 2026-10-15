// Plays a song and schedules doira strokes against it, sample-accurately.
//
// Song time t (seconds into the song) maps to audio-context time
// startCtx + (t - startSong). Strokes are scheduled ~200 ms ahead with
// AudioBufferSourceNode.start(when), so timing never depends on the main
// thread. The pattern is a function asked for the strokes in a song-time
// window, so it can change live (usul, feel) without restarting; a change is
// heard within the lookahead (200 ms).
import { audioContext } from './audio.js';

const LOOKAHEAD = 0.2;  // seconds scheduled in advance
const TICK = 25;        // ms between scheduler runs

export class Transport {
  constructor({ bank, pattern = () => [] }) {
    this.ctx = audioContext();
    this.bank = bank;
    this.pattern = pattern;
    this.master = this.ctx.createGain();
    this.master.connect(this.ctx.destination);
    this.songGain = this.ctx.createGain();
    this.doiraGain = this.ctx.createGain();
    this.songGain.connect(this.master);
    this.doiraGain.connect(this.master);
    this.song = null;
    this.playing = false;
    this.pos = 0;            // song position while paused
    this.visual = [];        // scheduled strokes waiting to be shown
    this.listeners = new Set();
  }

  setSong(buffer) { this.stop(); this.song = buffer; this.pos = 0; }
  setPattern(fn) { this.pattern = fn; }
  setMix({ song, doira }) {
    const t = this.ctx.currentTime;
    if (song !== undefined) this.songGain.gain.setTargetAtTime(song, t, 0.03);
    if (doira !== undefined) this.doiraGain.gain.setTargetAtTime(doira, t, 0.03);
  }
  onStroke(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }

  get duration() { return this.song ? this.song.duration : 0; }
  get position() {
    return this.playing ? this.startSong + (this.ctx.currentTime - this.startCtx) : this.pos;
  }
  toCtx(t) { return this.startCtx + (t - this.startSong); }

  play(from = this.pos) {
    if (this.playing) this.stop(true);
    this.startCtx = this.ctx.currentTime + 0.06;
    this.startSong = from;
    this.scheduledTo = from;
    if (this.song) {
      this.src = this.ctx.createBufferSource();
      this.src.buffer = this.song;
      this.src.connect(this.songGain);
      this.src.start(this.startCtx, from);
      this.src.onended = () => { if (this.playing && this.position >= this.duration - 0.05) this.stop(); };
    }
    this.playing = true;
    this.timer = setInterval(() => this.schedule(), TICK);
    this.schedule();
  }

  stop(keepPos = false) {
    if (!this.playing) return;
    this.pos = keepPos ? this.position : Math.min(this.position, this.duration);
    this.playing = false;
    clearInterval(this.timer);
    if (this.src) { this.src.onended = null; try { this.src.stop(); } catch (e) { /* already stopped */ } this.src = null; }
    this.visual.length = 0;
  }

  seek(t) {
    const was = this.playing;
    this.stop();
    this.pos = Math.max(0, Math.min(t, this.duration));
    if (was) this.play(this.pos);
  }

  schedule() {
    if (!this.playing) return;
    const until = this.position + LOOKAHEAD;
    if (until <= this.scheduledTo) return;
    const from = this.scheduledTo;
    for (const ev of this.pattern(from, until)) {
      if (ev.time < from || ev.time >= until) continue;
      this.bank.play(ev.code, this.toCtx(ev.time), { gain: ev.gain ?? 1, destination: this.doiraGain });
      this.visual.push(ev);
    }
    this.scheduledTo = until;
  }

  // Call once per animation frame: tells listeners about strokes being heard now.
  tick() {
    if (!this.playing) return;
    const now = this.position;
    while (this.visual.length && this.visual[0].time <= now) {
      const ev = this.visual.shift();
      this.listeners.forEach((fn) => fn(ev));
    }
  }
}
