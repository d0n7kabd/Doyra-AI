"""Drum stem of a song with Demucs (htdemucs), for "exact drums".

Runs on the CPU, in segments (Demucs' split mode), so memory stays bounded.
The model (~80 MB) downloads on first use into the torch hub cache.
"""
from __future__ import annotations

import numpy as np

_separator = None


def separator():
    global _separator
    if _separator is None:
        from demucs.api import Separator  # imported lazily: optional dependency
        _separator = Separator(model="htdemucs", device="cpu", split=True, overlap=0.25, jobs=0)
    return _separator


def drum_stem(song: np.ndarray, sr: int) -> np.ndarray:
    """song: (2, n) float32 at sr. Returns the drum stem, mono, at sr."""
    import torch
    sep = separator()
    x = torch.from_numpy(np.ascontiguousarray(song))
    with torch.inference_mode():
        _, stems = sep.separate_tensor(x, sr)
    drums = stems["drums"].mean(dim=0).numpy().astype(np.float32)
    if sep.samplerate != sr:  # htdemucs works at 44.1 kHz; resample if the song isn't
        import librosa
        drums = librosa.resample(drums, orig_sr=sep.samplerate, target_sr=sr)
    return drums[: song.shape[1]]


def available() -> bool:
    try:
        import demucs.api  # noqa: F401
        return True
    except Exception:
        return False
