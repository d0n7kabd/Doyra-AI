"""Beat-level variation generator: cuts the player's own free playing into beats on a steady pulse,
learns which kinds of beats follow which (order-2 Markov over beat types), and strings real beats into new orders."""
import numpy as np, librosa, pickle, soundfile as sf, subprocess, json
from collections import defaultdict, Counter
from pathlib import Path
from gen import F
SR=44100
def beats_of(name):
    y,_=librosa.load(f'free/{name}.wav',sr=SR); env=librosa.onset.onset_strength(y=y,sr=SR,hop_length=512)
    _,bt=librosa.beat.beat_track(onset_envelope=env,sr=SR,hop_length=512,units='time',tightness=200)
    t=F[name]['t']; ac=F[name]['ac']; amp=F[name]['amp']
    # cut points: just before the first stroke at/after each beat
    cuts=[]
    for b in bt:
        j=np.searchsorted(t,b-0.04)
        if j<len(t) and t[j]-b<0.12: cuts.append(t[j]-0.012)
    cuts=np.unique(np.round(cuts,4))
    units=[]
    for a,b in zip(cuts[:-1],cuts[1:]):
        if b-a>1.5*np.median(np.diff(cuts)): continue  # skip pauses
        m=(t>=a)&(t<b); 
        lv=np.where(amp[m]>np.median(amp)*1.3,'L','s')
        typ=''.join(x+l for x,l in zip(ac[m],lv)) or '-'
        units.append(dict(a=a,b=b,typ=typ))
    return y,units
def generate(units,n,rng):
    types=[u['typ'] for u in units]
    tr2=defaultdict(Counter); tr1=defaultdict(Counter)
    for i in range(2,len(types)): tr2[(types[i-2],types[i-1])][types[i]]+=1
    for i in range(1,len(types)): tr1[types[i-1]][types[i]]+=1
    inst=defaultdict(list)
    for i,tp in enumerate(types): inst[tp].append(i)
    seq=[int(rng.integers(len(units)-1))]
    while len(seq)<n:
        ctx=(types[seq[-2]],types[seq[-1]]) if len(seq)>1 else None
        cnt=tr2.get(ctx) if ctx in tr2 and sum(tr2[ctx].values())>=2 else tr1.get(types[seq[-1]])
        if not cnt: cnt=Counter(types)
        ks=list(cnt); p=np.array([cnt[k] for k in ks],float); p/=p.sum(); nxt=ks[rng.choice(len(ks),p=p)]
        cands=[i for i in inst[nxt] if i!=seq[-1]+1] or inst[nxt]   # avoid simply continuing the original recording
        seq.append(int(rng.choice(cands)))
    return seq
def render(y,units,seq):
    out=[]; xf=int(0.008*SR)
    for k,i in enumerate(seq):
        u=units[i]; seg=y[int(u['a']*SR):int(u['b']*SR)+xf].copy()
        if out:
            prev=out[-1]; seg[:xf]=seg[:xf]*np.linspace(0,1,xf)+prev[-xf:]*np.linspace(1,0,xf); out[-1]=prev[:-xf]
        out.append(seg)
    s=np.concatenate(out); return 0.9*s/np.abs(s).max()
def save(s,path,dur):
    s=s[:int(dur*SR)]; fl=int(0.8*SR); s[-fl:]*=np.linspace(1,0,fl)
    sf.write('tmp.wav',s,SR); subprocess.run(['ffmpeg','-v','error','-y','-i','tmp.wav','-c:a','aac','-b:a','160k',path],check=True)
if __name__=='__main__':
    rng=np.random.default_rng(3); outdir=Path('/mnt/user-data/outputs/variation_test'); 
    for f in outdir.glob('*'): f.unlink()
    key={}; stats={}
    for name,order in [('U2_free',[0,1]),('U3_free',[1,0]),('U4_free',[0,1])]:
        y,units=beats_of(name); half=len(units)//2; tr=units[:half]
        seq=generate(tr,60,rng)
        new_j=np.mean([b!=a+1 for a,b in zip(seq[:-1],seq[1:])])
        tset=set(tuple(u['typ'] for u in tr[i:i+4]) for i in range(len(tr)-3))
        g4=[tuple(tr[seq[i+k]]['typ'] for k in range(4)) for i in range(len(seq)-3)]
        stats[name]=dict(beats=len(units),new_junctions=round(float(new_j),2),new_4beat_phrases=round(float(np.mean([g not in tset for g in g4])),2))
        gen=render(y,tr,seq)
        # real: original audio from the second half
        a=units[half]['a']; real=y[int(a*SR):int((a+21)*SR)]; real=0.9*real/np.abs(real).max()
        clips=[('real',real),('computer',gen)]
        for k,o in enumerate(order):
            fn=f"{name[:2]}_clip_{'AB'[k]}.m4a"; save(clips[o][1].copy(),str(outdir/fn),20); key[fn]=clips[o][0]
    open('/mnt/user-data/outputs/variation_test_ANSWER_KEY_open_after_test.txt','w').write('\n'.join(f"{a}: {b}" for a,b in key.items())+'\n')
    print(stats); print(key)
