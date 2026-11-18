import pickle, numpy as np, joblib
from align import *
takes=pickle.load(open('takes.pkl','rb')); Xi,yi=iso_data()
MAP={'B':'kichik_bum_main','k':'kichik_bak_main','S':'bak_secondary'}
X=np.vstack([Xi]+[d['X'][d['ok0']] for d in takes.values()]); y=list(yi)+sum([[MAP[c] for c in d['lab0'][d['ok0']]] for d in takes.values()],[])
clf=fit(X,y); joblib.dump(clf,'pkg/doyra_v2/stroke_classifier_v2.joblib',compress=3)
print('trained on',len(y),'strokes')
