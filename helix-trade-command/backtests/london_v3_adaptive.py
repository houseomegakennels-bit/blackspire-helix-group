import json,math,statistics
from collections import defaultdict
F=json.load(open('/tmp/helix-extended/v3_features.json'))
T=json.load(open('/tmp/helix-extended/histdata_2009_2024_trades.json'))
bydate={t['research_day_et']:t for t in T}
features=['asia_ticks','asia_ratio20','asia_drift_frac','sweep_depth_frac','mss_lag_min','disp_lag_min','disp_mult','fvg_frac','entry_minute','retrace_lag_min','stop_ticks','rr','prev24_ratio']

def vec(x):
    # signed drift toward swept extreme: positive when Asia moved toward eventual sweep side
    d=[]
    vals={**x}
    vals['asia_ticks']=math.log(max(x['asia_ticks'],1e-9))
    vals['asia_drift_frac']= -x['side']*x['asia_drift_frac']
    vals['stop_ticks']=math.log(max(x['stop_ticks'],1e-9))
    vals['rr']=min(x['rr'],6.0)
    for f in features:
        v=vals[f]
        if v is None or not math.isfinite(v): return None
        d.append(float(v))
    return d

def solve(A,b):
    n=len(b); M=[list(map(float,A[i]))+[float(b[i])] for i in range(n)]
    for i in range(n):
        p=max(range(i,n),key=lambda r:abs(M[r][i]))
        if abs(M[p][i])<1e-12:return None
        M[i],M[p]=M[p],M[i]
        q=M[i][i]
        for j in range(i,n+1):M[i][j]/=q
        for r in range(n):
            if r==i:continue
            q=M[r][i]
            if q==0:continue
            for j in range(i,n+1):M[r][j]-=q*M[i][j]
    return [M[i][n] for i in range(n)]

def fit(train,lam=5.0):
    pairs=[(vec(x),x['R']) for x in train]
    pairs=[p for p in pairs if p[0] is not None]
    if len(pairs)<80:return None
    m=len(features); means=[]; sds=[]
    for j in range(m):
        a=[v[j] for v,y in pairs]; means.append(statistics.mean(a)); sd=statistics.pstdev(a); sds.append(sd if sd>1e-9 else 1)
    X=[]; y=[]
    for v,r in pairs:X.append([1.0]+[(v[j]-means[j])/sds[j] for j in range(m)]);y.append(r)
    p=m+1; A=[[0.0]*p for _ in range(p)]; b=[0.0]*p
    for row,target in zip(X,y):
        for i in range(p):
            b[i]+=row[i]*target
            for j in range(p):A[i][j]+=row[i]*row[j]
    for i in range(1,p):A[i][i]+=lam
    beta=solve(A,b)
    return {'means':means,'sds':sds,'beta':beta,'n':len(pairs)} if beta else None

def predict(model,x):
    v=vec(x)
    if v is None:return None
    z=[1]+[(v[j]-model['means'][j])/model['sds'][j] for j in range(len(features))]
    return sum(a*b for a,b in zip(model['beta'],z))

def summ(xs):
    if not xs:return {'n':0,'wins':0,'win_rate':None,'net':0,'meanR':None,'pf':None,'maxdd':0,'maxddpct':0}
    rs=[x['R'] for x in xs]; net=sum(bydate[x['date']]['net_pnl'] for x in xs)
    gp=sum(bydate[x['date']]['net_pnl'] for x in xs if bydate[x['date']]['net_pnl']>0); gl=-sum(bydate[x['date']]['net_pnl'] for x in xs if bydate[x['date']]['net_pnl']<=0)
    eq=50000; peak=eq;mdd=mddp=0
    for x in sorted(xs,key=lambda z:z['date']):
        eq+=bydate[x['date']]['net_pnl'];peak=max(peak,eq);dd=peak-eq;mdd=max(mdd,dd);mddp=max(mddp,100*dd/peak)
    return {'n':len(xs),'wins':sum(r>0 for r in rs),'win_rate':100*sum(r>0 for r in rs)/len(rs),'net':net,'meanR':sum(rs)/len(rs),'pf':(gp/gl if gl else None),'maxdd':mdd,'maxddpct':mddp}

selected=[]; annual={}; models={}
for y in range(2013,2025):
    train=[x for x in F if y-4<=x['year']<=y-1]
    model=fit(train)
    if not model:
        annual[y]={'train_n':len(train),'trades':[]};continue
    models[y]=model
    test=[x for x in F if x['year']==y]
    chosen=[]
    for x in test:
        p=predict(model,x)
        if p is not None and x['stop_ticks']>=15 and p>0.10:
            yx=dict(x);yx['predR']=p;chosen.append(yx);selected.append(yx)
    annual[y]={'train_n':model['n'],'selected':summ(chosen),'base':summ(test),'pred_mean':(statistics.mean([x['predR'] for x in chosen]) if chosen else None)}
print('ANNUAL')
for y,v in annual.items(): print(y,v)
print('\nV3',summ(selected))
base=[x for x in F if 2013<=x['year']<=2024]
print('BASE same years',summ(base))
posyears=sum(1 for y,v in annual.items() if v.get('selected',{}).get('meanR') is not None and v['selected']['meanR']>0)
activeyears=sum(1 for y,v in annual.items() if v.get('selected',{}).get('n',0)>0)
print('positive years',posyears,'/',activeyears)
# save
out={'spec':'London-V3-adaptive','walk_forward_years':[2013,2024],'v3':summ(selected),'base_same_years':summ(base),'positive_years':posyears,'active_years':activeyears,'annual':annual,'selected_trades':selected}
open('/tmp/helix-extended/v3_walkforward_results.json','w').write(json.dumps(out,indent=2))
