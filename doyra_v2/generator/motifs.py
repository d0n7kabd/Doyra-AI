import pickle, numpy as np
from collections import Counter
F=pickle.load(open('free/free.pkl','rb'))
def canon(p):  # rotation-invariant key
    return min(p[i:]+p[:i] for i in range(len(p)))
for name in ['U1_free','U2_free','U3_free','U4_free','U5_free','Rez']:
    d=F[name]; t=d['t']
    ac=d.get('ac')
    if ac is None:
        cls=d['cls']; pp=d['pp']
        B=sum(pp[:,cls.index(c)] for c in cls if 'bum' in c); k=sum(pp[:,cls.index(c)] for c in ['kichik_bak_main','bak_main']); S=sum(pp[:,cls.index(c)] for c in ['bak_secondary','kichik_bak_secondary','noxun_secondary'])
        ac=np.array(['B','k','S'])[np.stack([B,k,S],1).argmax(1)]; d['ac']=ac
    seq=''.join(ac); g=np.diff(t); med=np.median(g)
    # break at long pauses
    cuts=[0]+[i+1 for i in np.where(g>2.5*med)[0]]+[len(seq)]
    cnt=Counter(); cover=np.zeros(len(seq),bool)
    for a,b in zip(cuts[:-1],cuts[1:]):
        s=seq[a:b]
        for L in range(3,13):
            i=0
            while i+2*L<=len(s):
                if s[i:i+L]==s[i+L:i+2*L] and len(set(s[i:i+L]))>1:
                    j=i+L
                    while j+L<=len(s) and s[j:j+L]==s[i:i+L]: j+=L
                    reps=(j-i)//L
                    cnt[(L,canon(s[i:i+L]))]+=reps; cover[a+i:a+j]=True; i=j
                else: i+=1
    print(f"== {name}: strokes {len(seq)}, in repeating loops {cover.mean():.0%}")
    for (L,p),c in cnt.most_common(6): print(f"   {p:12s} (len {L}) repeated {c}x")
pickle.dump(F,open('free/free.pkl','wb'))
