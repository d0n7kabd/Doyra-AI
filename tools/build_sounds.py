"""Build the studio's stroke bank from the recorded clips.

Reads data/metadata.csv, picks a few takes of each of the 9 strokes, trims
them, and writes small AAC .m4a files plus a manifest.json into
doyra-ai-site/studio/sounds/players/<player>/.

Every sound the studio plays is one of these real recorded strokes.
The studio aligns each take to its attack when it loads, so the encoder's
start padding does not shift the timing.

Usage:
    python tools/build_sounds.py                       # Doniyor's strokes from data/
    python tools/build_sounds.py --takes 8
    python tools/build_sounds.py --data path/to/data --player name --label "Full Name"
"""
from __future__ import annotations

import argparse
import csv
import json
import wave
from pathlib import Path

import av
import numpy as np

REPO_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_DATA = REPO_ROOT / "data"
BANKS_DIR = REPO_ROOT / "doyra-ai-site" / "studio" / "sounds" / "players"

# Stroke codes used everywhere in the studio: (note, hand) -> code.
CODES = {
    ("bum", "main"): "B",
    ("bum", "secondary"): "b",
    ("bak", "main"): "T",
    ("bak", "secondary"): "t",
    ("kichik_bak", "main"): "K",
    ("kichik_bak", "secondary"): "k",
    ("kichik_bum", "main"): "M",
    ("kichik_bum", "secondary"): "m",
    ("noxun", "secondary"): "n",
}
CLIP_SECONDS = 0.7
FADE_SECONDS = 0.15


def read_wav(path: Path) -> tuple[np.ndarray, int]:
    with wave.open(str(path)) as w:
        sr, n, ch, width = w.getframerate(), w.getnframes(), w.getnchannels(), w.getsampwidth()
        raw = w.readframes(n)
    if width != 2:
        raise ValueError(f"{path}: expected 16-bit PCM")
    x = np.frombuffer(raw, dtype="<i2").astype(np.float32) / 32768.0
    if ch > 1:
        x = x.reshape(-1, ch).mean(axis=1)
    return x, sr


def write_m4a(path: Path, x: np.ndarray, sr: int) -> None:
    with av.open(str(path), "w", format="mp4") as out:
        stream = out.add_stream("aac", rate=sr)
        stream.layout = "mono"
        stream.bit_rate = 96_000
        frame = av.AudioFrame.from_ndarray(x.reshape(1, -1).astype(np.float32), format="fltp", layout="mono")
        frame.sample_rate = sr
        for packet in stream.encode(frame):
            out.mux(packet)
        for packet in stream.encode(None):
            out.mux(packet)


def pick_takes(rows: list[dict], k: int) -> list[dict]:
    """Takes nearest the median peak level, so round-robin variation stays natural."""
    peaks = np.array([float(r["peak_amplitude"]) for r in rows])
    order = np.argsort(np.abs(peaks - np.median(peaks)))
    return [rows[i] for i in sorted(order[:k])]


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--data", type=Path, default=DEFAULT_DATA, help="folder with metadata.csv and clips/")
    ap.add_argument("--player", default="doniyor", help="bank folder name")
    ap.add_argument("--label", default="Doniyor Abdusalimov", help="the player's name, shown in the studio")
    ap.add_argument("--takes", type=int, default=6, help="takes per stroke")
    args = ap.parse_args()

    with open(args.data / "metadata.csv", newline="", encoding="utf-8") as f:
        rows = list(csv.DictReader(f))
    by_code: dict[str, list[dict]] = {}
    for r in rows:
        code = CODES.get((r["note"], r["hand_role"]))
        if code:
            by_code.setdefault(code, []).append(r)
    missing = sorted(set(CODES.values()) - set(by_code))
    if missing:
        raise SystemExit(f"No clips for strokes: {missing}")

    out_dir = BANKS_DIR / args.player
    out_dir.mkdir(parents=True, exist_ok=True)
    for old in out_dir.glob("*.m4a"):
        old.unlink()

    manifest = {"player": args.player, "label": args.label, "strokes": {}}
    total = 0
    for (note, hand), code in CODES.items():
        files = []
        for i, r in enumerate(pick_takes(by_code[code], args.takes), start=1):
            x, sr = read_wav(args.data / r["clip_path"])
            x = x[: int(CLIP_SECONDS * sr)].copy()
            fade = int(FADE_SECONDS * sr)
            x[-fade:] *= np.linspace(1.0, 0.0, fade, dtype=np.float32)
            name = f"{note}_{hand}_{i}.m4a"  # full names: Windows file names ignore case (B vs b)
            write_m4a(out_dir / name, x, sr)
            files.append(name)
            total += (out_dir / name).stat().st_size
        manifest["strokes"][code] = {"note": note, "hand": hand, "files": files}

    (out_dir / "manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    print(f"Wrote {sum(len(s['files']) for s in manifest['strokes'].values())} takes "
          f"({total / 1024:.0f} KB) to {out_dir.relative_to(REPO_ROOT)}")


if __name__ == "__main__":
    main()
