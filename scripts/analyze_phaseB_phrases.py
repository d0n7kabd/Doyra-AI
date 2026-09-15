"""Ad hoc analysis script -- NOT part of the doyra_ai package.

Applies the trained Phase A classifier to the 6 Usul_*_normal phrase
recordings, using the same onset-detection heuristic as the original
prototype (prototype/train_model_prototype.py), to sanity-check how well
the improved model's confidence generalizes to real (untrained-on) phrase
audio compared to the prototype's own run (~20-35% mean confidence, see
prototype/phaseA_results/phaseB_transcriptions.json).

This is a diagnostic, not a deliverable: per PROJECT_BRIEF.md, Phase A
should not assume Phase B data exists, and sequence/rhythm modeling is out
of scope. This script just measures classifier confidence on individual
detected hits within phrases -- it does not do any sequence modeling.

Usage:
    python scripts/analyze_phaseB_phrases.py [usul_audio_dir]

Default usul_audio_dir: "C:/Users/E-MaxPCShop/Downloads/Telegram Desktop"
(wherever the Usul_*_normal.m4a files happen to live locally).
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import av
import joblib
import numpy as np

REPO_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO_ROOT / "src"))

from doyra_ai.features import extract_features, features_to_vector  # noqa: E402
from doyra_ai.paths import DEFAULT_MODEL_PATH  # noqa: E402

DEFAULT_USUL_DIR = Path(r"C:\Users\E-MaxPCShop\Downloads\Telegram Desktop")
OUT_PATH = REPO_ROOT / "models" / "results" / "phaseB_generalization_check.json"


def load_m4a_mono(path: Path) -> tuple[np.ndarray, int]:
    """Decode an m4a file to a mono float32 array using PyAV (no ffmpeg needed)."""
    container = av.open(str(path))
    stream = container.streams.audio[0]
    sr = stream.rate
    resampler = av.AudioResampler(format="fltp", layout="mono", rate=sr)
    chunks = []
    for frame in container.decode(stream):
        for rframe in resampler.resample(frame):
            chunks.append(rframe.to_ndarray().reshape(-1))
    container.close()
    signal = np.concatenate(chunks) if chunks else np.array([], dtype=np.float32)
    return signal, sr


def detect_onsets(sig: np.ndarray, sr: int, min_gap_sec=0.15, thresh_ratio=0.10, release_ratio=0.35) -> list[int]:
    """Ported unchanged from prototype/train_model_prototype.py."""
    sig = sig.astype(np.float64)
    sig = sig / (np.max(np.abs(sig)) + 1e-9)
    win = int(sr * 0.004)
    env = np.abs(sig)
    kernel = np.ones(win) / win
    env_smooth = np.convolve(env, kernel, mode="same")
    thresh = thresh_ratio * np.max(env_smooth)
    release_thresh = release_ratio * thresh
    min_gap = int(sr * min_gap_sec)
    onsets = []
    state = "below"
    last_onset = -min_gap
    for i in range(len(env_smooth)):
        v = env_smooth[i]
        if state in ("below", "released") and v > thresh:
            if i - last_onset > min_gap:
                onsets.append(i)
                last_onset = i
            state = "above"
        elif state == "above" and v < release_thresh:
            state = "released"
    return onsets


def main() -> None:
    usul_dir = Path(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_USUL_DIR
    files = sorted(usul_dir.glob("Usul_*_normal.*"))
    if not files:
        raise SystemExit(f"No Usul_*_normal.* files found in {usul_dir}")

    bundle = joblib.load(DEFAULT_MODEL_PATH)
    model = bundle["model"]
    feature_names = bundle["feature_names"]
    model_classes = list(model.classes_)

    transcriptions: dict[str, list[dict]] = {}
    all_confidences: list[float] = []
    per_file_mean: dict[str, float] = {}

    for path in files:
        signal, sr = load_m4a_mono(path)
        onsets = detect_onsets(signal, sr)

        seq = []
        window_samples = int(sr * 0.3)
        for onset in onsets:
            seg = signal[onset:onset + window_samples]
            if len(seg) < 20:
                continue
            feats = extract_features(seg, sr)
            vec = np.array([features_to_vector(feats, feature_names)])
            label = str(model.predict(vec)[0])
            proba = model.predict_proba(vec)[0]
            conf = float(proba[model_classes.index(label)])
            seq.append({"time_sec": round(onset / sr, 3), "pred": label, "confidence": round(conf, 3)})
            all_confidences.append(conf)

        name = path.stem
        transcriptions[name] = seq
        mean_conf = float(np.mean([s["confidence"] for s in seq])) if seq else 0.0
        per_file_mean[name] = round(mean_conf, 3)
        print(f"{name}: {len(seq)} hits detected, mean confidence {mean_conf:.3f}")

    overall_mean = float(np.mean(all_confidences)) if all_confidences else 0.0
    print(f"\nOverall mean confidence across all {len(all_confidences)} detected hits: {overall_mean:.3f}")
    print("Prototype baseline (hand-crafted features only, from prototype/phaseA_results/): ~0.20-0.35")

    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    with open(OUT_PATH, "w", encoding="utf-8") as f:
        json.dump(
            {
                "per_file_mean_confidence": per_file_mean,
                "overall_mean_confidence": round(overall_mean, 3),
                "n_hits_total": len(all_confidences),
                "transcriptions": transcriptions,
            },
            f,
            indent=2,
        )
    print(f"\nFull transcriptions + summary written to {OUT_PATH}")


if __name__ == "__main__":
    main()
