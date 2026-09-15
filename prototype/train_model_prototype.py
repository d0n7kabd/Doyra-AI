import numpy as np
from scipy.io import wavfile
import os, csv, json
from sklearn.model_selection import StratifiedKFold, cross_val_predict
from sklearn.preprocessing import StandardScaler
from sklearn.pipeline import Pipeline
from sklearn.linear_model import LogisticRegression
from sklearn.ensemble import RandomForestClassifier
from sklearn.svm import SVC
from sklearn.neighbors import KNeighborsClassifier
from sklearn.metrics import accuracy_score, classification_report, confusion_matrix
import matplotlib.pyplot as plt

PHASEA_DIR = "/home/claude/doyra-dataset"
PHASEB_AUDIO_DIR = "/home/claude/usul-audio"
OUT_DIR = "/home/claude/model-results"
os.makedirs(OUT_DIR, exist_ok=True)

# ============================= feature extraction =============================
def extract_features(data, sr, onset_sample=0, window_sec=0.5):
    end = min(onset_sample + int(sr*window_sec), len(data))
    seg = data[onset_sample:end].astype(np.float64)
    if len(seg) < 20:
        return None
    seg = seg / 32768.0

    rms = float(np.sqrt(np.mean(seg**2)))
    peak = float(np.max(np.abs(seg)))
    peak_idx = int(np.argmax(np.abs(seg)))
    attack_ms = (peak_idx / sr) * 1000

    thresh = 0.25 * peak if peak > 0 else 0
    decay_idx = len(seg) - 1
    for i in range(peak_idx, len(seg)):
        if abs(seg[i]) < thresh:
            decay_idx = i
            break
    decay_ms = ((decay_idx - peak_idx) / sr) * 1000

    zcr = float(np.mean(np.abs(np.diff(np.sign(seg)))) / 2)

    tail = seg[peak_idx:]
    if len(tail) > 64:
        win = np.hanning(len(tail))
        spec = np.abs(np.fft.rfft(tail * win))
        freqs = np.fft.rfftfreq(len(tail), d=1/sr)
        mag_sum = np.sum(spec) + 1e-9
        centroid = float(np.sum(freqs*spec) / mag_sum)
        bandwidth = float(np.sqrt(np.sum(((freqs-centroid)**2)*spec) / mag_sum))
        cum = np.cumsum(spec)
        rolloff_idx = np.searchsorted(cum, 0.85*cum[-1])
        rolloff = float(freqs[min(rolloff_idx, len(freqs)-1)])
        low = float(np.sum(spec[(freqs>=0)&(freqs<500)]) / mag_sum)
        mid = float(np.sum(spec[(freqs>=500)&(freqs<2000)]) / mag_sum)
        high = float(np.sum(spec[freqs>=2000]) / mag_sum)
    else:
        centroid=bandwidth=rolloff=low=mid=high=0.0

    return {
        "rms": rms, "peak": peak, "attack_ms": attack_ms, "decay_ms": decay_ms,
        "zcr": zcr, "centroid": centroid, "bandwidth": bandwidth, "rolloff": rolloff,
        "low_e": low, "mid_e": mid, "high_e": high,
    }

FEATURE_KEYS = ["rms","peak","attack_ms","decay_ms","zcr","centroid","bandwidth","rolloff","low_e","mid_e","high_e"]

# ============================= load Phase A =============================
with open(os.path.join(PHASEA_DIR, "metadata.csv")) as f:
    phaseA_rows = list(csv.DictReader(f))

X, y = [], []
for row in phaseA_rows:
    clip_path = os.path.join(PHASEA_DIR, row["clip_path"])
    sr, data = wavfile.read(clip_path)
    if data.ndim > 1:
        data = data[:, 0]
    feats = extract_features(data, sr)
    if feats is None:
        continue
    X.append([feats[k] for k in FEATURE_KEYS])
    y.append(f"{row['note']}_{row['hand_role']}")

X = np.array(X)
y = np.array(y)
print(f"Loaded {len(X)} Phase A samples, {len(set(y))} classes")

# ============================= model comparison via cross-validation =============================
candidates = {
    "logreg": Pipeline([("scale", StandardScaler()), ("clf", LogisticRegression(max_iter=2000, C=1.0))]),
    "svm_rbf": Pipeline([("scale", StandardScaler()), ("clf", SVC(kernel="rbf", C=5, gamma="scale", probability=True))]),
    "random_forest": Pipeline([("clf", RandomForestClassifier(n_estimators=300, max_depth=8, random_state=0))]),
    "knn": Pipeline([("scale", StandardScaler()), ("clf", KNeighborsClassifier(n_neighbors=7, weights="distance"))]),
}

