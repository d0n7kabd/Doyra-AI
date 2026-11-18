import pickle, numpy as np
from align import PAT
takes=pickle.load(open('takes.pkl','rb'))
for u in range(1,7):
    pat=PAT[u]; L=len(pat)
    # use the basic cycle unit for repeated patterns
    unit={2:3,3:4}.get(u,L)
    print(f"Usul {u} unit={pat[:unit]}")
    for tmp in ('slow','normal','fast'):
        d=takes[f'U{u}_{tmp}']; t=d['t']; pos=d['pos']; ok=d['ok0']; g=np.diff(t); med=np.median(g)
        acc={j:[] for j in range(unit)}
        # local normalization: divide each gap by median gap of surrounding 2*unit strokes
        for i in range(len(g)):
            if not (ok[i] and ok[i+1]) or (pos[i+1]-pos[i])%L!=1 or g[i]>1.8*med: continue
            lo,hi=max(0,i-unit),min(len(g),i+unit)
            loc=g[lo:hi]; loc=loc[loc<1.8*med]
            acc[pos[i]%unit].append(g[i]/np.mean(loc))
        s=' '.join(f"{pat[j]}->{pat[(j+1)%unit] if unit<L else pat[(j+1)%L]}:{np.mean(v):.2f}(n{len(v)})" if v else f"{j}:-" for j,v in acc.items())
        print(f"  {tmp:6s} gap={med*1000:4.0f}ms  {s}")
