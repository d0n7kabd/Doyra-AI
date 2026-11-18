# labels from the isolated-only classifier + pattern (no self-training) -> no leakage for evaluation
import pickle, numpy as np
from align import *
Xi,yi=iso_data(); m=np.isin(yi,list(CLS)); clf=fit(Xi[m],[CLS[v] for v in yi[m]])
takes=pickle.load(open('takes.pkl','rb'))
same=0;tot=0
for name,d in takes.items():
    pr=clf.predict_proba(d['X']); lp=np.log(pr[:,[list(clf.classes_).index(c) for c in CL]]+1e-3)
    pat=PAT[d['usul']]; path,ok=viterbi(lp,pat,d['t'])
    lab0=np.array([pat[j] for j in path]); d['lab0']=lab0; d['ok0']=np.array(ok)
    s=(lab0==d['lab']).mean(); same+=(lab0==d['lab']).sum(); tot+=len(lab0)
    # breaks: where path not +1
    br=[round(float(d['t'][i]),1) for i in np.where(~d['ok0'])[0]]
    print(f"{name:10s} lab0==lab2 {s:.3f}  breaks at s: {br[:12]}{' ...' if len(br)>12 else ''}")
print('overall agreement', same/tot)
pickle.dump(takes,open('takes.pkl','wb'))
