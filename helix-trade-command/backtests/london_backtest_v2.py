#!/usr/bin/env python3
import argparse,csv,json,math,statistics
from datetime import datetime,timezone
from pathlib import Path
from zoneinfo import ZoneInfo

TZ=ZoneInfo('America/New_York'); MIN_COVERAGE=.85
START_EQUITY=50000.0; RISK_PCT=.005; MAX_CONTRACTS=6; SLIP_TICKS=1

def load_csv(path):
    out=[]
    with open(path,newline='') as f:
        for r in csv.DictReader(f):
            d=datetime.fromisoformat(r['datetime']).replace(tzinfo=timezone.utc)
            out.append({'dt_utc':d,'dt_et':d.astimezone(TZ),'open':float(r['open']),'high':float(r['high']),'low':float(r['low']),'close':float(r['close']),'volume':int(float(r['volume']))})
    return out

def in_asia(r): return r['dt_et'].hour>=20 and r['dt_et'].hour<24

def in_london(r): return 2<=r['dt_et'].hour<5

def in_trade_day(r): return 0<=r['dt_et'].hour<10

def split_cycles(rows):
    cycles=[]; cur=[]; active=False; start_date=None
    for r in rows:
        a=in_asia(r)
        if a and not active:
            cur=[r]; active=True; start_date=r['dt_et'].date(); continue
        if active:
            # Finish only on the following calendar day at 10:00 ET or later.
            if r['dt_et'].date()>start_date and r['dt_et'].hour>=10:
                cycles.append(cur); cur=[]; active=False; start_date=None
                continue
            cur.append(r)
    return cycles

def session_quality(c):
    asia=sum(in_asia(x) for x in c); london=sum(in_london(x) for x in c)
    missing=asia==0 or london==0
    short=(not missing) and (asia<math.ceil(48*MIN_COVERAGE) or london<math.ceil(36*MIN_COVERAGE))
    return {'asia':asia,'london':london},missing,short

def fvg_for_bar(c,i,direction):
    if i<2: return None
    if direction==-1 and c[i]['high'] < c[i-2]['low']:
        lo,hi=c[i]['high'],c[i-2]['low']; return {'low':lo,'high':hi,'mid':(lo+hi)/2}
    if direction==1 and c[i]['low'] > c[i-2]['high']:
        lo,hi=c[i-2]['high'],c[i]['low']; return {'low':lo,'high':hi,'mid':(lo+hi)/2}
    return None

