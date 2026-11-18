import pickle, numpy as np, json
from align import *
takes=pickle.load(open('takes.pkl','rb')); names=sorted(takes)
Xi,yi=iso_data(); m=np.isin(yi,list(CLS)); y3=np.array([CLS[v] for v in yi[m]])
out={}
clf=fit(Xi[m],y3); P=[];T=[]
for n in names:
    d=takes[n]; e=d['ok0']; P+=list(clf.predict(d['X'][e])); T+=list(d['lab0'][e])
out['A3_isolated_only_3class']=float(np.mean(np.array(P)==np.array(T)))
P=[];T=[];tempo={'slow':[], 'normal':[], 'fast':[]}
for u in range(1,7):
    tr=[n for n in names if takes[n]['usul']!=u]
    X=np.vstack([Xi[m]]+[takes[n]['X'][takes[n]['ok0']] for n in tr]); y=list(y3)+sum([list(takes[n]['lab0'][takes[n]['ok0']]) for n in tr],[])
    clf=fit(X,y)
    for n in names:
        if takes[n]['usul']!=u: continue
        d=takes[n]; e=d['ok0']; pr=clf.predict(d['X'][e]); P+=list(pr); T+=list(d['lab0'][e])
        tempo[n.split('_')[1]]+=list(pr==d['lab0'][e])
out['B3_louo_3class']=float(np.mean(np.array(P)==np.array(T)))
out['B3_by_tempo']={k:float(np.mean(v)) for k,v in tempo.items()}
# only phrase-trained, no isolated clips, cross-tempo: train slow+normal, test fast
for test in ('fast','slow'):
    tr=[n for n in names if not n.endswith(test)]; te=[n for n in names if n.endswith(test)]
    clf=fit(np.vstack([takes[n]['X'][takes[n]['ok0']] for n in tr]), sum([list(takes[n]['lab0'][takes[n]['ok0']]) for n in tr],[]))
    a=np.concatenate([clf.predict(takes[n]['X'][takes[n]['ok0']])==takes[n]['lab0'][takes[n]['ok0']] for n in te])
    out[f'cross_tempo_test_{test}']=float(a.mean())
print(json.dumps(out,indent=1))
