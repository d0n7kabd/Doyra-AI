"""Cycle-level generator: whole usul cycles cut from the player's own free playing, kept intact,
re-ordered with (1) a junction rule learned from real playing, (2) the loudness contour of a real phrase,
(3) long joins placed just before a cycle downbeat."""
import numpy as np, librosa, soundfile as sf, subprocess
from collections import defaultdict
from pathlib import Path
from beatgen import beats_of
from gen import F
SR=44100; PER={'U2_free':4,'U3_free':4,'U4_free':5}
def cycles_of(name):
    y,units=beats_of(name); t=F[name]['t']; amp=F[name]['amp']; ac=F[name]['ac']; P=PER[name]
    score=np.zeros(P)
    for i,u in enumerate(units):
        m=(t>=u['a'])&(t<u['b'])
        if m.any(): score[i%P]+=amp[m][0]*(1.5 if ac[m][0]=='B' else 1)
    ph=int(np.argmax(score))
    cyc=[]
    for k in range(ph,len(units)-P,P):
        grp=units[k:k+P]
        if any(abs(grp[j+1]['a']-grp[j]['b'])>1e-3 for j in range(P-1)): continue   # not contiguous (pause inside)
        a,b=grp[0]['a'],grp[-1]['b']; m=(t>=a)&(t<b)
        cyc.append(dict(a=a,b=b,first=grp[0]['typ'],last=grp[-1]['typ'],loud=float(np.sqrt(np.mean(y[int(a*SR):int(b*SR)]**2))),
                        idx=k))
    return y,cyc
def generate(cyc,n,rng,contour):
    # junction plausibility: which (last beat type -> first beat type) pairs happen in real playing
    seen=defaultdict(int)
    for c1,c2 in zip(cyc[:-1],cyc[1:]):
        if c2['idx']==c1['idx']+PER_CUR: seen[(c1['last'],c2['first'])]+=1
    seq=[int(rng.integers(len(cyc)))]
    for k in range(1,n):
        prev=cyc[seq[-1]]; target=contour[k%len(contour)]
        def cost(j):
            c=cyc[j]; jc=0 if seen.get((prev['last'],c['first'])) else 1.5
            lc=abs(np.log(c['loud']/target))*3
            rep=3 if j in seq[-6:] else 0
            nat=0.8 if j==seq[-1]+1 else 0   # discourage just copying the original continuation
            return jc+lc+rep+nat+rng.gumbel()*0.4
        seq.append(min(range(len(cyc)),key=cost))
    return seq
def render(y,cyc,seq):
    xf=int(0.03*SR); out=None
    for j in seq:
        c=cyc[j]; seg=y[int(c['a']*SR):int(c['b']*SR)+xf].copy()
        if out is None: out=seg; continue
        out[-xf:]=out[-xf:]*np.linspace(1,0,xf)+seg[:xf]*np.linspace(0,1,xf); out=np.concatenate([out,seg[xf:]])
    return 0.9*out/np.abs(out).max()
def save(s,path,dur):
    s=s[:int(dur*SR)].copy(); fl=int(0.8*SR); s[-fl:]*=np.linspace(1,0,fl)
    sf.write('tmp.wav',s,SR); subprocess.run(['ffmpeg','-v','error','-y','-i','tmp.wav','-c:a','aac','-b:a','160k',path],check=True)
if __name__=='__main__':
    rng=np.random.default_rng(11); outdir=Path('/mnt/user-data/outputs/variation_test')
    for f in outdir.glob('*'): f.unlink()
    key={}; stats={}
    for name,order in [('U2_free',[1,0]),('U3_free',[0,1]),('U4_free',[1,0])]:
        PER_CUR=PER[name]; globals()['PER_CUR']=PER_CUR
        y,cyc=cycles_of(name); half=len(cyc)//2; tr,te=cyc[:half],cyc[half:]
        contour=[c['loud'] for c in te[:20]]          # follow the loudness shape of a real phrase
        seq=generate(tr,14,rng,contour)
        stats[name]=dict(cycles=len(cyc),train=len(tr),new_joins=round(float(np.mean([b!=a+1 for a,b in zip(seq[:-1],seq[1:])])),2))
        gen=render(y,tr,seq)
        a=te[0]['a']; real=y[int(a*SR):int((a+21)*SR)]; real=0.9*real/np.abs(real).max()
        clips=[('real',real),('computer',gen)]
        for k,o in enumerate(order):
            fn=f"{name[:2]}_clip_{'AB'[k]}.m4a"; save(clips[o][1],str(outdir/fn),20); key[fn]=clips[o][0]
    open('/mnt/user-data/outputs/variation_test_ANSWER_KEY_open_after_test.txt','w').write('\n'.join(f"{a}: {b}" for a,b in key.items())+'\n')
    print(stats); print(key)
