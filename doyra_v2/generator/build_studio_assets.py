# Builds doyra-ai-site/studio/generate/ (audio + generate.json) for the Studio Generate mode.
# Run from the folder with free/*.wav, free/free.pkl (labelled free takes) and bank2.pkl, next to beats2.py and gen.py.
"""Assets for Doyra Studio's Generate mode.
recorded: each free take, cut into whole cycles (beat tracking, as cyclegen2.py) -> uN.m4a + cycle list
pattern:  a small set of in-phrase strokes cut from the taught takes (bank2) -> strokes.m4a sprite"""
import sys, json, pickle, subprocess, numpy as np, soundfile as sf
sys.path.insert(0,'.')
from beats2 import beats_with_rests
from gen import F
SR=44100; OUT='studio_generate_out/'
PER={'U1_free':8,'U2_free':4,'U3_free':8,'U4_free':8,'U5_free':6,'U6_free':4}
ID={'U1_free':'u1','U2_free':'toy','U3_free':'u3','U4_free':'u4','U5_free':'u5','U6_free':'u6'}
CODE={'B':'M','k':'K','S':'t'}
def attack(x):
    pk=np.abs(x).max(); return int(np.argmax(np.abs(x)>=0.1*pk))
def enc(x,path,br='112k'):
    sf.write('/tmp/_g.wav',x,SR,subtype='PCM_16')
    subprocess.run(['ffmpeg','-v','error','-y','-i','/tmp/_g.wav','-c:a','aac','-b:a',br,path],check=True)
data={'sr':SR,'usuls':{}}
for name,P in PER.items():
    y,units,bp=beats_with_rests(name); d=F[name]; t=d['t']; amp=d['amp']; ac=d['ac']
    score=np.zeros(P)
    for i,u in enumerate(units):
        m=(t>=u['a'])&(t<u['b'])
        if m.any(): score[i%P]+=amp[m][0]*(1.5 if ac[m][0]=='B' else 1)
    ph=int(np.argmax(score)); cyc=[]
    for k in range(ph,len(units)-P+1,P):
        g=units[k:k+P]
        if any(abs(g[j+1]['a']-g[j]['b'])>1e-3 for j in range(P-1)): continue
        a,b=g[0]['a'],g[-1]['b']
        if b-a>P*bp*1.6: continue
        m=(t>=a)&(t<b)
        seg=y[int(a*SR):int(b*SR)]
        # loudness of the first and last beat, for smooth joins
        def rms(u): s=y[int(u['a']*SR):int(u['b']*SR)]; return float(np.sqrt(np.mean(s**2))+1e-6)
        cyc.append(dict(a=a,b=b,first=g[0]['typ'],last=g[-1]['typ'],loud=float(np.sqrt(np.mean(seg**2))),
            l0=rms(g[0]),l1=rms(g[-1]),idx=k,
            s=[[round(float(tt-a),4),CODE[str(c)],round(float(v),3)] for tt,c,v in zip(t[m],ac[m],amp[m]/np.median(amp))]))
    lo=max(0,cyc[0]['a']-0.05); hi=min(len(y)/SR,cyc[-1]['b']+0.6)
    clip=y[int(lo*SR):int(hi*SR)]; clip=0.9*clip/np.abs(clip).max()
    enc(clip,OUT+f"{ID[name]}.m4a")
    seen=set()
    for c1,c2 in zip(cyc[:-1],cyc[1:]):
        if c2['idx']==c1['idx']+P: seen.add(c1['last']+'>'+c2['first'])
    L=np.array([c['loud'] for c in cyc]); ref=np.median(L)
    out=[]
    for c in cyc:
        out.append(dict(a=round(c['a']-lo,4),b=round(c['b']-lo,4),first=c['first'],last=c['last'],
            loud=round(c['loud']/ref,3),l0=round(c['l0']/ref,3),l1=round(c['l1']/ref,3),idx=c['idx'],s=c['s']))
    data['usuls'][ID[name]]=dict(file=f"{ID[name]}.m4a",firstAttack=round(attack(clip)/SR,5),beat=round(float(bp),4),per=P,
        seen=sorted(seen),cycles=out,source=name.replace('_free',' free take')+(' (rez)' if name=='U6_free' else ''))
    print(name,'cycles',len(out),'beat',round(bp,3),'dur',round(hi-lo,1),'seen',len(seen))
# stroke sprite for pattern mode
B=pickle.load(open('bank2.pkl','rb')); rng=np.random.default_rng(3)
lv={c:float(np.median(np.concatenate([F[n]['amp'][F[n]['ac']==c] for n in F]))) for c in 'BkS'}
mx=max(lv.values()); sprite=[]; parts=[]; pos=0
for c in 'BkS':
    cand=[x for x in B[c] if 0.32<=x['gap']<=0.9]
    # typical strokes: spectral centroid near the median, no clipping
    cen=np.array([np.sum(np.abs(np.fft.rfft(x['seg'][:2048],2048))*np.arange(1025))/np.sum(np.abs(np.fft.rfft(x['seg'][:2048],2048))) for x in cand])
    order=np.argsort(np.abs(cen-np.median(cen)))[:24]; pick=rng.choice(order,8,replace=False)
    for j in pick:
        s=cand[j]['seg'][:int(0.6*SR)].copy(); s=s/np.abs(s).max()
        fl=int(0.03*SR); s[-fl:]*=np.linspace(1,0,fl)
        parts.append(s); parts.append(np.zeros(int(0.05*SR)))
        sprite.append(dict(code=CODE[c],at=round(pos/SR,5),dur=round(len(s)/SR,5)))
        pos+=len(s)+int(0.05*SR)
sp=np.concatenate(parts)*0.9
enc(sp,OUT+'strokes.m4a','160k')
# attack of the first stroke in the sprite lets the browser correct for codec delay
data['strokes']=dict(file='strokes.m4a',firstAttack=round(attack(sp[:int(0.05*SR)+int(0.6*SR)])/SR,5),
    gain={CODE[c]:round(lv[c]/mx,3) for c in 'BkS'},takes=sprite)
json.dump(data,open(OUT+'generate.json','w'),separators=(',',':'))
print('gain',data['strokes']['gain'])
