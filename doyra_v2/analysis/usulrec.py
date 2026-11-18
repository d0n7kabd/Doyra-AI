import pickle, numpy as np, json
from align import *
from prep import feats
takes=pickle.load(open('takes.pkl','rb')); probs=pickle.load(open('louo_probs.pkl','rb'))
MAP={'B':'kichik_bum_main','k':'kichik_bak_main','S':'bak_secondary'}
def vscore(lp,pat,t):
    L=len(pat); N=len(lp); ci=[CL.index(c) for c in pat]
    g=np.diff(t); med=np.median(g)
    D=np.array([lp[0,ci[j]] for j in range(L)])
    for n in range(1,N):
        pause=g[n-1]>1.8*med; nd=np.empty(L)
        best=D.max()
        for j in range(L):
            nd[j]=max(D[(j-1)%L],D[(j-2)%L]-4,D[j]-5,best-(2 if pause else 8))+lp[n,ci[j]]
        D=nd
    return D.max()
W=int(__import__('sys').argv[1]) if len(__import__('sys').argv)>1 else 20
res={'new':[], 'old':[]}; conf=np.zeros((6,6),int)
for n,d in sorted(takes.items()):
    cls,pp=probs[n]; idx=[cls.index(MAP[c]) for c in CL]
    p3=pp[:,idx]+1e-3; p3/=p3.sum(1,keepdims=True); lp=np.log(p3)
    # old method cue: bum if low-freq share > 0.3 -- recompute from audio
    y=load(f'wav/{n}.wav'); st=(d['t']*SR).astype(int); bum=np.array([feats(y,s)['low']>0.3 for s in st])
    for a in range(0,len(lp)-W+1,W):
        sc=[vscore(lp[a:a+W],PAT[u],d['t'][a:a+W]) for u in range(1,7)]
        pred=int(np.argmax(sc))+1; res['new'].append(pred==d['usul']); conf[d['usul']-1,pred-1]+=1
        # old: binary seq vs each pattern collapsed (B vs not-B), best rotation, fewest mismatches
        seq=bum[a:a+W]; best=None
        for u in range(1,7):
            pat=np.array([c=='B' for c in PAT[u]]); L=len(pat)
            mm=min(np.sum(seq!=np.array([pat[(r+i)%L] for i in range(W)])) for r in range(L))
            if best is None or mm<best[0]: best=(mm,u)
        res['old'].append(best[1]==d['usul'])
print(f"window={W} strokes: passages={len(res['new'])}  new={np.sum(res['new'])}/{len(res['new'])} ({np.mean(res['new']):.2f})  old-method={np.sum(res['old'])}/{len(res['old'])} ({np.mean(res['old']):.2f})")
print(conf)
