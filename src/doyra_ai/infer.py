"""Inference API + CLI: predict note + hand_role for a new isolated-hit WAV."""
from __future__ import annotations

import argparse
import json
from pathlib import Path

import joblib
import librosa
import numpy as np

from .features import extract_features, features_to_vector
from .paths import DEFAULT_MODEL_PATH


class Predictor:
    """Loads a trained Phase A classifier bundle and predicts on new clips."""

    def __init__(self, model_path: str | Path = DEFAULT_MODEL_PATH):
        model_path = Path(model_path)
        if not model_path.exists():
            raise FileNotFoundError(
                f"No trained model found at {model_path}. Run training first "
                f"(e.g. `python -m doyra_ai.train`)."
            )
        bundle = joblib.load(model_path)
        self.model = bundle["model"]
        self.feature_names = bundle["feature_names"]
        self.classes = bundle["classes"]

    def predict(self, wav_path: str | Path) -> dict:
        signal, sr = librosa.load(wav_path, sr=None, mono=True)
        feats = extract_features(signal, sr)
        vector = np.array([features_to_vector(feats, self.feature_names)])

        label = str(self.model.predict(vector)[0])
        note, hand_role = label.rsplit("_", 1)

        confidence = None
        if hasattr(self.model, "predict_proba"):
            proba = self.model.predict_proba(vector)[0]
            model_classes = list(self.model.classes_)
            confidence = float(proba[model_classes.index(label)])

        return {
            "label": label,
            "note": note,
            "hand_role": hand_role,
            "confidence": confidence,
        }


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(
        description="Predict the note + hand for an isolated-hit doyra WAV file."
    )
    parser.add_argument("wav_path", type=Path, help="Path to a WAV file")
    parser.add_argument("--model-path", type=Path, default=DEFAULT_MODEL_PATH)
    args = parser.parse_args(argv)

    predictor = Predictor(args.model_path)
    result = predictor.predict(args.wav_path)
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
