"""Add a song to the Doyra Studio library.

Analyses the song (tempo, beats, bar lines, grid, drum sections) with the
studio's own analysis code, builds the doira part in the to'y usul from real
recorded strokes, and writes:

  doyra-ai-site/studio/library/audio/<id>_original.<ext>   copy, for live usul switching   (not in git)
  doyra-ai-site/studio/library/audio/<id>_merged.m4a       song + doira                    (not in git)
  doyra-ai-site/studio/library/audio/<id>_doira.m4a        doira only, full quality        (not in git)
  doyra-ai-site/studio/library/doira/<id>_doira.m4a        doira only, small, for the public website
  doyra-ai-site/studio/library/<id>.json                   analysis + file list
  doyra-ai-site/studio/library/index.json                  the song list the studio shows

Song audio stays on this laptop (library/audio/ and songs/ are in .gitignore).
On the public website the library plays the doira on each song's analysed beat.

Usage:
  python tools/library/add_song.py --file "songs/Despacito.mp3" --title "Despacito" --artist "Luis Fonsi"
  python tools/library/add_song.py --folder songs/            # every mp3/m4a/wav/flac in the folder
  python tools/library/add_song.py --remove despacito

In --folder mode, name files "Artist - Title.mp3" to set artist and title.
Needs Node.js (the analysis is the same JavaScript the browser runs).
"""
from __future__ import annotations

import argparse
import json
import re
import shutil
import subprocess
import sys
import tempfile
import unicodedata
from pathlib import Path

import av
import numpy as np

REPO = Path(__file__).resolve().parents[2]
STUDIO = REPO / "doyra-ai-site" / "studio"
LIB = STUDIO / "library"
AUDIO = LIB / "audio"
PUBLIC = LIB / "doira"
BANK = STUDIO / "sounds" / "players" / "doniyor"
ANALYZE = REPO / "tools" / "library" / "analyze.mjs"

SR = 44100
ANALYSIS_SR = 22050
SONG_GAIN = 0.85          # same mix as the studio's "Song + doira"
PRE_ROLL = 0.002          # same attack alignment as the studio (audio.js)
AUDIO_EXT = {".mp3", ".m4a", ".aac", ".wav", ".flac", ".ogg"}


# ---------------------------------------------------------------- audio io

def decode(path: Path, sr: int, layout: str) -> np.ndarray:
    """Decode to float32, shape (channels, samples)."""
    with av.open(str(path)) as c:
        rs = av.AudioResampler(format="fltp", layout=layout, rate=sr)
        chunks = []
        for frame in c.decode(audio=0):
            for f in rs.resample(frame):
                chunks.append(f.to_ndarray())
        for f in rs.resample(None):
            chunks.append(f.to_ndarray())
    return np.concatenate(chunks, axis=1).astype(np.float32)


def encode_m4a(path: Path, x: np.ndarray, sr: int, bitrate: int) -> None:
    """x: (channels, samples) float32."""
    layout = "mono" if x.shape[0] == 1 else "stereo"
    with av.open(str(path), "w", format="mp4") as out:
        st = out.add_stream("aac", rate=sr)
        st.layout = layout
        st.bit_rate = bitrate
        step = sr  # one-second frames
        for i in range(0, x.shape[1], step):
            fr = av.AudioFrame.from_ndarray(np.ascontiguousarray(x[:, i:i + step]), format="fltp", layout=layout)
            fr.sample_rate = sr
            fr.pts = i
            for p in st.encode(fr):
                out.mux(p)
        for p in st.encode(None):
            out.mux(p)


# ---------------------------------------------------------------- strokes

def load_bank() -> dict[str, list[np.ndarray]]:
    """The studio's stroke takes, trimmed to start PRE_ROLL before the attack."""
    manifest = json.loads((BANK / "manifest.json").read_text(encoding="utf-8"))
    bank = {}
    for code, s in manifest["strokes"].items():
        takes = []
        for f in s["files"]:
            x = decode(BANK / f, SR, "mono")[0]
            attack = int(np.argmax(np.abs(x) >= 0.1 * np.max(np.abs(x))))
            takes.append(x[max(0, attack - int(PRE_ROLL * SR)):])
        bank[code] = takes
    return bank


def render_part(events: list[dict], n_samples: int, bank, seed: int) -> np.ndarray:
    """Place each stroke so its attack lands on its time (round-robin takes)."""
    rng = np.random.default_rng(seed)
    out = np.zeros(n_samples, dtype=np.float32)
    last: dict[str, int] = {}
    pre = int(PRE_ROLL * SR)
    for ev in events:
        takes = bank[ev["code"]]
        i = int(rng.integers(len(takes)))
        if len(takes) > 1 and i == last.get(ev["code"]):
            i = (i + 1) % len(takes)
        last[ev["code"]] = i
        x = takes[i] * ev["gain"]
        start = int(round(ev["time"] * SR)) - pre
        if start < 0:
            x, start = x[-start:], 0
        end = min(n_samples, start + len(x))
        out[start:end] += x[: end - start]
    return out


def fit_peak(x: np.ndarray, peak: float = 0.98) -> np.ndarray:
    m = float(np.max(np.abs(x))) if x.size else 0.0
    return x * (peak / m) if m > peak else x


# ---------------------------------------------------------------- library

def slug(text: str) -> str:
    t = unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode()
    t = re.sub(r"[^a-zA-Z0-9]+", "-", t).strip("-").lower()
    return t or "song"


def read_index() -> dict:
    p = LIB / "index.json"
    return json.loads(p.read_text(encoding="utf-8")) if p.exists() else {"songs": []}


