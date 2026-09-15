# Doyra AI — Phase A classifier: project brief

## What this project is
Doyra AI is a student research project modeling the rhythmic language of
the doyra (a traditional Uzbek frame drum), eventually driving a robot
that performs generated patterns. This stage is scoped to Phase A only:
building a solid, well-engineered note classifier from isolated single-hit
recordings. Sequence/rhythm generation is intentionally NOT in scope yet —
that depends on a later phase with proper ground-truth phrase labels,
which doesn't exist yet. Don't build a generative/sequence model on top of
this data; it would be trained on noise.

## The data (`data/`)
- `data/clips/*.wav` — 197 isolated single-hit recordings, mono, 44.1kHz
- `data/metadata.csv` — one row per clip: `clip_id, note, hand_role,
  syllable, source_file, onset_time_sec, clip_duration_sec, peak_amplitude,
  player_handedness, usul_name, tempo_bpm, session_date, clip_path`
  - `usul_name`/`tempo_bpm` are blank for all rows — not applicable at
    this phase (isolated notes, not phrases)
  - the label to predict is `note` + `hand_role` combined, e.g. `bak_main`,
    `kichik_bum_secondary`, `noxun_secondary` (noxun is secondary-hand only)
  - 9 classes total, roughly 19–25 samples each (see class list below)

## Class list (9 total)
bak_main, bak_secondary, bum_main, bum_secondary, kichik_bak_main,
kichik_bak_secondary, kichik_bum_main, kichik_bum_secondary, noxun_secondary

## What already works (`prototype/`)
`prototype/train_model_prototype.py` is a working proof of concept — NOT
production code, but the approach is validated and shouldn't be thrown
out:
- Hand-crafted features per clip: RMS, peak amplitude, attack time,
  decay time, zero-crossing rate, spectral centroid/bandwidth/rolloff,
  low/mid/high band energy ratios (11 features total)
- Compared logistic regression, SVM (RBF), random forest, kNN via 5-fold
  stratified cross-validation
- **Best result: SVM (RBF kernel), 90% cross-validation accuracy**,
  confusion matrix and full classification report in
  `prototype/phaseA_results/`
- The confusions that do happen are sensible (bak_main ↔ bum_main,
  kichik_bak ↔ kichik_bum) — not random noise

## What to build now
Turn the prototype into a real, usable package:
1. **Clean project structure** — proper Python package (`src/` layout or
   similar), not a single script. Your call on structure/tooling.
2. **Feature extraction module** — port the prototype's features (or
   improve them — e.g. MFCCs would likely help, no librosa was available
   in the prototyping environment, but feel free to add it as a real
   dependency now if useful)
3. **Training pipeline** — reproduce and ideally improve on the 90%
   baseline. Proper train/test methodology, not just cross-validation on
   everything (e.g. hold out a true test set too). Save the trained
   model to disk (joblib/pickle) so it doesn't need retraining every run.
4. **Inference API** — a simple function/CLI: given a new isolated-note
   WAV file, return the predicted note + hand + confidence.
5. **Tests** — at minimum, a smoke test that training runs and produces
   a model above some reasonable accuracy floor (e.g. >80%) on this
   dataset, so future changes don't silently regress it.
6. **A short README** explaining how to train, evaluate, and run
   inference.

## Explicitly out of scope for this stage
- No sequence/rhythm/generative modeling
- No hardware/robot integration code
- Don't fetch or assume any Phase B data exists — this package should
  work standalone on `data/` as given

## Open questions worth flagging back to the user (not blocking)
- Whether 90% is good enough to lock in as the deployed model, or worth
  chasing higher with better features/more data first
- Class balance is decent but not perfect (19–25 per class) — worth
  deciding whether to weight classes or collect a few more samples for
  the underrepresented ones
