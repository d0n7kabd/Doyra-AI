import sys, numpy as np, joblib, pickle
from align import detect
from feat import featvec
from prep import load, SR, feats
clf=joblib.load('pkg/doyra_v2/stroke_classifier_v2.joblib')
AB={'kichik_bum_main':'B','kichik_bak_main':'k','bak_secondary':'S','bak_main':'K','bum_main':'M','bum_secondary':'m','kichik_bum_secondary':'b','kichik_bak_secondary':'s','noxun_secondary':'n'}
out={}
for name in sys.argv[1:]:
    d=detect(f'free/{name}.wav'); t=d['t']
    pr=clf.predict(d['X']); pp=clf.predict_proba(d['X'])
    sym=np.array([AB[c] for c in pr]); g=np.diff(t); med=np.median(g)
    d.update(sym=sym,pp=pp,cls=list(clf.classes_)); out[name]=d
    s=''
    for i,c in enumerate(sym):
        s+=c
        if i<len(g) and g[i]>1.8*med: s+=' | '
    from collections import Counter
    print(f"== {name}: strokes={len(t)} median gap={med*1000:.0f}ms (~{60/med:.0f}/min) conf={pp.max(1).mean():.2f} {dict(Counter(sym).most_common())}")
    print(s[:900]); print()
pickle.dump(out,open('free/free.pkl','wb'))
