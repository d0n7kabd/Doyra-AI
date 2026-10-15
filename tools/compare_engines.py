"""Browser arranger vs. the laptop pipeline (Demucs exact drums), song by song.

For each file: runs the laptop pipeline with Demucs (whole song, or 4 bars per
drum section with --excerpt), then tools/check_arranger.mjs, which reports
tempo, style, sections, the transcribed patterns from the full mix (browser)
and from the drum stem (Demucs), how many drum hits they share, and - for a
test beat with an answer key next to it (same name, .json) - how many of the
real hits the transcription matched.

Usage:
    python tools/compare_engines.py "songs/Test beat - House 124.wav" songs/other.mp3
    python tools/compare_engines.py --excerpt songs/long-song.mp3
"""
from __future__ import annotations

import argparse
import json
import subprocess
import sys
import tempfile
import time
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO / "tools" / "library"))

import pipeline  # noqa: E402
from add_song import decode, SR  # noqa: E402


def main() -> None:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("files", nargs="+", type=Path)
    ap.add_argument("--excerpt", action="store_true", help="Demucs on 4 bars per drum section (as add_song.py does)")
    a = ap.parse_args()
    if not pipeline.demucs_available():
        raise SystemExit("Demucs is not installed (pip install demucs)")
    for f in a.files:
        print(f"\n=== {f.name}")
        with tempfile.TemporaryDirectory() as tmp:
            mix = Path(tmp) / "mix.f32"
            decode(f, pipeline.ANALYSIS_SR, "mono")[0].astype("<f4").tofile(mix)
            an = pipeline.analyse(f)["analysis"]
            t = time.time()
            bands = pipeline.exact_drums(decode(f, SR, "stereo"), SR, an, excerpt=a.excerpt)
            secs = time.time() - t
            bpath = Path(tmp) / "drums16.json"
            bpath.write_text(json.dumps(bands))
            covered = sum(z - g for g, z in bands.get("covered", [[0, len(an["grid16"])]])) / 16
            print(f"Demucs: {secs:.0f} s for {an['duration']:.0f} s of song ({'excerpts, ' + f'{covered:.0f} bars' if a.excerpt else 'whole song'})")
            cmd = ["node", str(REPO / "tools" / "check_arranger.mjs"), str(mix), "--drums16", str(bpath)]
            key = f.with_suffix(".json")
            if key.exists():
                cmd += ["--key", str(key)]
            out = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8").stdout
            print(out.rstrip())


if __name__ == "__main__":
    main()
