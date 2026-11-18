import pickle, numpy as np
from collections import Counter
from gen import tokens, NGram, F
from align import PAT
def grams(s,n): return Counter(s[i:i+n] for i in range(len(s)-n+1))
def js(a,b):
    keys=set(a)|set(b); p=np.array([a[k] for k in keys],float); q=np.array([b[k] for k in keys],float)
    p/=p.sum(); q/=q.sum(); m=(p+q)/2
    kl=lambda x,y: np.sum(x[x>0]*np.log2(x[x>0]/y[x>0])); return 0.5*kl(p,m)+0.5*kl(q,m)
def novelty(s,train,n=8):
    g=[s[i:i+n] for i in range(len(s)-n+1)]; return np.mean([x not in train for x in g])
rng=np.random.default_rng(1); rows=[]
for name in ['U1_free','U2_free','U3_free','U4_free','U5_free']:
    phrases,med=tokens(F[name]); half=len(phrases)//2
    tr,te=phrases[:half],phrases[half:]
    trs=''.join(a for p in tr for a,_ in p); tes=''.join(a for p in te for a,_ in p)
    r={'usul':name[:2],'real_JS':js(grams(trs,3),grams(tes,3)),'real_novel':novelty(tes,trs)}
    base=(PAT[int(name[1])]*400)[:len(tes)]
    r['taught_JS']=js(grams(base,3),grams(tes,3)); r['taught_novel']=novelty(base,trs)
    for n in (1,3,5):
        J=[];N=[]
        for k in range(10):
            g=''.join(a for a,_ in NGram(n+1).fit(tr).sample(len(tes),rng)); J.append(js(grams(g,3),grams(tes,3))); N.append(novelty(g,trs))
        r[f'o{n}_JS']=np.mean(J); r[f'o{n}_novel']=np.mean(N)
    rows.append(r)
    print(r['usul'], ' '.join(f"{k}={v:.2f}" for k,v in r.items() if k!='usul'))
avg=lambda k: np.mean([r[k] for r in rows])
print('AVG', ' '.join(f"{k}={avg(k):.2f}" for k in rows[0] if k!='usul'))
