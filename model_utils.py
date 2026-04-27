"""Shared utilities for dataset loading and LSTM rhythm modeling."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Iterable

import torch
from torch import nn

DEFAULT_STROKES = ["dom", "bak", "rak", "rest"]


def load_patterns(data_path: str | Path) -> list[list[str]]:
    """Load rhythm patterns from a JSON file."""
    path = Path(data_path)
    with path.open("r", encoding="utf-8") as file:
        payload = json.load(file)

    patterns = payload.get("patterns", [])
    if not patterns:
        raise ValueError(f"No rhythm patterns found in {path}")

    normalized_patterns: list[list[str]] = []
    for pattern in patterns:
        if not isinstance(pattern, list) or len(pattern) < 2:
            continue
        normalized = [str(stroke).strip().lower() for stroke in pattern if str(stroke).strip()]
        if len(normalized) >= 2:
            normalized_patterns.append(normalized)

    if not normalized_patterns:
        raise ValueError(f"No valid rhythm patterns found in {path}")

    return normalized_patterns


def build_vocabulary(patterns: Iterable[Iterable[str]]) -> tuple[dict[str, int], dict[int, str]]:
    """Build token mappings while keeping known strokes first."""
    tokens = {stroke for pattern in patterns for stroke in pattern}
    ordered_tokens = [stroke for stroke in DEFAULT_STROKES if stroke in tokens]
    ordered_tokens.extend(sorted(tokens - set(ordered_tokens)))

    stroke_to_idx = {stroke: index for index, stroke in enumerate(ordered_tokens)}
    idx_to_stroke = {index: stroke for stroke, index in stroke_to_idx.items()}
    return stroke_to_idx, idx_to_stroke


def encode_pattern(pattern: Iterable[str], stroke_to_idx: dict[str, int]) -> list[int]:
    """Convert a stroke pattern into token ids."""
    return [stroke_to_idx[stroke] for stroke in pattern]


def create_training_examples(patterns: list[list[str]], stroke_to_idx: dict[str, int]) -> list[tuple[list[int], int]]:
    """Create prefix-to-next-stroke examples from complete patterns."""
    examples: list[tuple[list[int], int]] = []
    for pattern in patterns:
        encoded = encode_pattern(pattern, stroke_to_idx)
        for index in range(1, len(encoded)):
            prefix = encoded[:index]
            target = encoded[index]
            examples.append((prefix, target))
    return examples


class RhythmLSTM(nn.Module):
    """A small LSTM model for next-stroke prediction."""

    def __init__(
        self,
        vocab_size: int,
        embedding_dim: int = 16,
        hidden_dim: int = 64,
        num_layers: int = 1,
    ) -> None:
        super().__init__()
        self.embedding = nn.Embedding(vocab_size, embedding_dim)
        self.lstm = nn.LSTM(
            input_size=embedding_dim,
            hidden_size=hidden_dim,
            num_layers=num_layers,
            batch_first=True,
        )
        self.output = nn.Linear(hidden_dim, vocab_size)

    def forward(self, inputs: torch.Tensor, lengths: torch.Tensor) -> torch.Tensor:
        embedded = self.embedding(inputs)
        packed = nn.utils.rnn.pack_padded_sequence(
            embedded,
            lengths.cpu(),
            batch_first=True,
            enforce_sorted=False,
        )
        _, (hidden_state, _) = self.lstm(packed)
        logits = self.output(hidden_state[-1])
        return logits
