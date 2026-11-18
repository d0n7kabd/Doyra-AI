# Doyra AI v2 (November 2026 session)

- `recognize.py` + `stroke_classifier_v2.joblib`: give it any doira recording; it finds every stroke, names it, and guesses the usul.
  `pip install librosa scikit-learn joblib` then `python recognize.py my_take.m4a`
- `doira_v2_stroke_labels.csv`: all 2,587 strokes from the 18 takes (6 usuls x slow/normal/fast), labeled from the usul patterns.
- `analysis/`: the scripts behind the numbers in the paper.

Results (each usul tested on a model that never heard it):
- exact stroke inside phrases: 86% (was 48%); bum vs bak 94%; hand 89% (Usul 3 = 15-stroke pattern)
- usul recognition, 20-stroke passages: 105/119 = 88% (old bum/bak method: 71%)
- to'y ratio: 0.98 at 73 strokes/min, 1.06 at 220, 1.27 at 360

Audio files are not included; keep them in data/ locally.

## Variation generator (free-playing takes, Nov 2026)
- `generator/cyclegen2.py` + `generator/beats2.py`: current version. Finds the beat and the usul cycle in a free take
  (cycles of 4 or 8 beats), keeps rests, cuts the take into whole real cycles, and re-orders them using joins that
  happen in real playing and the loudness shape of a real phrase (30 ms crossfades).
- `generator/cyclegen.py`: first cycle-level version (dropped the pauses: "weak pausing").
- `generator/beatgen.py`: beat-level version (kept the pulse, but an expert heard it easily).
- `generator/gen.py`: first stroke-level n-gram version (statistically close, but sounded like noise: no pulse).
- `generator/build_studio_assets.py`: builds `doyra-ai-site/studio/generate/` for the Studio's Generate mode
  (each free take as m4a + its cycles, and a set of in-phrase strokes for the taught pattern). The live
  version in the Studio also asks a new join to match in loudness and tempo.

Blind test with my current doira teacher (20-second pairs, real vs generated):
- round 1 (cyclegen): could not decide for Usul 2; found the generated clip for Usuls 3 and 4
  ("the rhythm loses itself and becomes noise", weak pausing)
- round 2 (cyclegen2): could not decide for Usul 3; found it for Usuls 2, 4 and 6
  ("poor transitions between variations in the rhythm")
- 2 of 7 pairs not told apart; he never picked the generated clip as the real player.
