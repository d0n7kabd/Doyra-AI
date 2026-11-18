"""Beat units that KEEP pauses: a beat with no stroke near it becomes a rest unit cut at the beat itself."""
import numpy as np, librosa
from gen import F
SR=44100
def beats_with_rests(name):
    y,_=librosa.load(f'free/{name}.wav',sr=SR); env=librosa.onset.onset_strength(y=y,sr=SR,hop_length=512)
    _,bt=librosa.beat.beat_track(onset_envelope=env,sr=SR,hop_length=512,units='time',tightness=200)
    d=F[name]; t=d['t']; ac=d['ac']; amp=d['amp']; bp=np.median(np.diff(bt))
    cuts=[]
    for b in bt:
        j=np.searchsorted(t,b-0.04)
        cuts.append(t[j]-0.012 if (j<len(t) and t[j]-b<0.12) else b)
    cuts=np.array(sorted(set(np.round(cuts,4))))
    units=[]
    for a,b in zip(cuts[:-1],cuts[1:]):
        if b-a>3*bp: continue       # long silence (end of take), not a musical rest
        m=(t>=a)&(t<b)
        lv=np.where(amp[m]>np.median(amp)*1.3,'L','s')
        typ=''.join(x+l for x,l in zip(ac[m],lv)) or 'rest'
        units.append(dict(a=a,b=b,typ=typ))
    return y,units,bp
if __name__=='__main__':
    for name in ['U2_free','U3_free','U4_free','U5_free','U6_free']:
        y,units,bp=beats_with_rests(name)
        X=[]
        for u in units:
            n=len(u['typ'])//2 if u['typ']!='rest' else 0
            X.append([n, float(u['typ'].startswith('B')), float('L' in u['typ'])])
        X=np.array(X,float); X=(X-X.mean(0))/(X.std(0)+1e-9)
        sc=sorted([(round(float(np.mean([X[i]@X[i+P]/3 for i in range(len(X)-P)])),3),P) for P in range(2,11)],reverse=True)
        print(name,'beat',round(bp*1000),'ms, units',len(units),'rests',sum(u['typ']=='rest' for u in units),'best periods',sc[:4])
