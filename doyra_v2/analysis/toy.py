import pickle, numpy as np, json
from align import PAT
takes=pickle.load(open('takes.pkl','rb'))
rng=np.random.default_rng(0)
out={}
for tmp in ('slow','normal','fast'):
    d=takes[f'U2_{tmp}']; t=d['t']; pos=d['pos']; ok=d['ok0']
    g=np.diff(t); med=np.median(g)
    rows=[]
    for i in range(len(t)-2):
        if pos[i]%3==0 and pos[i+1]%3==1 and pos[i+2]%3==2 and ok[i+1] and ok[i+2]:
            I1=t[i+1]-t[i]; I2=t[i+2]-t[i+1]
            if max(I1,I2)>1.8*med: continue
            I3=np.nan
            if i+3<len(t) and pos[i+3]%3==0 and ok[i+3] and t[i+3]-t[i+2]<1.8*med: I3=t[i+3]-t[i+2]
            rows.append((I1*1000,I2*1000,I3*1000))
    a=np.array(rows); r=a[:,0]/a[:,1]
    bs=[np.mean(rng.choice(r,len(r))) for _ in range(5000)]
    spm=60/np.median(g)
    out[tmp]=dict(groups=len(r), spm=round(spm), I1=round(np.mean(a[:,0])), I2=round(np.mean(a[:,1])), I3=round(np.nanmean(a[:,2])),
                  ratio=round(float(r.mean()),2), ci=[round(float(np.percentile(bs,2.5)),2),round(float(np.percentile(bs,97.5)),2)],
                  I2_shortest=round(float(np.mean((a[:,1]<a[:,0]))),2))
print(json.dumps(out,indent=1))
json.dump(out,open('toy_new.json','w'))
