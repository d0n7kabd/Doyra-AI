import numpy as np

from doyra_ai.features import FEATURE_NAMES, extract_features


def test_extract_features_returns_all_named_features():
    rng = np.random.default_rng(0)
    signal = rng.uniform(-1, 1, size=4410).astype(np.float32)
    feats = extract_features(signal, sr=44100)

    assert set(feats.keys()) == set(FEATURE_NAMES)
    for name, value in feats.items():
        assert np.isfinite(value), f"{name} is not finite: {value}"


def test_extract_features_handles_very_short_clip():
    signal = np.array([0.1, -0.2, 0.05], dtype=np.float32)
    feats = extract_features(signal, sr=44100)

    assert set(feats.keys()) == set(FEATURE_NAMES)
    for value in feats.values():
        assert np.isfinite(value)