def write_index(idx: dict) -> None:
    idx["songs"].sort(key=lambda s: s["title"].lower())
    (LIB / "index.json").write_text(json.dumps(idx, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def add_song(src: Path, title: str, artist: str, song_id: str | None = None) -> dict:
    song_id = song_id or slug(title)
    print(f"[{song_id}] {title}{' - ' + artist if artist else ''}")
    AUDIO.mkdir(parents=True, exist_ok=True)
    PUBLIC.mkdir(parents=True, exist_ok=True)

    with tempfile.TemporaryDirectory() as tmp:
        f32 = Path(tmp) / "song.f32"
        out = Path(tmp) / "analysis.json"
        decode(src, ANALYSIS_SR, "mono")[0].astype("<f4").tofile(f32)
        print("  analysing...")
        subprocess.run(["node", str(ANALYZE), str(f32), str(out)], check=True,
                       stderr=subprocess.DEVNULL if "--verbose" not in sys.argv else None)
        result = json.loads(out.read_text(encoding="utf-8"))
    an, parts = result["analysis"], result["parts"]
    print(f"  {an['bpm']:.1f} BPM, {len(an['beats'])} beats, first bar line at {an['beats'][an['downbeat']]:.2f} s")

    print("  rendering the doira (to'y)...")
    song = decode(src, SR, "stereo")
    bank = load_bank()
    doira = render_part(parts["toy"], song.shape[1], bank, seed=sum(map(ord, song_id)))

    original = AUDIO / f"{song_id}_original{src.suffix.lower()}"
    if src.resolve() != original.resolve():
        shutil.copy2(src, original)
    encode_m4a(AUDIO / f"{song_id}_merged.m4a", fit_peak(SONG_GAIN * song + doira[None, :]), SR, 192_000)
    encode_m4a(AUDIO / f"{song_id}_doira.m4a", fit_peak(doira[None, :]), SR, 128_000)
    encode_m4a(PUBLIC / f"{song_id}_doira.m4a", fit_peak(doira[None, :]), SR, 64_000)

    entry = {
        "id": song_id,
        "title": title,
        "artist": artist,
        "duration": an["duration"],
        "bpm": an["bpm"],
        "source": src.name,
        "files": {
            "original": f"audio/{original.name}",
            "merged": f"audio/{song_id}_merged.m4a",
            "doira": f"audio/{song_id}_doira.m4a",
            "doiraPublic": f"doira/{song_id}_doira.m4a",
        },
        "parts": {"toy": "rendered in merged / doira files"},
    }
    (LIB / f"{song_id}.json").write_text(json.dumps({**entry, "analysis": an}, ensure_ascii=False), encoding="utf-8")
    idx = read_index()
    idx["songs"] = [s for s in idx["songs"] if s["id"] != song_id] + [
        {k: entry[k] for k in ("id", "title", "artist", "duration", "bpm", "source")}]
    write_index(idx)
    size = (PUBLIC / f"{song_id}_doira.m4a").stat().st_size / 1e6
    print(f"  done: library/{song_id}.json, audio/ renders, public doira render {size:.1f} MB")
    return entry


def remove_song(song_id: str) -> None:
    for p in [LIB / f"{song_id}.json", PUBLIC / f"{song_id}_doira.m4a", *AUDIO.glob(f"{song_id}_*")]:
        if p.exists():
            p.unlink()
    idx = read_index()
    idx["songs"] = [s for s in idx["songs"] if s["id"] != song_id]
    write_index(idx)
    print(f"removed {song_id}")


def title_artist_from_name(path: Path) -> tuple[str, str]:
    stem = re.sub(r"\s+", " ", path.stem).strip()
    if " - " in stem:
        artist, title = stem.split(" - ", 1)
        return title.strip(), artist.strip()
    return stem, ""


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    g = ap.add_mutually_exclusive_group(required=True)
    g.add_argument("--file", type=Path, help="one song file")
    g.add_argument("--folder", type=Path, help="add every audio file in this folder")
    g.add_argument("--remove", metavar="ID", help="remove a song from the library")
    ap.add_argument("--title")
    ap.add_argument("--artist", default="")
    ap.add_argument("--id", help="library id (default: from the title)")
    ap.add_argument("--force", action="store_true", help="--folder: redo songs already in the library")
    ap.add_argument("--verbose", action="store_true")
    a = ap.parse_args()

    if shutil.which("node") is None:
        raise SystemExit("Node.js is needed (the analysis is the studio's own JavaScript). Install it from nodejs.org.")
    if a.remove:
        remove_song(a.remove)
    elif a.file:
        if not a.file.exists():
            raise SystemExit(f"No such file: {a.file}")
        title, artist = (a.title, a.artist) if a.title else title_artist_from_name(a.file)
        add_song(a.file, title, artist, a.id)
    else:
        files = sorted(p for p in a.folder.iterdir() if p.suffix.lower() in AUDIO_EXT)
        if not files:
            raise SystemExit(f"No audio files in {a.folder}")
        songs = read_index()["songs"]
        have_ids = {s["id"] for s in songs}
        have_src = {s.get("source") for s in songs}
        failed = []
        for p in files:
            title, artist = title_artist_from_name(p)
            if (p.name in have_src or slug(title) in have_ids) and not a.force:
                print(f"{p.name}: already in the library, skipping (use --force to redo)")
                continue
            try:
                add_song(p, title, artist)
            except Exception as e:  # keep going with the rest of the folder
                print(f"  FAILED: {e}")
                failed.append(p.name)
        if failed:
            print(f"\n{len(failed)} failed: {', '.join(failed)}")


if __name__ == "__main__":
    main()
