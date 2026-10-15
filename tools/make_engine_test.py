"""Audio for testing the studio's song analysis (tools/check_engine.mjs).

synth: a synthetic pop/house/reggaeton track at a known tempo, with an answer
       key (beat times, first downbeat) written next to it.
decode: any song decoded to the analysis format (mono float32, 22050 Hz).

Output is raw little-endian float32 (.f32), which Node can read without codecs.

Usage:
    python tools/make_engine_test.py synth --bpm 96 --style pop --out test.f32
    python tools/make_engine_test.py synth --bpm 124 --style house --out beat.wav   # playable file
    python tools/make_engine_test.py decode --file song.mp3 --out song.f32
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np

SR = 22050


def kick(sr):
    t = np.arange(int(0.25 * sr)) / sr
    f = 50 + 90 * np.exp(-t * 30)
    return np.sin(2 * np.pi * np.cumsum(f) / sr) * np.exp(-t * 14)


def snare(sr, rng):
    t = np.arange(int(0.18 * sr)) / sr
    noise = rng.standard_normal(t.size) * np.exp(-t * 22)
    tone = np.sin(2 * np.pi * 190 * t) * np.exp(-t * 30)
    return 0.5 * noise + 0.5 * tone


def hat(sr, rng):
    t = np.arange(int(0.05 * sr)) / sr
    n = rng.standard_normal(t.size)
    n = np.diff(n, prepend=0)  # crude high-pass
    return 0.25 * n * np.exp(-t * 90)


PATTERNS = {  # 16 steps per bar: kick, snare, hat
    "pop":       ("x.......x.......", "....x.......x...", "x.x.x.x.x.x.x.x."),
    "house":     ("x...x...x...x...", "....x.......x...", "..x...x...x...x."),
    "reggaeton": ("x...x...x...x...", "...x..x....x..x.", "x.x.x.x.x.x.x.x."),
}


def synth(bpm: float, style: str, bars: int, seed: int, intro_bars: int):
    rng = np.random.default_rng(seed)
    beat = 60 / bpm
    step = beat / 4
    start = 0.5 + intro_bars * 4 * beat  # drums start after a pad-only intro
    total = start + bars * 4 * beat + 1.0
    y = np.zeros(int(total * SR) + SR)
    k, s, h = kick(SR), snare(SR, rng), hat(SR, rng)
    pk, ps, ph = PATTERNS[style]
    onsets = {"kick": [], "snare": [], "hat": []}

    def add(sig, t, gain):
        i = int(round(t * SR))
        y[i:i + sig.size] += gain * sig

    for bar in range(bars):
        for st in range(16):
            t = start + bar * 4 * beat + st * step
            if pk[st] == "x": add(k, t, 0.9); onsets["kick"].append(t)
            if ps[st] == "x": add(s, t, 0.6); onsets["snare"].append(t)
            if ph[st] == "x": add(h, t, 0.5); onsets["hat"].append(t)
    # a chord pad that changes on every bar line (helps downbeat detection), intro included
    chords = [(57, 60, 64), (53, 57, 60), (48, 52, 55), (55, 59, 62)]
    t0 = 0.5
    for bar in range(intro_bars + bars):
        a, b = int((t0 + bar * 4 * beat) * SR), int((t0 + (bar + 1) * 4 * beat) * SR)
        tt = np.arange(b - a) / SR
        env = np.minimum(1, tt * 40) * np.exp(-tt * 0.6)
        for m in chords[bar % 4]:
            y[a:b] += 0.05 * np.sin(2 * np.pi * 440 * 2 ** ((m - 69) / 12) * tt) * env
    y /= np.max(np.abs(y)) * 1.1
    n_beats = int(round((total - 1.0 - t0) / beat))
    beats = [t0 + i * beat for i in range(n_beats)]
    key = {"bpm": bpm, "style": style, "beats": beats, "downbeat_time": t0,
           "drums_start": start, "onsets": onsets}
    return y.astype("<f4"), key


def decode(path: Path) -> np.ndarray:
    import av
    with av.open(str(path)) as c:
        rs = av.AudioResampler(format="flt", layout="mono", rate=SR)
        chunks = []
        for frame in c.decode(audio=0):
            for f in rs.resample(frame):
                chunks.append(f.to_ndarray().reshape(-1))
        for f in rs.resample(None):
            chunks.append(f.to_ndarray().reshape(-1))
    return np.concatenate(chunks).astype("<f4")


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    s = sub.add_parser("synth")
    s.add_argument("--bpm", type=float, default=100)
    s.add_argument("--style", choices=sorted(PATTERNS), default="pop")
    s.add_argument("--bars", type=int, default=32)
    s.add_argument("--intro-bars", type=int, default=2)
    s.add_argument("--seed", type=int, default=1)
    s.add_argument("--out", type=Path, required=True)
    d = sub.add_parser("decode")
    d.add_argument("--file", type=Path, required=True)
    d.add_argument("--out", type=Path, required=True)
    a = ap.parse_args()
    if a.cmd == "synth":
        y, key = synth(a.bpm, a.style, a.bars, a.seed, a.intro_bars)
        if a.out.suffix.lower() == ".wav":
            import wave
            with wave.open(str(a.out), "wb") as w:
                w.setnchannels(1); w.setsampwidth(2); w.setframerate(SR)
                w.writeframes((np.clip(y, -1, 1) * 32767).astype("<i2").tobytes())
        else:
            y.tofile(a.out)
        a.out.with_suffix(".json").write_text(json.dumps(key), encoding="utf-8")
        print(f"{a.out}: {len(y) / SR:.1f} s, {a.bpm} BPM {a.style}, answer key -> {a.out.with_suffix('.json').name}")
    else:
        y = decode(a.file)
        y.tofile(a.out)
        print(f"{a.out}: {len(y) / SR:.1f} s")


if __name__ == "__main__":
    main()
