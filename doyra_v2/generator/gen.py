import pickle, numpy as np, json
from collections import defaultdict, Counter
from align import PAT, CL
F=pickle.load(open('free/free.pkl','rb'))
BINS=np.array([0.5,0.75,1.0,1.5,2.0])
def tokens(d):
    t=d['t']; ac=d['ac']; g=np.diff(t); med=np.median(g)
    gb=[int(np.argmin(np.abs(BINS-x/med))) for x in g]
    toks=[(a,b) for a,b in zip(ac[:-1],gb)]
    # split phrases at long pauses (>2.5x)
    phrases=[];cur=[]
    for tok,x in zip(toks,g):
        cur.append(tok)
        if x>2.5*med: phrases.append(cur); cur=[]
    if cur: phrases.append(cur)
    return phrases, med
class NGram:
    def __init__(s,n): s.n=n; s.c=[defaultdict(Counter) for _ in range(n)]
    def fit(s,phrases):
        for p in phrases:
            seq=[('<s>',0)]*(s.n-1)+p
            for i in range(s.n-1,len(seq)):
                for k in range(s.n):
                    s.c[k][tuple(seq[i-k:i])][seq[i]]+=1
        return s
    def sample(s,N,rng):
        hist=[('<s>',0)]*(s.n-1); out=[]
        while len(out)<N:
            for k in range(s.n-1,-1,-1):
                ctx=tuple(hist[len(hist)-k:]) if k else ()
                if ctx in s.c[k] and sum(s.c[k][ctx].values())>=2 or k==0:
                    cnt=s.c[k][ctx]; break
            items=list(cnt); p=np.array([cnt[i] for i in items],float); p/=p.sum()
            tok=items[rng.choice(len(items),p=p)]; out.append(tok); hist.append(tok)
        return out
def recog(sym, W=20):
    """usul recognition on a hard symbol sequence (one-hot smoothed)"""
    from usulrec_lib import vscore
    lp=np.log(np.array([[0.8 if c==x else 0.1 for x in CL] for c in sym]))
    t=np.arange(len(sym),dtype=float)  # no pause info -> even spacing
    preds=[]
    for a in range(0,len(sym)-W+1,W):
        sc=[vscore(lp[a:a+W],PAT[u],t[a:a+W]) for u in range(1,7)]; preds.append(int(np.argmax(sc))+1)
    return preds
def longest_copy(gen, train_str):
    # longest substring of gen found verbatim in train, averaged over windows of 20
    L=[]
    for a in range(0,len(gen)-20+1,20):
        w=gen[a:a+20]; best=0
        for i in range(len(w)):
            for j in range(i+best+1,len(w)+1):
                if w[i:j] in train_str: best=j-i
                else: break
        L.append(best)
    return float(np.mean(L))
if __name__=='__main__':
    rng=np.random.default_rng(0); res={}; models={}
    for name in ['U1_free','U2_free','U3_free','U4_free','U5_free']:
        u=int(name[1]); phrases,med=tokens(F[name])
        train=''.join(a for p in phrases for a,_ in p)
        real_rec=recog(train)
        row={'real':np.mean(np.array(real_rec)==u)}
        for n in (1,3,5):
            m=NGram(n+1).fit(phrases)   # order n
            gen=m.sample(len(train),rng); gsym=''.join(a for a,_ in gen)
            rec=recog(gsym)
            row[f'order{n}']=np.mean(np.array(rec)==u); row[f'copy{n}']=longest_copy(gsym,train)
            if n==3: models[name]=(m,med)
        res[name]=row
        print(name, {k:round(float(v),2) for k,v in row.items()})
    pickle.dump(models,open('free/genmodels.pkl','wb'))
