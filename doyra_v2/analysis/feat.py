import numpy as np, librosa, glob
from pathlib import Path
from prep import load, onsets, SR
def featvec(y, s, n=0.06):
    seg = y[s:s+int(n*SR)]
    if len(seg) < int(n*SR): seg = np.pad(seg, (0, int(n*SR)-len(seg)))
    S = np.abs(np.fft.rfft(seg*np.hanning(len(seg))))**2; f = np.fft.rfftfreq(len(seg), 1/SR)
    tot = S.sum()+1e-12
    bands = [0,150,250,500,1000,2000,4000,8000,22050]
    bshare = [S[(f>=a)&(f<b)].sum()/tot for a,b in zip(bands[:-1],bands[1:])]
    cent = (S*f).sum()/tot
    mf = librosa.feature.mfcc(y=seg, sr=SR, n_mfcc=13, n_fft=1024, hop_length=256)
    # decay: energy ratio second half vs first half
    e1 = np.sum(seg[:len(seg)//2]**2)+1e-12; e2 = np.sum(seg[len(seg)//2:]**2)+1e-12
    return np.concatenate([np.log(np.array(bshare)+1e-6), [np.log(cent), np.log(e2/e1)], mf.mean(1), mf.std(1)])
CLS = {'kichik_bum_main':'B','kichik_bak_main':'k','bak_secondary':'S'}
def iso_data():
    X=[];yl=[]
    for p in sorted(glob.glob('repo/data/clips/*.wav')):
        name=Path(p).stem.rsplit('_',1)[0]
        y=load(p); a=np.abs(y); s=max(0,int(np.argmax(a>0.2*a.max()))-int(0.003*SR))
        # normalize segment loudness: features are mostly ratios; mfcc0 depends on level
        X.append(featvec(y,s)); yl.append(name)
    return np.array(X), np.array(yl)
def take_strokes(p, thr=0.1):
    y=load(p); st,pk,amp=onsets(y); k=amp>thr
    st=st[k]; amp=amp[k]
    X=np.array([featvec(y,s) for s in st])
    return y, st/SR, amp, X
