#!/usr/bin/env python3
import argparse,csv,json,math,statistics
from datetime import datetime,timezone
from pathlib import Path
from zoneinfo import ZoneInfo

TZ=ZoneInfo('America/New_York'); TICK=0.00005; TICK_VALUE=.625; COMM_RT=1.50
START_EQUITY=50000.0; RISK_PCT=.005; MAX_CONTRACTS=6; MIN_COVERAGE=.85

def load_csv(path):
    out=[]
    with open(path,newline='') as f:
        for r in csv.DictReader(f):
            d=datetime.fromisoformat(r['datetime'])
            if d.tzinfo is None: d=d.replace(tzinfo=timezone.utc)
            else: d=d.astimezone(timezone.utc)
            out.append({'dt_utc':d,'dt_et':d.astimezone(TZ),'open':float(r['open']),'high':float(r['high']),'low':float(r['low']),'close':float(r['close']),'volume':float(r.get('volume',0) or 0)})
    return out

def in_asia(r): return 20<=r['dt_et'].hour<24

def in_london(r): return 2<=r['dt_et'].hour<5

def split_cycles(rows):
    cycles=[]; cur=[]; active=False; start=None
    for r in rows:
        if in_asia(r) and not active:
            cur=[r]; active=True; start=r['dt_et'].date(); continue
        if active:
            if r['dt_et'].date()>start and r['dt_et'].hour>=10:
                cycles.append(cur); cur=[]; active=False; start=None; continue
            cur.append(r)
    return cycles

def quality(c):
    a=sum(in_asia(x) for x in c); l=sum(in_london(x) for x in c)
    miss=a==0 or l==0
    short=(not miss) and (a<math.ceil(48*MIN_COVERAGE) or l<math.ceil(36*MIN_COVERAGE))
    return miss,short,a,l

def fvg(c,i,d):
    if i<2:return None
    if d==1 and c[i]['low']>c[i-2]['high']:
        lo,hi=c[i-2]['high'],c[i]['low']; return {'low':lo,'high':hi,'mid':(lo+hi)/2}
    if d==-1 and c[i]['high']<c[i-2]['low']:
        lo,hi=c[i]['high'],c[i-2]['low']; return {'low':lo,'high':hi,'mid':(lo+hi)/2}
    return None

