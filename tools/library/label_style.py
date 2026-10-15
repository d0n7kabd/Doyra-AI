"""Label library songs with a style, so style detection learns from them.

Each label stores the song's drum onset profile (made by add_song.py) as an
example in doyra-ai-site/studio/data/styles.json. Detection is nearest
neighbour, so every labelled song makes it better at songs like it.

Usage:
  python tools/library/label_style.py --list
  python tools/library/label_style.py --id gasolina --style reggaeton
  python tools/library/label_style.py --new-style uzbek-pop --name "Uzbek pop" --describe "..."
  python tools/library/label_style.py --id some-song --style uzbek-pop
  python tools/library/label_style.py --unlabel gasolina

See how detection does on the library: node tools/library/style_report.mjs
A new style needs a doira groove in doyra-ai-site/studio/js/grooves.js for
"Auto" to play it; until then Auto plays to'y for that style.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
LIB = REPO / "doyra-ai-site" / "studio" / "library"
STYLES = REPO / "doyra-ai-site" / "studio" / "data" / "styles.json"


def load() -> dict:
    return json.loads(STYLES.read_text(encoding="utf-8"))


def save(d: dict) -> None:
    STYLES.write_text(json.dumps(d, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")


def main() -> None:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--list", action="store_true")
    ap.add_argument("--id", help="library song id")
    ap.add_argument("--style", help="style id, e.g. reggaeton")
    ap.add_argument("--unlabel", metavar="ID")
    ap.add_argument("--new-style", metavar="STYLE_ID")
    ap.add_argument("--name", help="display name for --new-style")
    ap.add_argument("--describe", default="", help="one line for --new-style")
    a = ap.parse_args()
    d = load()

    if a.new_style:
        if not a.name:
            raise SystemExit("--new-style needs --name")
        d["styles"][a.new_style] = {"name": a.name, "describe": a.describe}
        save(d)
        print(f"added style {a.new_style} ({a.name})")
    elif a.unlabel:
        before = len(d["examples"])
        d["examples"] = [e for e in d["examples"] if e["id"] != a.unlabel]
        save(d)
        print(f"removed {before - len(d['examples'])} example(s) for {a.unlabel}")
    elif a.id:
        if a.style not in d["styles"]:
            raise SystemExit(f"Unknown style {a.style!r}. Known: {', '.join(d['styles'])}. Add one with --new-style.")
        song = json.loads((LIB / f"{a.id}.json").read_text(encoding="utf-8"))
        prof = song["analysis"].get("style")
        if not prof or not prof.get("bars"):
            raise SystemExit(f"{a.id} has no drum profile; re-run add_song.py for it")
        d["examples"] = [e for e in d["examples"] if e["id"] != a.id] + [
            {"id": a.id, "style": a.style, "source": "song", "title": song["title"], "profile": prof["profile"]}]
        save(d)
        print(f"labelled {song['title']} as {d['styles'][a.style]['name']}")
    else:
        for st, info in d["styles"].items():
            ex = [e for e in d["examples"] if e["style"] == st]
            songs = [e.get("title", e["id"]) for e in ex if e["source"] == "song"]
            print(f"{info['name']:12s} {len(ex)} example(s){': ' + ', '.join(songs) if songs else ''}")


if __name__ == "__main__":
    main()
