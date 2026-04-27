"""Generate a new Doyra rhythm pattern and play it with loaded samples."""

from __future__ import annotations

import argparse
import random

import torch

from model_utils import RhythmLSTM
from player import DoyraPlayer


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Generate and play a Doyra rhythm pattern.")
    parser.add_argument("--model", default="model.pt", help="Path to a trained model checkpoint.")
    parser.add_argument("--length", type=int, default=16, help="Number of strokes to generate.")
    parser.add_argument("--seed-sequence", nargs="+", default=["dom"], help="Initial strokes for generation.")
    parser.add_argument("--temperature", type=float, default=1.0, help="Sampling temperature.")
    parser.add_argument("--bpm", type=int, default=100, help="Playback tempo in beats per minute.")
    parser.add_argument("--samples", default="samples", help="Path to the WAV sample directory.")
    parser.add_argument("--random-seed", type=int, default=42, help="Random seed for sampling.")
    return parser.parse_args()


def sample_next_stroke(
    model: RhythmLSTM,
    sequence_ids: list[int],
    temperature: float,
    device: torch.device,
) -> int:
    """Sample the next token from the model output distribution."""
    input_tensor = torch.tensor([sequence_ids], dtype=torch.long, device=device)
    lengths = torch.tensor([len(sequence_ids)], dtype=torch.long, device=device)

    with torch.no_grad():
        logits = model(input_tensor, lengths).squeeze(0)

    scaled_logits = logits / max(temperature, 1e-6)
    probabilities = torch.softmax(scaled_logits, dim=0)
    next_id = torch.multinomial(probabilities, num_samples=1).item()
    return next_id


def main() -> None:
    args = parse_args()
    random.seed(args.random_seed)
    torch.manual_seed(args.random_seed)

    checkpoint = torch.load(args.model, map_location="cpu")
    stroke_to_idx: dict[str, int] = checkpoint["stroke_to_idx"]
    idx_to_stroke = {int(key): value for key, value in checkpoint["idx_to_stroke"].items()}

    model = RhythmLSTM(
        vocab_size=len(stroke_to_idx),
        embedding_dim=checkpoint["embedding_dim"],
        hidden_dim=checkpoint["hidden_dim"],
    )
    model.load_state_dict(checkpoint["model_state_dict"])
    model.eval()

    device = torch.device("cpu")
    model.to(device)

    generated = [stroke.strip().lower() for stroke in args.seed_sequence if stroke.strip()]
    if not generated:
        generated = ["dom"]

    for stroke in generated:
        if stroke not in stroke_to_idx:
            raise ValueError(f"Unknown stroke in seed sequence: {stroke}")

    generated = generated[: args.length]

    while len(generated) < args.length:
        sequence_ids = [stroke_to_idx[stroke] for stroke in generated]
        next_id = sample_next_stroke(model, sequence_ids, args.temperature, device)
        generated.append(idx_to_stroke[next_id])

    print("Generated rhythm:")
    print(" ".join(generated))

    player = DoyraPlayer(sample_dir=args.samples, bpm=args.bpm)
    try:
        player.play_sequence(generated, bpm=args.bpm)
    finally:
        player.close()


if __name__ == "__main__":
    main()