def size(equity,entry,stop):
    ticks=round(abs(entry-stop)/TICK,8); rpc=ticks*TICK_VALUE
    return 0 if rpc<=0 else min(MAX_CONTRACTS,int((equity*RISK_PCT)//rpc))

def simulate(c,entry_i,d,entry_ref,stop_ref,target_ref,contracts,equity,branch):
    entry_fill=entry_ref+d*TICK
    exit_type='time'; exit_ref=c[-1]['close']; exit_bar=c[-1]
    for j,b in enumerate(c[entry_i:],start=entry_i):
        if b['dt_et'].hour>=10: break
        sh=b['low']<=stop_ref if d==1 else b['high']>=stop_ref
        th=b['high']>=target_ref if d==1 else b['low']<=target_ref
        if sh: exit_type='stop'; exit_ref=stop_ref; exit_bar=b; break
        if th and j>entry_i: exit_type='target'; exit_ref=target_ref; exit_bar=b; break
        exit_ref=b['close']; exit_bar=b
    exit_fill=exit_ref-d*TICK
    pnl_ticks=(exit_fill-entry_fill)/TICK*d
    gross=pnl_ticks*TICK_VALUE*contracts; comm=COMM_RT*contracts; net=gross-comm
    ref_risk=abs(entry_ref-stop_ref)/TICK*TICK_VALUE*contracts
    return {'branch':branch,'research_day_et':c[entry_i]['dt_et'].date().isoformat(),'direction':'LONG' if d==1 else 'SHORT',
            'contracts':contracts,'entry_time_et':c[entry_i]['dt_et'].isoformat(),'entry_ref':entry_ref,'stop_ref':stop_ref,'target_ref':target_ref,
            'exit_time_et':exit_bar['dt_et'].isoformat(),'exit_type':exit_type,'net_pnl':net,'r_multiple':None if ref_risk==0 else net/ref_risk,
            'equity_before':equity,'equity_after':equity+net,'reference_risk_dollars':ref_risk}

def analyze(c,equity):
    miss,short,ab,lb=quality(c)
    if miss:return None,'missing_session'
    if short:return None,'short_session'
    asia=[x for x in c if in_asia(x)]; ah=max(x['high'] for x in asia); al=min(x['low'] for x in asia)
    med=[None]*len(c)
    bodies=[abs(x['close']-x['open']) for x in c]
    for i in range(20,len(c)): med[i]=statistics.median(bodies[i-20:i])
    swing_hi=swing_lo=None
    side=0; state=None; break_i=None; sweep_ext=None; mss_level=None; accepted=False; outside_run=0
    mss_i=None; disp_i=None; gap=None
    for i,b in enumerate(c):
        if i>=2:
            p=c[i-1]; p2=c[i-2]
            if p['high']>p2['high'] and p['high']>b['high']: swing_hi=p['high']
            if p['low']<p2['low'] and p['low']<b['low']: swing_lo=p['low']
        if not in_london(b): continue
        hi_break=b['high']>=ah+TICK; lo_break=b['low']<=al-TICK
        if hi_break and lo_break:return None,'double_break'
        if side==0:
            if not (hi_break or lo_break): continue
            side=1 if hi_break else -1; break_i=i; sweep_ext=b['high'] if side==1 else b['low']
            inside=al<=b['close']<=ah
            outside=(b['close']>=ah+TICK) if side==1 else (b['close']<=al-TICK)
            if inside:
                state='REJECTION'; mss_level=swing_lo if side==1 else swing_hi
            elif outside:
                state='ACCEPTANCE'; outside_run=1
                strong=med[i] is not None and bodies[i]>=1.5*med[i]
                accepted=strong
                if accepted:
                    g=fvg(c,i,side)
                    if strong and g is not None: disp_i=i; gap=g
            else:
                return None,'unclear_break_close'
            continue
        # invalidate opposite-side break before entry; same-side extension is allowed
        if side==1 and lo_break:return None,'double_break'
        if side==-1 and hi_break:return None,'double_break'
        if side==1 and hi_break: sweep_ext=max(sweep_ext,b['high'])
        if side==-1 and lo_break: sweep_ext=min(sweep_ext,b['low'])

        if state=='REJECTION':
            d=-side
            if mss_i is None and mss_level is not None and i>break_i:
                if d==-1 and b['close']<mss_level:mss_i=i
                if d==1 and b['close']>mss_level:mss_i=i
            strong=med[i] is not None and bodies[i]>=1.5*med[i] and ((d==1 and b['close']>b['open']) or (d==-1 and b['close']<b['open']))
            if mss_i is not None and gap is None and i>=mss_i and strong:
                g=fvg(c,i,d)
                if g is not None: disp_i=i; gap=g; continue
            if gap is not None and i>disp_i and b['low']<=gap['mid']<=b['high']:
                entry=gap['mid']; stop=sweep_ext+TICK if d==-1 else sweep_ext-TICK
                if (d==1 and stop>=entry) or (d==-1 and stop<=entry):return None,'invalid_stop'
                if abs(entry-stop)/TICK<15:return None,'rejection_stop_lt_15'
                target=entry+d*2*abs(entry-stop); n=size(equity,entry,stop)
                if n<=0:return None,'risk_too_large'
                t=simulate(c,i,d,entry,stop,target,n,equity,'REJECTION'); t.update({'asia_high':ah,'asia_low':al,'break_extreme':sweep_ext}); return t,None

        elif state=='ACCEPTANCE':
            d=side; boundary=ah if d==1 else al
            outside=(b['close']>=boundary+TICK) if d==1 else (b['close']<=boundary-TICK)
            outside_run=outside_run+1 if outside else 0
            strong=med[i] is not None and bodies[i]>=1.5*med[i] and ((d==1 and b['close']>b['open']) or (d==-1 and b['close']<b['open']))
            if not accepted and (outside_run>=2 or strong): accepted=True
            if accepted and gap is None and strong:
                g=fvg(c,i,d)
                if g is not None: disp_i=i; gap=g; continue
            if gap is not None and i>disp_i and b['low']<=gap['mid']<=b['high'] and outside:
                entry=gap['mid']; stop=(ah-TICK) if d==1 else (al+TICK)
                if (d==1 and stop>=entry) or (d==-1 and stop<=entry):return None,'invalid_stop'
                if abs(entry-stop)/TICK<10:return None,'acceptance_stop_lt_10'
                target=entry+d*2*abs(entry-stop); n=size(equity,entry,stop)
                if n<=0:return None,'risk_too_large'
                t=simulate(c,i,d,entry,stop,target,n,equity,'ACCEPTANCE'); t.update({'asia_high':ah,'asia_low':al,'break_extreme':sweep_ext}); return t,None
    if side==0:return None,'no_break'
    if state=='REJECTION':return None,'rejection_no_entry'
    return None,'acceptance_no_entry'

def stats(ts,start=START_EQUITY):
    if not ts:return {'trades':0,'wins':0,'win_rate_pct':None,'net_pnl':0,'expectancy_r':None,'profit_factor':None,'max_drawdown_dollars':0,'max_drawdown_pct':0,'longest_losing_streak':0}
    nets=[x['net_pnl'] for x in ts]; rs=[x['r_multiple'] for x in ts]; wins=[x for x in nets if x>0]; losses=[x for x in nets if x<=0]
    eq=start; peak=start; mdd=mddp=0; streak=mx=0
    for p in nets:
        eq+=p; peak=max(peak,eq); dd=peak-eq; mdd=max(mdd,dd); mddp=max(mddp,100*dd/peak)
        streak=0 if p>0 else streak+1; mx=max(mx,streak)
    gl=abs(sum(losses)); return {'trades':len(ts),'wins':len(wins),'win_rate_pct':100*len(wins)/len(ts),'net_pnl':sum(nets),'return_pct':100*(eq/start-1),
        'expectancy_r':statistics.mean(rs),'profit_factor':None if gl==0 else sum(wins)/gl,'max_drawdown_dollars':mdd,'max_drawdown_pct':mddp,'longest_losing_streak':mx,
        'exit_counts':{k:sum(x['exit_type']==k for x in ts) for k in ('stop','target','time')}}

def run(path):
    rows=load_csv(path); cycles=split_cycles(rows); eq=START_EQUITY; trades=[]; skips={}
    for c in cycles:
        t,r=analyze(c,eq)
        if t: trades.append(t); eq=t['equity_after']
        else: skips[r]=skips.get(r,0)+1
    branches={b:stats([t for t in trades if t['branch']==b]) for b in ('REJECTION','ACCEPTANCE')}
    yearly={}
    for y in sorted({int(t['research_day_et'][:4]) for t in trades}): yearly[str(y)]=stats([t for t in trades if int(t['research_day_et'][:4])==y])
    active=[v for v in yearly.values() if v['trades']>0]; positive=sum(v['net_pnl']>0 for v in active)
    combined=stats(trades); combined['positive_years']=positive; combined['active_years']=len(active); combined['positive_year_pct']=None if not active else 100*positive/len(active)
    gate=combined['trades']>=100 and combined['expectancy_r']>0.10 and (combined['profit_factor'] or 0)>=1.25 and (combined['positive_year_pct'] or 0)>=60
    for b,v in branches.items():
        if v['trades']>=30 and v['expectancy_r']<-0.25: gate=False
    return {'data_first_utc':rows[0]['dt_utc'].isoformat(),'data_last_utc':rows[-1]['dt_utc'].isoformat(),'cycles':len(cycles),'combined':combined,'branches':branches,'yearly':yearly,'skips':skips,'advancement_gate':'PASS' if gate else 'FAIL','trades':trades}

def main():
    ap=argparse.ArgumentParser(); ap.add_argument('csv'); ap.add_argument('--json-out'); ap.add_argument('--trades-out'); a=ap.parse_args(); r=run(a.csv)
    if a.json_out: Path(a.json_out).write_text(json.dumps({k:v for k,v in r.items() if k!='trades'},indent=2)+'\n')
    if a.trades_out: Path(a.trades_out).write_text(json.dumps(r['trades'],indent=2)+'\n')
    print(json.dumps({k:v for k,v in r.items() if k!='trades'},indent=2))
if __name__=='__main__':main()
