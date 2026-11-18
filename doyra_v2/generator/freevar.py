import pickle, numpy as np
from align import viterbi, PAT, CL
F=pickle.load(open('free/free.pkl','rb'))
def p3(d):
    cls=d['cls']; pp=d['pp']
    B=sum(pp[:,cls.index(c)] for c in cls if 'bum' in c)
    k=sum(pp[:,cls.index(c)] for c in ['kichik_bak_main','bak_main'])
    S=sum(pp[:,cls.index(c)] for c in ['bak_secondary','kichik_bak_secondary','noxun_secondary'])
    P=np.stack([B,k,S],1)+1e-3; return P/P.sum(1,keepdims=True)
res={}
for name in ['U1_free','U2_free','U3_free','U4_free','U5_free']:
    d=F[name]; u=int(name[1]); P=p3(d); lp=np.log(P)
    path,ok=viterbi(lp,PAT[u],d['t'])
    lab=np.array([PAT[u][j] for j in path]); ac=np.array([CL[i] for i in P.argmax(1)])
    fam=lambda a: np.where(a=='B','o','x')
    fit=np.array(ok)&(fam(lab)==fam(ac))
    # in-pattern stretches: runs of >= one cycle of fitting strokes
    L=len(PAT[u]); inpat=np.zeros(len(fit),bool); i=0
    while i<len(fit):
        if fit[i]:
            j=i
            while j<len(fit) and fit[j]: j+=1
            if j-i>=L: inpat[i:j]=True
            i=j
        else: i+=1
    t=d['t']; g=np.diff(t,append=t[-1]+np.median(np.diff(t)))
    var=~inpat
    # density: strokes per second inside vs outside the pattern
    def rate(mask):
        segs=[];i=0
        while i<len(mask):
            if mask[i]:
                j=i
                while j<len(mask) and mask[j]: j+=1
                if j-i>=3: segs.append((t[i],t[j-1],j-i))
                i=j
            else: i+=1
        dur=sum(b-a for a,b,n in segs); n=sum(n for a,b,n in segs); return n/dur if dur>0 else np.nan, len(segs)
    r_in,n_in=rate(inpat); r_var,n_var=rate(var)
    sec_share_in=np.mean(ac[inpat]=='S') if inpat.any() else np.nan; sec_share_var=np.mean(ac[var]=='S')
    res[name]=dict(n=len(t),inpat=float(inpat.mean()),rate_in=r_in,rate_var=r_var,var_segments=n_var,S_in=sec_share_in,S_var=sec_share_var)
    d.update(lab=lab,pos=np.array(path),inpat=inpat,ac=ac,P=P)
    print(f"{name}: strokes {len(t)}, in base pattern {inpat.mean():.0%}, variation stretches {n_var}; strokes/s pattern {r_in:.1f} vs variation {r_var:.1f}; secondary-hand share pattern {sec_share_in:.0%} vs variation {sec_share_var:.0%}")
pickle.dump(F,open('free/free.pkl','wb'))
