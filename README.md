# Doyra AI — teaching a machine the doira

Doyra AI is a research project by Doniyor Abdusalimov, a doira player from
Samarkand, Uzbekistan. It is the code and data behind the paper
*Teaching a Machine the Doira* (2026).

The doira is the frame drum of Uzbek and Tajik music. It is taught from
notation, but much of how it is played passes from teacher to student by
ear. The project asks what a computer has to be told before it can follow
the drum, and finds the same answer three times: **at each level, the
computer had to be given something a doira player knows without being
told.**

## The nine strokes

bum, bak, kichik bum, kichik bak (each played with the main or the
secondary hand) and noxun. Strokes are chanted as **"ta"** (main hand) and
**"ka"** (secondary hand); bums have no syllable.

## The three levels

**Level 1: which stroke.** A classifier trained on 197 isolated strokes
reached 95% on held-out clips (91.7% in cross-validation), but only 48% on
164 strokes inside real phrases.

**Level 2: where in the cycle.** A model that ignored the usul cycle kept at
most 28% of generated cycles intact; a cycle-aware generator kept 100%.
Identifying the usul from audio worked in 11 of 33 cases.

**Level 3: exactly when.** In the to'y rhythm (a wedding usul, played during
the yor-yor), the two baks in each group are played about 30–40 ms closer
together than the other strokes, a pattern the player doesn't feel. It
fades at slow tempos. In a listening test, three trained doira players
could not tell measured timing from even timing; Doniyor's teacher,
guessing clip by clip, got 2 of 9.

This repository contains the Level 1 classifier (`src/doyra_ai`), the
dataset it was trained on, and the phrase-level drafts and analysis that
started Level 2 (`phaseB_drafts/`, `scripts/`).

## Run the classifier

Requires Python >= 3.10.

```bash
pip install -e ".[dev]"
```

### Train

```bash
python -m doyra_ai.train
# or, after install: doyra-train
```

This:
1. Extracts features (hand-crafted + MFCC) for all 197 clips in `data/`.
2. Holds out a stratified 20% test set (never used for model selection).
3. Compares logistic regression, SVM (RBF), random forest and kNN with
   5-fold stratified cross-validation on the training split only.
4. Evaluates the best candidate once on the held-out test set. That number
   is the trustworthy accuracy estimate.
5. Refits the winning model on the full dataset and saves it to
   `models/phaseA_classifier.joblib`.

Outputs in `models/`:
- `phaseA_classifier.joblib`: the trained model bundle (model + feature
  names + class list).
- `results/classification_report.txt`: CV accuracy by model, held-out test
  accuracy, per-class precision/recall/F1.
- `results/confusion_matrix.png`: confusion matrix on the held-out test set.
- `results/summary.json`: the same numbers as JSON.

### Test

```bash
pytest
```

`tests/test_smoke.py` retrains the model in a temp directory and checks that
CV and held-out accuracy stay above 80% (a regression floor, not a target).
`tests/test_features.py` checks the feature extractor on normal and very
short input.

### Classify a stroke

```python
from doyra_ai.infer import Predictor

predictor = Predictor()  # loads models/phaseA_classifier.joblib
result = predictor.predict("data/clips/bak_main_01.wav")
# {"label": "bak_main", "note": "bak", "hand_role": "main", "confidence": 0.87}
```

```bash
python -m doyra_ai.infer path/to/clip.wav
# or: doyra-infer path/to/clip.wav
```

Pass `--model-path` to use a different trained model.

### Phrase analysis

```bash
python scripts/analyze_phaseB_phrases.py [usul_audio_dir]
```

Runs the classifier over the `Usul_*_normal` phrase recordings (default
folder: `data/usul_audio/`, relative to the repo root).

## Open the website

The landing page is a static site in `doyra-ai-site/` with no build step.
Serve it locally (the drum sounds need a server, not `file://`):

```bash
cd doyra-ai-site
python -m http.server 8000
```

Then open <http://localhost:8000>. The "Play with the AI" button opens
`studio/index.html`, Doyra Studio. After pulling changes, reload with
Ctrl+F5 so the browser doesn't keep old files.

## Doyra Studio

`doyra-ai-site/studio/` is where people play with the AI: pick a song (or
choose your own file) and hear it with a doira, in an usul or in a groove for
the song's style. Every drum sound is one of the recorded strokes.

- **Rhythm**: Auto (a groove for the detected style: house, reggaeton, pop),
  to'y, or Usul 1, 3, 4, 5, 6. Usuls that don't fill a 4/4 bar can be fitted
  to the bar or run free against it.
- **Feel**: Player uses the measured gaps, scaled by tempo (full at the
  recorded tempo, fading toward the slow recordings' amounts); Machine is even.
- **More**: tempo, the usul and its feel, the detected style with confidence
  (and a choice that overrides it), downloads.

### Song library

Song audio stays on this laptop (`songs/` and `studio/library/audio/` are in
`.gitignore`). On the public website each library song plays the doira alone
on the song's analysed beat.

```bash
python tools/library/add_song.py --file "songs/Despacito.mp3" --title "Despacito" --artist "Luis Fonsi"
python tools/library/add_song.py --folder songs/      # every song in the folder
python tools/library/add_song.py --remove despacito
```

In `--folder` mode names come from `songs/titles.csv` (file, title, artist,
id, skip), then the file's tags, then a file name like `Artist - Title.mp3`.
Needs Node.js: the library uses the studio's own analysis code.

### Style detection

Nearest neighbour on each song's drum onset profile (kick, snare, hi-hat at
the 16 positions of a bar), against labelled examples in
`studio/data/styles.json`. Add your own labels, or a new style:

```bash
node tools/library/style_report.mjs                     # detection on every library song
python tools/library/label_style.py --id gasolina --style reggaeton
python tools/library/label_style.py --new-style uzbek-pop --name "Uzbek pop"
```

### Engine checks

```bash
python tools/build_sounds.py                            # stroke bank from data/clips
python tools/make_engine_test.py synth --style pop --bpm 96 --out test.f32
node tools/check_engine.mjs test.f32                    # tempo, beats, bar line vs. answer key
python tools/measure_usul_tempo.py "folder with Usul_*_normal/slow.m4a"
```

## Folder structure

```
data/                    197 isolated stroke recordings (clips/) + metadata.csv
src/doyra_ai/
  features.py            feature extraction (hand-crafted + MFCC)
  dataset.py             loads data/metadata.csv + clips into X, y
  train.py               training pipeline, model comparison, saves the model
  infer.py               Predictor class + inference CLI
  paths.py               shared default paths (relative to the repo root)
tests/                   pytest suite (feature + end-to-end smoke tests)
models/                  trained model (.joblib) + evaluation results
prototype/               original proof-of-concept script, kept for reference
phaseB_drafts/           draft transcriptions of six usul phrase recordings
scripts/                 phrase analysis + draft-writing scripts
doyra-ai-site/           the website (GitHub Pages)
  index.html, style.css, script.js
  sounds/                one real recording per stroke, copied from data/clips
  studio/                Doyra Studio: index.html, js/ (engine, usuls, patterns,
                         style), sounds/players/ (stroke banks), library/, data/
tools/                   stroke bank, library (add_song.py), style labels, engine tests
PROJECT_BRIEF.md         original brief for the Level 1 classifier
```

Source: <https://github.com/d0n7kabd/Doyra-AI>
