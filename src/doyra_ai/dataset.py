"""Loading the Phase A dataset (data/metadata.csv + data/clips/*.wav)."""
from __future__ import annotations

import csv
from dataclasses import dataclass
from pathlib import Path

import librosa
import numpy as np

from .features import FEATURE_NAMES, extract_features, features_to_vector


@dataclass
class Dataset:
    X: np.ndarray
    y: np.ndarray
    clip_ids: list[str]
    feature_names: list[str]


def label_for_row(row: dict[str, str]) -> str:
    return f"{row['note']}_{row['hand_role']}"


def load_dataset(data_dir: str | Path) -> Dataset:
    data_dir = Path(data_dir)
    metadata_path = data_dir / "metadata.csv"
    if not metadata_path.exists():
        raise FileNotFoundError(f"metadata.csv not found at {metadata_path}")

    with open(metadata_path, newline="", encoding="utf-8") as f:
        rows = list(csv.DictReader(f))
    if not rows:
        raise ValueError(f"{metadata_path} has no data rows")

    X: list[list[float]] = []
    y: list[str] = []
    clip_ids: list[str] = []
    for row in rows:
        clip_path = data_dir / row["clip_path"]
        signal, sr = librosa.load(clip_path, sr=None, mono=True)
        feats = extract_features(signal, sr)
        X.append(features_to_vector(feats))
        y.append(label_for_row(row))
        clip_ids.append(row["clip_id"])

    return Dataset(
        X=np.array(X, dtype=np.float64),
        y=np.array(y),
        clip_ids=clip_ids,
        feature_names=list(FEATURE_NAMES),
    )
