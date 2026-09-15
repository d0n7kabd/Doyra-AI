"""Shared default paths, kept separate to avoid train/infer import cycles."""
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_DATA_DIR = REPO_ROOT / "data"
DEFAULT_MODEL_PATH = REPO_ROOT / "models" / "phaseA_classifier.joblib"
DEFAULT_RESULTS_DIR = REPO_ROOT / "models" / "results"
