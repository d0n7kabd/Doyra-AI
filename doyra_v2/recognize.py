"""Doyra AI v2 - recognize doira strokes and the usul in a recording.

Usage:  python recognize.py RECORDING.(wav|m4a) [--out strokes.csv]
Prints the most likely usul and writes every detected stroke with its predicted name.
Model: random forest trained on 197 isolated strokes + 2,587 strokes from phrases (Nov 2026 session).
"""
import argparse, csv, sys
from pathlib import Path
import numpy as np, librosa, joblib

SR = 44100
PAT = {1: "kBkkSBkSkSBkkSB", 2: "Bkk" * 4, 3: "kkSBkkSkkSBkkSB", 4: "BkkBk", 5: "BkkkBkk", 6: "kSkSkSk"}
CL = ['B', 'k', 'S']
MAP = {'B': 'kichik_bum_main', 'k': 'kichik_bak_main', 'S': 'bak_secondary'}

def load(p):
    y, _ = librosa.load(p, sr=SR, mono=True)
    return y / (np.abs(y).max() + 1e-9)

def featvec(y, s, n=0.06):
    seg = y[s:s + int(n * SR)]
    if len(seg) < int(n * SR): seg = np.pad(seg, (0, int(n * SR) - len(seg)))
    S = np.abs(np.fft.rfft(seg * np.hanning(len(seg)))) ** 2; f = np.fft.rfftfreq(len(seg), 1 / SR)
    tot = S.sum() + 1e-12
    bands = [0, 150, 250, 500, 1000, 2000, 4000, 8000, 22050]
    bshare = [S[(f >= a) & (f < b)].sum() / tot for a, b in zip(bands[:-1], bands[1:])]
    cent = (S * f).sum() / tot
    mf = librosa.feature.mfcc(y=seg, sr=SR, n_mfcc=13, n_fft=1024, hop_length=256)
    e1 = np.sum(seg[:len(seg) // 2] ** 2) + 1e-12; e2 = np.sum(seg[len(seg) // 2:] ** 2) + 1e-12
    return np.concatenate([np.log(np.array(bshare) + 1e-6), [np.log(cent), np.log(e2 / e1)], mf.mean(1), mf.std(1)])

def detect(y, thr=0.03, hop=128):
    env = librosa.onset.onset_strength(y=y, sr=SR, hop_length=hop)
    fr = librosa.onset.onset_detect(onset_envelope=env, sr=SR, hop_length=hop, backtrack=True,
                                    wait=int(0.05 * SR / hop), delta=0.05)
    st = librosa.frames_to_samples(fr, hop_length=hop); a = np.abs(y); w = int(0.04 * SR)
    amp = np.array([a[s:s + w].max() for s in st]); k = amp > thr; st, amp = st[k], amp[k]
    keep = list(range(len(st)))
    while len(keep) > 2:
        g = np.diff(st[keep] / SR); med = np.median(g)
        bad = np.where((g < 0.07) | (g < 0.35 * med))[0]
        if not len(bad): break
        i = bad[0]; p, q = keep[i], keep[i + 1]; keep.remove(p if amp[p] < amp[q] else q)
    return st[keep]

def usul_score(lp, pat, t):
    L = len(pat); ci = [CL.index(c) for c in pat]; g = np.diff(t); med = np.median(g)
    D = np.array([lp[0, ci[j]] for j in range(L)])
    for n in range(1, len(lp)):
        pause = g[n - 1] > 1.8 * med; best = D.max(); nd = np.empty(L)
        for j in range(L):
            nd[j] = max(D[(j - 1) % L], D[(j - 2) % L] - 4, D[j] - 5, best - (6 if pause else 12)) + lp[n, ci[j]]
        D = nd
    return D.max()

def main():
    ap = argparse.ArgumentParser(); ap.add_argument("audio"); ap.add_argument("--out", default="strokes.csv")
    a = ap.parse_args()
    clf = joblib.load(Path(__file__).parent / "stroke_classifier_v2.joblib")
    y = load(a.audio); st = detect(y); t = st / SR
    X = np.array([featvec(y, s) for s in st])
    pred = clf.predict(X); pp = clf.predict_proba(X); cls = list(clf.classes_)
    p3 = pp[:, [cls.index(MAP[c]) for c in CL]] + 1e-3; p3 /= p3.sum(1, keepdims=True); lp = np.log(p3)
    scores = {u: usul_score(lp, PAT[u], t) for u in PAT}
    best = max(scores, key=scores.get)
    with open(a.out, "w", newline="") as f:
        w = csv.writer(f); w.writerow(["time_s", "stroke", "confidence"])
        for ti, p, row in zip(t, pred, pp): w.writerow([round(float(ti), 3), p, round(float(row.max()), 2)])
    print(f"{len(t)} strokes detected. Most likely usul: Usul {best}")
    print("scores (higher = better):", {u: round(float(s), 1) for u, s in sorted(scores.items())})

if __name__ == "__main__":
    main()