def position_size(equity,entry,stop,tick,tick_value):
    ticks=round(abs(entry-stop)/tick,8); risk_pc=ticks*tick_value
    return (0,risk_pc) if risk_pc<=0 else (min(MAX_CONTRACTS,int((equity*RISK_PCT)//risk_pc)),risk_pc)

def simulate(c,entry_idx,direction,entry_ref,stop_ref,target_ref,contracts,equity,tick,tick_value,commission_rt,day):
    entry_fill=entry_ref + direction*tick*SLIP_TICKS
    exit_type='time'; exit_ref=c[-1]['close']; exit_bar=c[-1]
    for j,b in enumerate(c[entry_idx:], start=entry_idx):
        if b['dt_et'].hour>=10: break
        sh=(b['low']<=stop_ref) if direction==1 else (b['high']>=stop_ref)
        th=(b['high']>=target_ref) if direction==1 else (b['low']<=target_ref)
        # On the entry bar, a stop touch is charged conservatively, but a target-only touch
        # is not credited because 5m OHLC cannot establish whether target came after the limit fill.
        if sh: exit_type='stop'; exit_ref=stop_ref; exit_bar=b; break
        if th and j>entry_idx: exit_type='target'; exit_ref=target_ref; exit_bar=b; break
        exit_bar=b; exit_ref=b['close']
    exit_fill=exit_ref - direction*tick*SLIP_TICKS
    pnl_ticks=(exit_fill-entry_fill)/tick*direction
    gross=pnl_ticks*tick_value*contracts; commission=commission_rt*contracts; net=gross-commission
    ref_risk=abs(entry_ref-stop_ref)/tick*tick_value*contracts
    return {'research_day_et':day,'direction':'LONG' if direction==1 else 'SHORT','contracts':contracts,'entry_time_et':c[entry_idx]['dt_et'].isoformat(),
            'entry_ref':entry_ref,'entry_fill':entry_fill,'stop_ref':stop_ref,'target_ref':target_ref,'exit_time_et':exit_bar['dt_et'].isoformat(),
            'exit_type':exit_type,'exit_ref':exit_ref,'exit_fill':exit_fill,'gross_pnl':gross,'commission':commission,'net_pnl':net,
            'r_multiple':None if ref_risk==0 else net/ref_risk,'equity_before':equity,'equity_after':equity+net,'reference_risk_dollars':ref_risk}

def analyze_cycle(c,equity,tick,tick_value,commission_rt):
    counts,missing,short=session_quality(c)
    if missing: return None,'missing_session'
    if short: return None,'short_session'
    asia=[x for x in c if in_asia(x)]
    if not asia: return None,'missing_asia'
    asia_hi=max(x['high'] for x in asia); asia_lo=min(x['low'] for x in asia)
    bodies=[abs(x['close']-x['open']) for x in c]
    last_swing_hi=last_swing_lo=None; swept_side=0; sweep_ext=None; sweep_idx=None; reclaim_idx=None; mss_idx=None; disp_idx=None; fvg=None
    mss_level=None; invalid_double=False; entry_idx=None; entry_ref=None
    for i,b in enumerate(c):
        if i>=2:
            p1,p2=c[i-1],c[i-2]
            if p1['high']>p2['high'] and p1['high']>b['high']: last_swing_hi=p1['high']
            if p1['low']<p2['low'] and p1['low']<b['low']: last_swing_lo=p1['low']
        if not in_london(b): continue
        hi_sweep=b['high']>=asia_hi+tick and asia_lo<=b['close']<=asia_hi
        lo_sweep=b['low']<=asia_lo-tick and asia_lo<=b['close']<=asia_hi
        if hi_sweep and lo_sweep: invalid_double=True; break
        if swept_side==0:
            if hi_sweep:
                swept_side=-1; sweep_idx=i; sweep_ext=b['high']; mss_level=last_swing_lo; reclaim_idx=i
            elif lo_sweep:
                swept_side=1; sweep_idx=i; sweep_ext=b['low']; mss_level=last_swing_hi; reclaim_idx=i
            continue
        # Any opposite-side sweep before entry invalidates the setup; same-side extensions update stop extreme.
        if swept_side==-1:
            if lo_sweep: invalid_double=True; break
            if hi_sweep: sweep_ext=max(sweep_ext,b['high'])
        else:
            if hi_sweep: invalid_double=True; break
            if lo_sweep: sweep_ext=min(sweep_ext,b['low'])
        if mss_idx is None and mss_level is not None and i>sweep_idx:
            if swept_side==-1 and b['close']<mss_level: mss_idx=i
            elif swept_side==1 and b['close']>mss_level: mss_idx=i
        med=statistics.median(bodies[i-20:i]) if i>=20 else None; body=bodies[i]
        disp=(swept_side==-1 and b['close']<b['open'] and med is not None and body>=1.5*med) or (swept_side==1 and b['close']>b['open'] and med is not None and body>=1.5*med)
        if mss_idx is not None and disp_idx is None and i>=mss_idx and disp:
            candidate_fvg=fvg_for_bar(c,i,swept_side)
            if candidate_fvg is not None:
                disp_idx=i; fvg=candidate_fvg
                continue
        if fvg is not None and i>disp_idx:
            mid=fvg['mid']
            if b['low']<=mid<=b['high']:
                entry_idx=i; entry_ref=mid; break
    if invalid_double: return None,'double_sweep'
    if swept_side==0: return None,'no_single_sweep'
    if mss_idx is None: return None,'no_mss'
    if disp_idx is None or fvg is None: return None,'no_displacement_fvg'
    if entry_idx is None: return None,'no_fvg_retrace'
    direction=swept_side
    stop_ref=(sweep_ext+tick) if direction==-1 else (sweep_ext-tick)
    valid_stop=(direction==-1 and stop_ref>entry_ref) or (direction==1 and stop_ref<entry_ref)
    if not valid_stop: return None,'invalid_stop'
    risk=abs(entry_ref-stop_ref)
    opposite=asia_lo if direction==-1 else asia_hi
    reward=(entry_ref-opposite) if direction==-1 else (opposite-entry_ref)
    rr=reward/risk if risk>0 else 0
    if rr<1.5: return None,'rr_below_1_5'
    target_ref=entry_ref + direction*min(rr,3.0)*risk
    contracts,_=position_size(equity,entry_ref,stop_ref,tick,tick_value)
    if contracts<=0: return None,'risk_too_large'
    day=c[entry_idx]['dt_et'].date().isoformat()
    t=simulate(c,entry_idx,direction,entry_ref,stop_ref,target_ref,contracts,equity,tick,tick_value,commission_rt,day)
    t.update({'asia_high':asia_hi,'asia_low':asia_lo,'sweep_extreme':sweep_ext,'fvg_low':fvg['low'],'fvg_high':fvg['high'],'fvg_mid':fvg['mid'],
              'mss_time_et':c[mss_idx]['dt_et'].isoformat(),'displacement_time_et':c[disp_idx]['dt_et'].isoformat(),'price_rr_to_opposite_asia':rr})
    return t,None

def summarize(trades,start=START_EQUITY):
    if not trades: return {'trades':0,'starting_equity':start,'ending_equity':start,'net_pnl':0.0}
    nets=[t['net_pnl'] for t in trades]; rs=[t['r_multiple'] for t in trades]; eq=start; peak=start; mdd=mddpct=0; streak=mx=0
    for p in nets:
        eq+=p; peak=max(peak,eq); dd=peak-eq; mdd=max(mdd,dd); mddpct=max(mddpct,100*dd/peak if peak else 0)
        if p<=0: streak+=1; mx=max(mx,streak)
        else: streak=0
    wins=[p for p in nets if p>0]; losses=[p for p in nets if p<=0]; gp=sum(wins); gl=abs(sum(losses))
    return {'trades':len(trades),'wins':len(wins),'losses':len(losses),'win_rate_pct':100*len(wins)/len(trades),'starting_equity':start,'ending_equity':eq,
            'net_pnl':sum(nets),'return_pct':100*(eq/start-1),'avg_trade':statistics.mean(nets),'expectancy_r':statistics.mean(rs),'profit_factor':None if gl==0 else gp/gl,
            'max_drawdown_dollars':mdd,'max_drawdown_pct':mddpct,'longest_losing_streak':mx,'avg_contracts':statistics.mean(t['contracts'] for t in trades),
            'exit_counts':{k:sum(t['exit_type']==k for t in trades) for k in ('stop','target','time')}}

def run(path,tick,tick_value,commission_rt,label):
    rows=load_csv(path); cycles=split_cycles(rows); equity=START_EQUITY; trades=[]; skips={}
    for c in cycles:
        t,reason=analyze_cycle(c,equity,tick,tick_value,commission_rt)
        if t: trades.append(t); equity=t['equity_after']
        else: skips[reason]=skips.get(reason,0)+1
    return {'instrument':label,'data_first_utc':rows[0]['dt_utc'].isoformat(),'data_last_utc':rows[-1]['dt_utc'].isoformat(),'cycles':len(cycles),'skips':skips,
            'assumptions':{'starting_equity':START_EQUITY,'risk_pct':RISK_PCT,'max_contracts':MAX_CONTRACTS,'tick_size':tick,'tick_value':tick_value,'commission_round_turn':commission_rt,'slippage_ticks_each_side':SLIP_TICKS},
            'summary':summarize(trades),'trades':trades}

def main():
    ap=argparse.ArgumentParser(); ap.add_argument('csv'); ap.add_argument('--instrument',choices=['M6E','6E'],default='M6E'); ap.add_argument('--json-out'); ap.add_argument('--trades-out'); a=ap.parse_args()
    if a.instrument=='M6E': tick,tv,comm=.00005,.625,1.50
    else: tick,tv,comm=.00005,6.25,4.00
    result=run(a.csv,tick,tv,comm,a.instrument)
    if a.json_out: Path(a.json_out).write_text(json.dumps({k:v for k,v in result.items() if k!='trades'},indent=2))
    if a.trades_out: Path(a.trades_out).write_text(json.dumps(result['trades'],indent=2))
    print(json.dumps({k:v for k,v in result.items() if k!='trades'},indent=2))
if __name__=='__main__': main()
