import numpy as np, librosa, json, glob, sys
from pathlib import Path
SR=44100
def load(p):
    y,_=librosa.load(p,sr=SR,mono=True); return y/(np.abs(y).max()+1e-9)
def onsets(y,hop=128):
    env=librosa.onset.onset_strength(y=y,sr=SR,hop_length=hop)
    fr=librosa.onset.onset_detect(onset_envelope=env,sr=SR,hop_length=hop,backtrack=True,wait=int(0.05*SR/hop),delta=0.05)
    st=librosa.frames_to_samples(fr,hop_length=hop)
    a=np.abs(y); w=int(0.04*SR)
    pk=np.array([s+int(np.argmax(a[s:s+w])) for s in st])
    amp=a[pk]
    return st,pk,amp
def feats(y,s,n=0.05):
    seg=y[s:s+int(n*SR)]
    S=np.abs(np.fft.rfft(seg*np.hanning(len(seg))))**2; f=np.fft.rfftfreq(len(seg),1/SR)
    tot=S.sum()+1e-12
    return dict(low=float(S[f<250].sum()/tot), cent=float((S*f).sum()/tot))
if __name__=="__main__":
    for p in sorted(glob.glob('wav/*.wav')):
        y=load(p); st,pk,amp=onsets(y)
        # rms envelope to find speech intro: report first 10 s onset times
        t=st/SR
        keep=amp>0.1
        t=t[keep]; ioi=np.diff(t)
        lows=np.array([feats(y,s)['low'] for s in st[keep]])
        print(f"{Path(p).stem:10s} n={len(t):4d} first={t[:6].round(2)} medIOI={np.median(ioi)*1000:6.0f}ms  bumshare={np.mean(lows>0.3):.2f}  bigGaps>3x={np.sum(ioi>3*np.median(ioi))}")
