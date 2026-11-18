import pickle, numpy as np, json
from align import *
takes=pickle.load(open('takes.pkl','rb'))
Xi,yi=iso_data()
MAP={'B':'kichik_bum_main','k':'kichik_bak_main','S':'bak_secondary'}
names=sorted(takes)
def evalset(d): return d['ok0']
def acc_parts(pred,true):
    pred=np.array(pred); true=np.array(true)
    exact=np.mean(pred==true)
    fam=lambda s: np.array(['bum' if 'bum' in x else 'bak' for x in s])
    hand=lambda s: np.array([x.split('_')[-1] for x in s])
    size=lambda s: np.array(['kichik' if x.startswith('kichik') else 'full' for x in s])
    return dict(exact=exact, bumbak=np.mean(fam(pred)==fam(true)), hand=np.mean(hand(pred)==hand(true)), size=np.mean(size(pred)==size(true)))
res={}
# A: isolated only
clfA=fit(Xi,yi)
P=[];T=[]
for n in names:
    d=takes[n]; e=evalset(d); P+=list(clfA.predict(d['X'][e])); T+=[MAP[c] for c in d['lab0'][e]]
res['A_isolated_only']=acc_parts(P,T); res['n_eval']=len(T)
# B: leave-one-usul-out
P=[];T=[];per={}
probs={}
for u in range(1,7):
    tr=[n for n in names if takes[n]['usul']!=u]
    X=np.vstack([Xi]+[takes[n]['X'][takes[n]['ok0']] for n in tr])
    y=list(yi)+sum([[MAP[c] for c in takes[n]['lab0'][takes[n]['ok0']]] for n in tr],[])
    clf=fit(X,y)
    pu=[];tu=[]
    for n in names:
        if takes[n]['usul']!=u: continue
        d=takes[n]; e=evalset(d)
        pr=clf.predict(d['X'][e]); pu+=list(pr); tu+=[MAP[c] for c in d['lab0'][e]]
        pp=clf.predict_proba(d['X']); probs[n]=(list(clf.classes_),pp)
    per[u]=acc_parts(pu,tu)['exact']; P+=pu; T+=tu
res['B_leave_one_usul_out']=acc_parts(P,T); res['B_per_usul']=per
# B2: by tempo, leave-one-usul-out
byt={}
for tmp in ('slow','normal','fast'):
    pass
pickle.dump(probs,open('louo_probs.pkl','wb'))
print(json.dumps(res,indent=1,default=float))
