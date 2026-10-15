"""Mean stroke gap of each usul recording, normal and slow tempo.

Uses the same onset detector and decoder as scripts/analyze_phaseB_phrases.py.
The studio's timing feel runs from the normal tempo (full measured feel) to the
slow tempo (reduced feel); this script measures where "slow" is.

Gaps longer than 2.5x the median gap are pauses between phrases and are left out.

Usage:
    python tools/measure_usul_tempo.py "path/to/folder with Usul_*_normal.m4a and Usul_*_slow.m4a"
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

import numpy as np

REPO_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO_ROOT / "scripts"))
sys.path.insert(0, str(REPO_ROOT / "src"))
from analyze_phaseB_phrases import detect_onsets, load_m4a_mono  # noqa: E402


def mean_gap(path: Path) -> tuple[float, int]:
    sig, sr = load_m4a_mono(path)
    on = np.array(detect_onsets(sig, sr)) / sr
    g = np.diff(on)
    g = g[g < 2.5 * np.median(g)]
    return float(np.mean(g)), len(on)


def main() -> None:
    folder = Path(sys.argv[1]) if len(sys.argv) > 1 else REPO_ROOT / "data" / "usul_audio"
    rows = []
    for p in sorted(folder.glob("Usul_*_*.m4a")):
        m = re.match(r"Usul_(\d)_(normal|slow)", p.stem)
        if not m:
            continue
        gap, n = mean_gap(p)
        rows.append((int(m.group(1)), m.group(2), p.name, gap, n))
        print(f"{p.name:28s} {n:4d} strokes  mean gap {gap * 1000:6.1f} ms")
    print()
    for u in sorted({r[0] for r in rows}):
        for tempo in ("normal", "slow"):
            g = [r[3] for r in rows if r[0] == u and r[1] == tempo]
            if g:
                print(f"Usul {u} {tempo:6s}: {np.mean(g) * 1000:6.1f} ms (from {len(g)} recording{'s' if len(g) > 1 else ''})")


if __name__ == "__main__":
    main()
