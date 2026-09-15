# Doyra AI — Phase A note classifier

Classifies isolated single-hit doyra (Uzbek frame drum) recordings into one
of 9 `note_hand-role` classes (e.g. `bak_main`, `kichik_bum_secondary`,
`noxun_secondary`). See `PROJECT_BRIEF.md` for full background and scope.

This is Phase A only: a note classifier trained on isolated hits. There is
no sequence/rhythm/generative modeling here, and no Phase B/hardware code.

## Project layout

```
data/                   197 isolated-hit WAV clips + metadata.csv
src/doyra_ai/
  features.py           feature extraction (hand-crafted + MFCC)
  dataset.py            loads data/metadata.csv + clips into X, y
  train.py              training pipeline, model comparison, saves the model
  infer.py              Predictor class + inference CLI
  paths.py              shared default paths
tests/                  pytest suite (feature + end-to-end smoke tests)
models/                 trained model (.joblib) + evaluation artifacts (generated)
prototype/              original proof-of-concept script, kept for reference
```

## Setup

Requires Python >= 3.10.

```bash
pip install -e ".[dev]"
```

## Train

```bash
python -m doyra_ai.train
# or, after install: doyra-train
```

This:
1. Extracts features for all 197 clips in `data/`.
2. Holds out a stratified 20% test set (never used for model selection).
3. Compares logistic regression, SVM (RBF), random forest, and kNN via
   5-fold stratified cross-validation on the training split only.
4. Evaluates the best candidate once on the held-out test set — that
   number is the trustworthy accuracy estimate.
5. Refits the winning model on the **full** dataset (train + test) and
   saves it to `models/phaseA_classifier.joblib`, since with only
   ~20 samples/class every clip helps the deployed model. The held-out
   test accuracy from step 4 is what estimates how well *that* model
   will generalize.

Outputs land in `models/`:
- `phaseA_classifier.joblib` — the trained model bundle (model + feature
  names + class list), used by inference.
- `results/classification_report.txt` — CV accuracy by model, held-out
  test accuracy, per-class precision/recall/F1.
- `results/confusion_matrix.png` — confusion matrix on the held-out test set.
- `results/summary.json` — same numbers as JSON.

Current run: **91.7% CV accuracy, 95% held-out test accuracy** (random
forest), up from the prototype's 90% CV-only baseline — the improvement
comes mainly from adding MFCC features (librosa wasn't available when the
prototype was built). Confusions still cluster where expected
(bak ↔ bum, kichik_bak ↔ kichik_bum) rather than randomly.

## Evaluate / regression-test

```bash
pytest
```

`tests/test_smoke.py` retrains the model in a temp directory and asserts
both CV and held-out accuracy stay above 80% — a floor meant to catch
silent regressions from future changes, not a target. `tests/test_features.py`
checks the feature extractor produces finite values for normal and
edge-case (very short) input.

## Inference

Python API:

```python
from doyra_ai.infer import Predictor

predictor = Predictor()  # loads models/phaseA_classifier.joblib by default
result = predictor.predict("data/clips/bak_main_01.wav")
# {"label": "bak_main", "note": "bak", "hand_role": "main", "confidence": 0.87}
```

CLI:

```bash
python -m doyra_ai.infer path/to/clip.wav
# or: doyra-infer path/to/clip.wav
```

Pass `--model-path` to either to use a different trained model.

## Open questions (from PROJECT_BRIEF.md, not resolved here)

- Whether 95% held-out accuracy is good enough to lock in as "deployed,"
  or worth chasing higher with more data/features first.
- Class balance is decent (19–25 samples/class) but not perfect — worth
  deciding whether to class-weight or collect more samples for the
  smaller classes.
