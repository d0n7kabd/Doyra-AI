"""Mean stroke gap of each usul recording, normal and slow tempo.

The studio's timing feel runs from the normal tempo (full measured feel) to
the slow tempo (reduced feel); this script measures where "slow" is. The slow
gaps in doyra-ai-site/studio/js/usuls.js (slow.gap) come from here.

Onsets: librosa onset detection (delta 0.07, wait 3 frames of 256 samples).
The older detector in scripts/analyze_phaseB_phrases.py misses soft kichik
baks (to'y normal came out at 340 ms against the paper's 236 ms). With these
settings the normal recordings reproduce the paper's mean gaps:
to'y 229 / 236 ms, Usul 4 337 / 334 ms, Usul 5 196 / 195 ms.
Usul 6 does not reproduce (137 / 192 ms), so its slow value is not used.

Gaps longer than 2.5x the median gap are pauses between phrases and are left out.

Usage:
    python tools/measure_usul_tempo.py "path/to/folder with Usul_*_normal.m4a and Usul_*_slow.m4a"
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

import librosa
import numpy as np

REPO_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO_ROOT / "scripts"))
sys.path.insert(0, str(REPO_ROOT / "src"))
from analyze_phaseB_phrases import load_m4a_mono  # noqa: E402

PAPER_NORMAL_MS = {2: 236, 4: 334, 5: 195, 6: 192}


def mean_gap(path: Path) -> tuple[float, int]:
    y, sr = load_m4a_mono(path)
    env = librosa.onset.onset_strength(y=y.astype(np.float32), sr=sr, hop_length=256)
    on = librosa.onset.onset_detect(onset_envelope=env, sr=sr, hop_length=256, units="time", delta=0.07, wait=3)
    g = np.diff(on)
    g = g[g < 2.5 * np.median(g)]
    return float(np.mean(g)), len(on)


def main() -> None:
    folder = Path(sys.argv[1]) if len(sys.argv) > 1 else REPO_ROOT / "data" / "usul_audio"
    for u in range(1, 7):
        for tempo in ("normal", "slow"):
            p = folder / f"Usul_{u}_{tempo}.m4a"
            if not p.exists():
                continue
            gap, n = mean_gap(p)
            paper = f"  (paper: {PAPER_NORMAL_MS[u]} ms)" if tempo == "normal" and u in PAPER_NORMAL_MS else ""
            print(f"Usul {u} {tempo:6s}: {n:3d} strokes, mean gap {gap * 1000:6.1f} ms{paper}")


if __name__ == "__main__":
    main()
