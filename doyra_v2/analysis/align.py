import numpy as np, glob, json, pickle
from pathlib import Path
from feat import *
from sklearn.ensemble import RandomForestClassifier
from sklearn.preprocessing import StandardScaler
from sklearn.pipeline import make_pipeline

PAT = {1:"kBkkSBkSkSBkkSB", 2:"Bkk"*4, 3:"kkSBkkSkkSBkkSB", 4:"BkkBk", 5:"BkkkBkk", 6:"kSkSkSk"}
CL = ['B','k','S']

def detect(path, thr=0.03):
    y=load(path); st,pk,amp=onsets(y); k=amp>thr; st,amp=st[k],amp[k]
    # drop double triggers: closer than 70 ms or < 35% of median gap -> keep louder
    keep=list(range(len(st)))
    while True:
        t=st[keep]/SR; g=np.diff(t); med=np.median(g)
        bad=np.where((g<0.07)|(g<0.35*med))[0]
        if not len(bad): break
        i=bad[0]; a,b=keep[i],keep[i+1]; keep.remove(a if amp[a]<amp[b] else b)
    st=st[keep]; amp=amp[keep]
    X=np.array([featvec(y,s) for s in st])
    return dict(t=st/SR, amp=amp, X=X)

def viterbi(logp, pat, t):
    """logp: N x 3 log-probs over CL. States = cycle positions. Moves: +1 (0), +2 skip (-4),
    stay/insert (-5), restart to any position after a long pause (-2) or anywhere (-8)."""
    L=len(pat); N=len(logp); ci=[CL.index(c) for c in pat]
    em=np.array([[logp[n,ci[j]] for j in range(L)] for n in range(N)])
    g=np.diff(t); med=np.median(g)
    D=np.full((N,L),-1e9); bp=np.zeros((N,L),int)
    D[0]=em[0]
    for n in range(1,N):
        pause = g[n-1] > 1.8*med
        for j in range(L):
            cands=[(D[n-1,(j-1)%L],(j-1)%L),(D[n-1,(j-2)%L]-4,(j-2)%L),(D[n-1,j]-5,j)]
            best=int(np.argmax(D[n-1])); cands.append((D[n-1,best]-(2 if pause else 8),best))
            v,b=max(cands); D[n,j]=v+em[n,j]; bp[n,j]=b
    path=[int(np.argmax(D[-1]))]
    for n in range(N-1,0,-1): path.append(bp[n,path[-1]])
    path=path[::-1]
    # flag strokes whose move was not a plain +1
    ok=[True]+[path[n]==(path[n-1]+1)%L for n in range(1,N)]
    return path, ok

def fit(X,y):
    return make_pipeline(StandardScaler(),RandomForestClassifier(400,random_state=0,class_weight='balanced')).fit(X,y)

if __name__=="__main__":
    Xi,yi=iso_data(); m=np.isin(yi,list(CLS)); clf=fit(Xi[m],[CLS[v] for v in yi[m]])
    takes={}
    for p in sorted(glob.glob('wav/U*.wav')):
        name=Path(p).stem; takes[name]=detect(p); takes[name]['usul']=int(name[1])
    for it in range(3):
        allX=[];ally=[]
        for name,d in takes.items():
            pr=clf.predict_proba(d['X']); lp=np.log(pr[:,[list(clf.classes_).index(c) for c in CL]]+1e-3)
            pat=PAT[d['usul']]; path,ok=viterbi(lp,pat,d['t'])
            lab=np.array([pat[j] for j in path]); acou=np.array([CL[i] for i in lp.argmax(1)])
            d.update(pos=np.array(path), lab=lab, ok=np.array(ok), acou=acou)
            conf=d['ok'] & (lab==acou)
            allX.append(d['X'][conf]); ally+=list(lab[conf])
        # self-training: isolated + confident in-phrase strokes
        clf=fit(np.vstack([Xi[m]]+allX), [CLS[v] for v in yi[m]]+ally)
        tot=sum(len(d['t']) for d in takes.values()); okn=sum(d['ok'].sum() for d in takes.values())
        agree=sum((d['lab']==d['acou']).sum() for d in takes.values())
        print(f"iter {it}: strokes={tot} clean-path={okn/tot:.3f} acoustic-agrees-with-pattern={agree/tot:.3f}")
    for name,d in takes.items():
        print(f"{name:10s} n={len(d['t']):3d} clean={d['ok'].mean():.2f} agree={np.mean(d['lab']==d['acou']):.2f}")
    pickle.dump(takes,open('takes.pkl','wb'))
