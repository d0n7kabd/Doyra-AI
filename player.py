"""Play Doyra rhythm sequences from WAV samples using pygame."""

from __future__ import annotations

import argparse
import time
from pathlib import Path

import pygame


class DoyraPlayer:
    """Load stroke samples and play rhythm sequences at a given BPM."""

    def __init__(self, sample_dir: str | Path = "samples", bpm: int = 100) -> None:
        self.sample_dir = Path(sample_dir)
        self.bpm = bpm
        self.samples: dict[str, pygame.mixer.Sound] = {}
        self.audio_available = self._initialize_audio()
        self.load_samples()

    def _initialize_audio(self) -> bool:
        """Initialize pygame mixer and fall back to silent timing if needed."""
        try:
            pygame.mixer.init()
            return True
        except pygame.error as error:
            print(f"Warning: audio output is unavailable ({error}). Playback will be silent.")
            return False

    def load_samples(self) -> None:
        """Load all WAV files found in the samples directory."""
        if not self.sample_dir.exists():
            print(f"Warning: sample directory not found: {self.sample_dir}")
            return

        for wav_path in self.sample_dir.glob("*.wav"):
            stroke_name = wav_path.stem.lower()
            try:
                if self.audio_available:
                    self.samples[stroke_name] = pygame.mixer.Sound(str(wav_path))
            except pygame.error as error:
                print(f"Warning: could not load sample '{wav_path.name}' ({error})")

    def beat_duration(self, bpm: int | None = None) -> float:
        """Return the duration of one beat in seconds."""
        active_bpm = bpm or self.bpm
        return 60.0 / active_bpm

    def play_sequence(self, sequence: list[str], bpm: int | None = None) -> None:
        """Play each stroke in the sequence in order."""
        active_bpm = bpm or self.bpm
        step_duration = self.beat_duration(active_bpm)

        for stroke in sequence:
            normalized_stroke = stroke.strip().lower()
            sound = self.samples.get(normalized_stroke)

            if normalized_stroke == "rest":
                print("Playing: rest")
            elif sound is not None and self.audio_available:
                print(f"Playing: {normalized_stroke}")
                sound.play()
            else:
                print(f"Playing: {normalized_stroke} (missing sample, silent placeholder)")

            time.sleep(step_duration)

    def close(self) -> None:
        """Shut down the mixer cleanly."""
        if self.audio_available:
            pygame.mixer.quit()


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Play a Doyra rhythm sequence.")
    parser.add_argument(
        "--sequence",
        nargs="+",
        default=["dom", "bak", "rak", "rest", "dom", "rak"],
        help="Stroke sequence to play, for example: --sequence dom bak rak rest",
    )
    parser.add_argument("--bpm", type=int, default=100, help="Tempo in beats per minute.")
    parser.add_argument(
        "--samples",
        default="samples",
        help="Path to the folder containing WAV files named after stroke types.",
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    player = DoyraPlayer(sample_dir=args.samples, bpm=args.bpm)
    try:
        player.play_sequence(args.sequence, bpm=args.bpm)
    finally:
        player.close()


if __name__ == "__main__":
    main()
