"""Feature extraction for isolated single-hit doyra clips.

Two feature families are combined:
  - Hand-crafted time/frequency-domain features, ported from the
    Phase A prototype (prototype/train_model_prototype.py).
  - MFCCs (mean + std over time), added here since librosa wasn't
    available in the original prototyping environment.
"""
from __future__ import annotations

import numpy as np
import librosa

HANDCRAFTED_FEATURE_NAMES = [
    "rms", "peak", "attack_ms", "decay_ms", "zcr",
    "centroid", "bandwidth", "rolloff", "low_e", "mid_e", "high_e",
]

N_MFCC = 13
MFCC_FEATURE_NAMES = [f"mfcc{i}_mean" for i in range(N_MFCC)] + [
    f"mfcc{i}_std" for i in range(N_MFCC)
]

FEATURE_NAMES = HANDCRAFTED_FEATURE_NAMES + MFCC_FEATURE_NAMES


def _handcrafted_features(seg: np.ndarray, sr: int) -> dict[str, float]:
    peak = float(np.max(np.abs(seg))) if len(seg) else 0.0
    rms = float(np.sqrt(np.mean(seg**2))) if len(seg) else 0.0
    peak_idx = int(np.argmax(np.abs(seg))) if len(seg) else 0
    attack_ms = (peak_idx / sr) * 1000

    thresh = 0.25 * peak if peak > 0 else 0
    decay_idx = len(seg) - 1
    for i in range(peak_idx, len(seg)):
        if abs(seg[i]) < thresh:
            decay_idx = i
            break
    decay_ms = ((decay_idx - peak_idx) / sr) * 1000

    zcr = float(np.mean(np.abs(np.diff(np.sign(seg)))) / 2) if len(seg) > 1 else 0.0

    tail = seg[peak_idx:]
    if len(tail) > 64:
        win = np.hanning(len(tail))
        spec = np.abs(np.fft.rfft(tail * win))
        freqs = np.fft.rfftfreq(len(tail), d=1 / sr)
        mag_sum = np.sum(spec) + 1e-9
        centroid = float(np.sum(freqs * spec) / mag_sum)
        bandwidth = float(np.sqrt(np.sum(((freqs - centroid) ** 2) * spec) / mag_sum))
        cum = np.cumsum(spec)
        rolloff_idx = np.searchsorted(cum, 0.85 * cum[-1])
        rolloff = float(freqs[min(rolloff_idx, len(freqs) - 1)])
        low = float(np.sum(spec[(freqs >= 0) & (freqs < 500)]) / mag_sum)
        mid = float(np.sum(spec[(freqs >= 500) & (freqs < 2000)]) / mag_sum)
        high = float(np.sum(spec[freqs >= 2000]) / mag_sum)
    else:
        centroid = bandwidth = rolloff = low = mid = high = 0.0

    return {
        "rms": rms, "peak": peak, "attack_ms": attack_ms, "decay_ms": decay_ms,
        "zcr": zcr, "centroid": centroid, "bandwidth": bandwidth, "rolloff": rolloff,
        "low_e": low, "mid_e": mid, "high_e": high,
    }


def _mfcc_features(seg: np.ndarray, sr: int) -> dict[str, float]:
    seg32 = seg.astype(np.float32)
    if len(seg32) < 512:
        seg32 = np.pad(seg32, (0, 512 - len(seg32)))
    n_fft = min(2048, len(seg32))
    hop_length = max(n_fft // 4, 1)
    mfccs = librosa.feature.mfcc(
        y=seg32, sr=sr, n_mfcc=N_MFCC, n_fft=n_fft, hop_length=hop_length
    )
    means = mfccs.mean(axis=1)
    stds = mfccs.std(axis=1)

    feats: dict[str, float] = {}
    for i in range(N_MFCC):
        feats[f"mfcc{i}_mean"] = float(means[i])
        feats[f"mfcc{i}_std"] = float(stds[i])
    return feats


def extract_features(signal: np.ndarray, sr: int) -> dict[str, float]:
    """Extract the full feature vector for one isolated-hit clip.

    `signal` is expected to be mono, float, roughly in [-1, 1] (as
    returned by ``librosa.load``). Integer PCM input is tolerated and
    normalized defensively.
    """
    signal = np.asarray(signal)
    if signal.ndim > 1:
        signal = signal[:, 0]
    signal = signal.astype(np.float64)

    peak = float(np.max(np.abs(signal))) if len(signal) else 0.0
    if peak > 1.0:
        signal = signal / 32768.0

    if len(signal) < 20:
        signal = np.pad(signal, (0, 20 - len(signal)))

    feats: dict[str, float] = {}
    feats.update(_handcrafted_features(signal, sr))
    feats.update(_mfcc_features(signal, sr))
    return feats


def features_to_vector(feats: dict[str, float], feature_names: list[str] = FEATURE_NAMES) -> list[float]:
    return [feats[name] for name in feature_names]