skf = StratifiedKFold(n_splits=5, shuffle=True, random_state=0)
results = {}
for name, pipe in candidates.items():
    preds = cross_val_predict(pipe, X, y, cv=skf)
    acc = accuracy_score(y, preds)
    results[name] = {"acc": acc, "preds": preds}
    print(f"{name:16s} 5-fold CV accuracy: {acc:.3f}")

best_name = max(results, key=lambda k: results[k]["acc"])
best_preds = results[best_name]["preds"]
print(f"\nBest model: {best_name} ({results[best_name]['acc']:.3f} accuracy)")

report = classification_report(y, best_preds, zero_division=0)
print("\n" + report)
with open(os.path.join(OUT_DIR, "classification_report.txt"), "w") as f:
    f.write(f"Best model: {best_name}\nAccuracy: {results[best_name]['acc']:.3f}\n\n")
    for name in results:
        f.write(f"{name}: {results[name]['acc']:.3f}\n")
    f.write("\n" + report)

# confusion matrix plot
labels = sorted(set(y))
cm = confusion_matrix(y, best_preds, labels=labels)
fig, ax = plt.subplots(figsize=(8,7))
im = ax.imshow(cm, cmap="YlGnBu")
ax.set_xticks(range(len(labels))); ax.set_xticklabels(labels, rotation=45, ha="right", fontsize=8)
ax.set_yticks(range(len(labels))); ax.set_yticklabels(labels, fontsize=8)
for i in range(len(labels)):
    for j in range(len(labels)):
        ax.text(j, i, cm[i,j], ha="center", va="center", fontsize=7,
                 color="white" if cm[i,j] > cm.max()/2 else "black")
ax.set_title(f"Confusion matrix — {best_name} (5-fold CV, acc={results[best_name]['acc']:.2f})")
plt.tight_layout()
plt.savefig(os.path.join(OUT_DIR, "confusion_matrix.png"), dpi=120)
plt.close()

# ============================= train final model on all Phase A data =============================
final_model = candidates[best_name]
final_model.fit(X, y)

# ============================= onset detection for Phase B =============================
def detect_onsets(sig, sr, min_gap_sec=0.15, thresh_ratio=0.10, release_ratio=0.35):
    sig = sig.astype(np.float64)
    sig = sig / (np.max(np.abs(sig)) + 1e-9)
    win = int(sr * 0.004)
    env = np.abs(sig)
    kernel = np.ones(win) / win
    env_smooth = np.convolve(env, kernel, mode='same')
    thresh = thresh_ratio * np.max(env_smooth)
    release_thresh = release_ratio * thresh
    min_gap = int(sr * min_gap_sec)
    onsets = []
    state = "below"
    last_onset = -min_gap
    for i in range(len(env_smooth)):
        v = env_smooth[i]
        if state in ("below", "released") and v > thresh:
            if i - last_onset > min_gap:
                onsets.append(i)
                last_onset = i
            state = "above"
        elif state == "above" and v < release_thresh:
            state = "released"
    return onsets

# ============================= apply to Phase B usul phrases =============================
usul_files = sorted([f for f in os.listdir(PHASEB_AUDIO_DIR) if f.startswith("Usul_") and f.endswith("_normal.wav")])
transcriptions = {}
for fname in usul_files:
    name = fname.replace(".wav", "")
    sr, data = wavfile.read(os.path.join(PHASEB_AUDIO_DIR, fname))
    if data.ndim > 1:
        data = data[:, 0]
    onsets = detect_onsets(data, sr)

    seq = []
    for onset in onsets:
        feats = extract_features(data, sr, onset, window_sec=0.3)
        if feats is None:
            continue
        vec = np.array([[feats[k] for k in FEATURE_KEYS]])
        pred = final_model.predict(vec)[0]
        if hasattr(final_model, "predict_proba"):
            proba = final_model.predict_proba(vec)[0]
            conf = float(np.max(proba))
        else:
            conf = None
        seq.append({"time_sec": round(onset/sr,3), "pred": pred, "confidence": round(conf,2) if conf else None})

    transcriptions[name] = seq

with open(os.path.join(OUT_DIR, "phaseB_transcriptions.json"), "w") as f:
    json.dump(transcriptions, f, indent=2)

print("\n=== Phase B auto-transcriptions (best model:", best_name, ") ===")
for name, seq in transcriptions.items():
    conf_vals = [s["confidence"] for s in seq if s["confidence"] is not None]
    mean_conf = np.mean(conf_vals) if conf_vals else None
    print(f"\n{name} | {len(seq)} hits | mean confidence: {mean_conf:.2f}" if mean_conf else f"\n{name} | {len(seq)} hits")
    print("  " + " → ".join(f"{s['pred']}({s['confidence']})" for s in seq))
