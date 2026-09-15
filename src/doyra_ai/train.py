"""Training pipeline for the Phase A note classifier.

Methodology:
  1. Split off a held-out test set (stratified) that is never used for
     model selection.
  2. Compare candidate models via 5-fold stratified CV on the training
     split only, to pick a model family.
  3. Fit the chosen model on the training split and evaluate once on
     the held-out test set -- this is the honest accuracy estimate.
  4. Refit the chosen model on the FULL dataset (train + test) to
     produce the model that actually gets saved/deployed, since the
     dataset is small (~20/class) and every sample helps the final
     classifier. The held-out test accuracy from step 3 is what you
     should trust as an estimate of its real-world performance.
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

import joblib
import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
from sklearn.calibration import CalibratedClassifierCV
from sklearn.ensemble import RandomForestClassifier
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import accuracy_score, classification_report, confusion_matrix
from sklearn.model_selection import StratifiedKFold, StratifiedShuffleSplit, cross_val_predict
from sklearn.neighbors import KNeighborsClassifier
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler
from sklearn.svm import SVC

from .dataset import load_dataset
from .paths import DEFAULT_DATA_DIR, DEFAULT_MODEL_PATH, DEFAULT_RESULTS_DIR

CANDIDATES = {
    "logreg": lambda: Pipeline([
        ("scale", StandardScaler()),
        ("clf", LogisticRegression(max_iter=2000, C=1.0)),
    ]),
    "svm_rbf": lambda: Pipeline([
        ("scale", StandardScaler()),
        ("clf", CalibratedClassifierCV(SVC(kernel="rbf", C=5, gamma="scale"), ensemble=False)),
    ]),
    "random_forest": lambda: Pipeline([
        ("clf", RandomForestClassifier(n_estimators=300, max_depth=8, random_state=0)),
    ]),
    "knn": lambda: Pipeline([
        ("scale", StandardScaler()),
        ("clf", KNeighborsClassifier(n_neighbors=7, weights="distance")),
    ]),
}


def train(
    data_dir: Path = DEFAULT_DATA_DIR,
    model_path: Path = DEFAULT_MODEL_PATH,
    results_dir: Path = DEFAULT_RESULTS_DIR,
    test_size: float = 0.2,
    random_state: int = 0,
) -> dict:
    data_dir = Path(data_dir)
    model_path = Path(model_path)
    results_dir = Path(results_dir)

    ds = load_dataset(data_dir)
    X, y = ds.X, ds.y
    labels = sorted(set(y))

    splitter = StratifiedShuffleSplit(n_splits=1, test_size=test_size, random_state=random_state)
    train_idx, test_idx = next(splitter.split(X, y))
    X_train, X_test = X[train_idx], X[test_idx]
    y_train, y_test = y[train_idx], y[test_idx]

    skf = StratifiedKFold(n_splits=5, shuffle=True, random_state=random_state)
    cv_accuracy = {}
    for name, make_pipe in CANDIDATES.items():
        preds = cross_val_predict(make_pipe(), X_train, y_train, cv=skf)
        cv_accuracy[name] = float(accuracy_score(y_train, preds))

    best_name = max(cv_accuracy, key=cv_accuracy.get)

    test_model = CANDIDATES[best_name]()
    test_model.fit(X_train, y_train)
    test_preds = test_model.predict(X_test)
    test_accuracy = float(accuracy_score(y_test, test_preds))
    report = classification_report(y_test, test_preds, labels=labels, zero_division=0)
    cm = confusion_matrix(y_test, test_preds, labels=labels)

    final_model = CANDIDATES[best_name]()
    final_model.fit(X, y)

    model_path.parent.mkdir(parents=True, exist_ok=True)
    joblib.dump(
        {
            "model": final_model,
            "feature_names": ds.feature_names,
            "classes": labels,
            "best_model_name": best_name,
        },
        model_path,
    )

    results_dir.mkdir(parents=True, exist_ok=True)

    with open(results_dir / "classification_report.txt", "w", encoding="utf-8") as f:
        f.write(f"Best model (selected via 5-fold CV on training split): {best_name}\n")
        f.write(f"5-fold CV accuracy (train split): {cv_accuracy[best_name]:.3f}\n")
        f.write(f"Held-out test accuracy: {test_accuracy:.3f}\n\n")
        f.write("CV accuracy by candidate model (train split):\n")
        for name, acc in cv_accuracy.items():
            f.write(f"  {name}: {acc:.3f}\n")
        f.write("\nHeld-out test set classification report:\n\n")
        f.write(report)

    fig, ax = plt.subplots(figsize=(8, 7))
    ax.imshow(cm, cmap="YlGnBu")
    ax.set_xticks(range(len(labels)))
    ax.set_xticklabels(labels, rotation=45, ha="right", fontsize=8)
    ax.set_yticks(range(len(labels)))
    ax.set_yticklabels(labels, fontsize=8)
    for i in range(len(labels)):
        for j in range(len(labels)):
            ax.text(
                j, i, cm[i, j], ha="center", va="center", fontsize=7,
                color="white" if cm[i, j] > cm.max() / 2 else "black",
            )
    ax.set_title(f"Confusion matrix — {best_name} (held-out test, acc={test_accuracy:.2f})")
    plt.tight_layout()
    plt.savefig(results_dir / "confusion_matrix.png", dpi=120)
    plt.close(fig)

    summary = {
        "best_model_name": best_name,
        "cv_accuracy": cv_accuracy[best_name],
        "cv_accuracy_by_model": cv_accuracy,
        "held_out_test_accuracy": test_accuracy,
        "n_train": int(len(X_train)),
        "n_test": int(len(X_test)),
        "n_total": int(len(X)),
        "n_classes": len(labels),
        "model_path": str(model_path),
        "results_dir": str(results_dir),
    }
    with open(results_dir / "summary.json", "w", encoding="utf-8") as f:
        json.dump(summary, f, indent=2)

    return summary


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(description="Train the Doyra AI Phase A note classifier.")
    parser.add_argument("--data-dir", type=Path, default=DEFAULT_DATA_DIR)
    parser.add_argument("--model-path", type=Path, default=DEFAULT_MODEL_PATH)
    parser.add_argument("--results-dir", type=Path, default=DEFAULT_RESULTS_DIR)
    parser.add_argument("--test-size", type=float, default=0.2)
    parser.add_argument("--random-state", type=int, default=0)
    args = parser.parse_args(argv)

    summary = train(
        data_dir=args.data_dir,
        model_path=args.model_path,
        results_dir=args.results_dir,
        test_size=args.test_size,
        random_state=args.random_state,
    )
    print(json.dumps(summary, indent=2))


if __name__ == "__main__":
    main()
