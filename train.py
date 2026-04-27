"""Train a simple LSTM model to predict the next Doyra stroke."""

from __future__ import annotations

import argparse
import random
from pathlib import Path

import torch
from torch import nn
from torch.nn.utils.rnn import pad_sequence
from torch.utils.data import DataLoader, Dataset

from model_utils import RhythmLSTM, build_vocabulary, create_training_examples, load_patterns


class RhythmDataset(Dataset):
    """Torch dataset for prefix-to-next-stroke training examples."""

    def __init__(self, examples: list[tuple[list[int], int]]) -> None:
        self.examples = examples

    def __len__(self) -> int:
        return len(self.examples)

    def __getitem__(self, index: int) -> tuple[torch.Tensor, torch.Tensor]:
        prefix, target = self.examples[index]
        return torch.tensor(prefix, dtype=torch.long), torch.tensor(target, dtype=torch.long)


def collate_batch(
    batch: list[tuple[torch.Tensor, torch.Tensor]],
) -> tuple[torch.Tensor, torch.Tensor, torch.Tensor]:
    """Pad variable-length prefixes into a single batch."""
    sequences, targets = zip(*batch)
    lengths = torch.tensor([len(sequence) for sequence in sequences], dtype=torch.long)
    padded = pad_sequence(sequences, batch_first=True)
    target_tensor = torch.stack(targets)
    return padded, lengths, target_tensor


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Train a Doyra rhythm LSTM model.")
    parser.add_argument("--data", default="data/rhythm_patterns.json", help="Path to the JSON dataset.")
    parser.add_argument("--epochs", type=int, default=150, help="Number of training epochs.")
    parser.add_argument("--batch-size", type=int, default=8, help="Mini-batch size.")
    parser.add_argument("--embedding-dim", type=int, default=16, help="Embedding dimension.")
    parser.add_argument("--hidden-dim", type=int, default=64, help="LSTM hidden size.")
    parser.add_argument("--learning-rate", type=float, default=0.01, help="Optimizer learning rate.")
    parser.add_argument("--seed", type=int, default=42, help="Random seed for reproducible training.")
    parser.add_argument("--output", default="model.pt", help="Output path for the trained model checkpoint.")
    return parser.parse_args()


def set_seed(seed: int) -> None:
    random.seed(seed)
    torch.manual_seed(seed)


def main() -> None:
    args = parse_args()
    set_seed(args.seed)

    patterns = load_patterns(args.data)
    stroke_to_idx, idx_to_stroke = build_vocabulary(patterns)
    examples = create_training_examples(patterns, stroke_to_idx)
    dataset = RhythmDataset(examples)
    loader = DataLoader(dataset, batch_size=args.batch_size, shuffle=True, collate_fn=collate_batch)

    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    model = RhythmLSTM(
        vocab_size=len(stroke_to_idx),
        embedding_dim=args.embedding_dim,
        hidden_dim=args.hidden_dim,
    ).to(device)

    optimizer = torch.optim.Adam(model.parameters(), lr=args.learning_rate)
    criterion = nn.CrossEntropyLoss()

    print(f"Loaded {len(patterns)} patterns and {len(examples)} training examples.")
    print(f"Training on device: {device}")

    for epoch in range(1, args.epochs + 1):
        model.train()
        epoch_loss = 0.0

        for padded, lengths, targets in loader:
            padded = padded.to(device)
            lengths = lengths.to(device)
            targets = targets.to(device)

            optimizer.zero_grad()
            logits = model(padded, lengths)
            loss = criterion(logits, targets)
            loss.backward()
            optimizer.step()

            epoch_loss += loss.item()

        average_loss = epoch_loss / max(len(loader), 1)
        if epoch == 1 or epoch % 10 == 0 or epoch == args.epochs:
            print(f"Epoch {epoch:03d}/{args.epochs} - loss: {average_loss:.4f}")

    checkpoint = {
        "model_state_dict": model.state_dict(),
        "stroke_to_idx": stroke_to_idx,
        "idx_to_stroke": idx_to_stroke,
        "embedding_dim": args.embedding_dim,
        "hidden_dim": args.hidden_dim,
        "dataset_path": str(Path(args.data).resolve()),
    }
    torch.save(checkpoint, args.output)
    print(f"Model saved to {args.output}")


if __name__ == "__main__":
    main()
