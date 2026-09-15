"""Smoke test: training runs end-to-end and clears an accuracy floor.

This is the regression guard called for in PROJECT_BRIEF.md -- if a
future change to features/model/pipeline silently tanks accuracy,
this test should catch it.
"""
from pathlib import Path

from doyra_ai.infer import Predictor
from doyra_ai.train import train

REPO_ROOT = Path(__file__).resolve().parents[1]
ACCURACY_FLOOR = 0.80


def test_training_runs_and_clears_accuracy_floor(tmp_path):
    model_path = tmp_path / "model.joblib"
    results_dir = tmp_path / "results"

    summary = train(
        data_dir=REPO_ROOT / "data",
        model_path=model_path,
        results_dir=results_dir,
    )

    assert model_path.exists()
    assert (results_dir / "classification_report.txt").exists()
    assert (results_dir / "confusion_matrix.png").exists()
    assert summary["cv_accuracy"] >= ACCURACY_FLOOR
    assert summary["held_out_test_accuracy"] >= ACCURACY_FLOOR
    assert summary["n_classes"] == 9


def test_predictor_predicts_a_known_clip(tmp_path):
    model_path = tmp_path / "model.joblib"
    train(data_dir=REPO_ROOT / "data", model_path=model_path, results_dir=tmp_path / "results")

    predictor = Predictor(model_path)
    result = predictor.predict(REPO_ROOT / "data" / "clips" / "bak_main_01.wav")

    assert result["note"] == "bak"
    assert result["hand_role"] == "main"
    assert result["label"] == "bak_main"
    assert 0.0 <= result["confidence"] <= 1.0
