"""The song pipeline, shared by add_song.py and the laptop server (tools/server).

  analyse   the studio's own analysis (JavaScript, via Node): tempo, beats,
            bar lines, 16th grid, drum bands, chords, loudness, style
  drums     Demucs drum stem -> kick / snare / hi-hat on the song's grid
            ("exact drums"; optional, needs `pip install demucs`)
  arrange   the studio's arranger (JavaScript, via Node): the doira strokes
  seed      FNV-1a of the file's bytes, the same number the browser computes,
            so a file is arranged the same way everywhere
"""
from __future__ import annotations

import json
import subprocess
import tempfile
import time
from pathlib import Path
from typing import Callable

import numpy as np

HERE = Path(__file__).resolve().parent
ANALYSIS_SR = 22050


def node(script: str, *args: str) -> None:
    subprocess.run(["node", str(HERE / script), *args], check=True, stderr=subprocess.DEVNULL)


def bytes_seed(data: bytes) -> int:
    """Same as bytesSeed() in studio/js/engine/arranger.js."""
    h = 0x811C9DC5
    step = max(1, len(data) // 200000)
    for i in range(0, len(data), step):
        h ^= data[i]
        h = (h * 0x01000193) & 0xFFFFFFFF
    return h


def analyse(src: Path) -> dict:
    from add_song import decode  # decoding with damaged-packet handling
    with tempfile.TemporaryDirectory() as tmp:
        f32, out = Path(tmp) / "song.f32", Path(tmp) / "analysis.json"
        decode(src, ANALYSIS_SR, "mono")[0].astype("<f4").tofile(f32)
        node("analyze.mjs", str(f32), str(out))
        return json.loads(out.read_text(encoding="utf-8"))


def exact_drums(song_stereo: np.ndarray, sr: int, analysis: dict, excerpt: bool = True) -> dict:
    """Demucs drum stem, measured as kick / snare / hi-hat on the song's grid.

    excerpt=True separates only 4 bars of each section with drums (plus a bar of
    context either side): the transcription needs no more, and Demucs is slow on
    a CPU. excerpt=False separates the whole song.
    """
    import librosa
    from drums import drum_stem
    grid16 = analysis["grid16"]
    if excerpt:
        with tempfile.TemporaryDirectory() as tmp:
            inp, out = Path(tmp) / "an.json", Path(tmp) / "sec.json"
            inp.write_text(json.dumps(analysis), encoding="utf-8")
            node("sections.mjs", str(inp), str(out))
            sec = json.loads(out.read_text(encoding="utf-8"))
        bars = sec["bars"]
        cores = []
        for s in sec["sections"]:
            if s["level"] in ("silent", "none"):
                continue
            n = s["to"] - s["from"]
            first = s["from"] + max(0, (n - 4) // 2)
            cores.append((first, min(s["to"], first + 4)))
    else:
        cores = None

    n_grid = len(grid16)
    bands = {k: [0.0] * n_grid for k in ("low", "mid", "high")}
    covered = []
    ranges = [(0, None)] if cores is None else cores
    for core in ranges:
        if cores is None:
            t0, t1, g_from, g_to = 0.0, song_stereo.shape[1] / sr, 0, n_grid
        else:
            b0, b1 = core
            ctx0, ctx1 = max(0, b0 - 1), min(len(bars) - 1, b1)  # a bar of context either side
            t0, t1 = bars[ctx0]["start"], bars[ctx1]["end"]
            g_from, g_to = bars[b0]["g"], bars[b1 - 1]["g"] + 16
        piece = song_stereo[:, int(t0 * sr): int(t1 * sr)]
        stem = librosa.resample(drum_stem(piece, sr), orig_sr=sr, target_sr=ANALYSIS_SR)
        with tempfile.TemporaryDirectory() as tmp:
            f32, grid, out = Path(tmp) / "stem.f32", Path(tmp) / "grid.json", Path(tmp) / "bands.json"
            stem.astype("<f4").tofile(f32)
            grid.write_text(json.dumps([t - t0 for t in grid16[g_from:g_to]]))
            node("drum_bands.mjs", str(f32), str(grid), str(out))
            got = json.loads(out.read_text(encoding="utf-8"))
        for k in bands:
            bands[k][g_from:g_to] = got[k]
        covered.append([g_from, g_to])
    if cores is not None:
        bands["covered"] = covered
    return bands


def arrangement(song: dict) -> dict:
    """{analysis, drums16?, seed, style?} -> {drums, toy, groove?} stroke lists."""
    with tempfile.TemporaryDirectory() as tmp:
        inp, out = Path(tmp) / "song.json", Path(tmp) / "parts.json"
        inp.write_text(json.dumps({k: song.get(k) for k in ("analysis", "drums16", "seed", "style")}), encoding="utf-8")
        node("arrange.mjs", str(inp), str(out))
        return json.loads(out.read_text(encoding="utf-8"))


def demucs_available() -> bool:
    from drums import available
    return available()


def process(src: Path, use_demucs: bool = True, progress: Callable[[str, dict], None] | None = None,
            full_demucs: bool = False) -> dict:
    """Everything the studio needs to arrange a song. progress(stage, partial_result)."""
    from add_song import decode, SR
    say = progress or (lambda stage, partial: None)
    timings = {}
    t = time.time()
    say("analysing", {})
    result = analyse(src)
    song = {
        "analysis": result["analysis"],
        "style": result.get("style"),
        "seed": bytes_seed(src.read_bytes()),
        "drums16": None,
        "engine": "full",
    }
    timings["analysis"] = round(time.time() - t, 1)
    say("analysed", song)
    if use_demucs and demucs_available():
        t = time.time()
        say("separating drums", song)
        stereo = decode(src, SR, "stereo")
        song["drums16"] = exact_drums(stereo, SR, song["analysis"], excerpt=not full_demucs)
        timings["demucs"] = round(time.time() - t, 1)
    song["timings"] = timings
    song["demucs"] = song["drums16"] is not None
    return song
