#!/usr/bin/env python3
import argparse,csv,json,math,statistics
from datetime import datetime,timezone
from pathlib import Path
from zoneinfo import ZoneInfo

TZ=ZoneInfo('America/New_York'); TICK=0.0001; TICK_VALUE=1.25; MIN_COVERAGE=.85
EXPECTED={'asia':48,'london':24,'ny':36}; START_EQUITY=50000.0; RISK_PCT=.005; MAX_CONTRACTS=6
COMMISSION_RT=1.50; SLIP_TICKS=1; TARGET_R=2.0

def load_csv(path):
    out=[]
    with open(path,newline='') as f:
        for r in csv.DictReader(f):
            d=datetime.fromisoformat(r['datetime']).replace(tzinfo=timezone.utc)
            out.append({'dt_utc':d,'dt_et':d.astimezone(TZ),'open':float(r['open']),'high':float(r['high']),'low':float(r['low']),'close':float(r['close']),'volume':int(float(r['volume']))})
    return out

def in_asia(r): return r['dt_et'].hour>=20

def in_london(r): return 3<=r['dt_et'].hour<5

def in_ny(r): return 7<=r['dt_et'].hour<10

def split_cycles(rows):
    cycles=[]; cur=[]; active=False; prev_ny=False
    for r in rows:
        a=in_asia(r); n=in_ny(r)
        new_asia=a and (not active or (cur and not in_asia(cur[-1])))
        if new_asia:
            if cur: cycles.append(cur)
            cur=[r]; active=True; prev_ny=n; continue
        if active:
            cur.append(r)
            if prev_ny and not n:
                cycles.append(cur[:-1]); cur=[]; active=False
        prev_ny=n
    return cycles

def session_quality(c):
    counts={'asia':sum(in_asia(x) for x in c),'london':sum(in_london(x) for x in c),'ny':sum(in_ny(x) for x in c)}
    missing=any(counts[k]==0 for k in counts)
    short=(not missing) and any(counts[k] < math.ceil(EXPECTED[k]*MIN_COVERAGE) for k in counts)
    return counts,missing,short

def london_state(c,asia_hi,asia_lo):
    hi=lo=False; hi_ext=None; lo_ext=None
    for b in c:
        if not in_london(b): continue
        if b['high']>=asia_hi+TICK and b['close']<=asia_hi:
            hi=True; hi_ext=b['high'] if hi_ext is None else max(hi_ext,b['high'])
        if b['low']<=asia_lo-TICK and b['close']>=asia_lo:
            lo=True; lo_ext=b['low'] if lo_ext is None else min(lo_ext,b['low'])
    return hi,lo,hi_ext,lo_ext

def size_trade(equity,entry_ref,stop_ref):
    ticks=round(abs(entry_ref-stop_ref)/TICK, 8)
    risk_pc=ticks*TICK_VALUE
    if risk_pc<=0: return 0,risk_pc
    return min(MAX_CONTRACTS,int((equity*RISK_PCT)//risk_pc)),risk_pc

def simulate(direction,entry_ref,stop_ref,target_ref,bars,start_idx,contracts,equity,tag,day):
    entry_fill=entry_ref + direction*TICK*SLIP_TICKS
    exit_type='time'; exit_ref=bars[-1]['close']; exit_bar=bars[-1]
    for b in bars[start_idx:]:
        if direction==1:
            sh=b['low']<=stop_ref; th=b['high']>=target_ref
        else:
            sh=b['high']>=stop_ref; th=b['low']<=target_ref
        if sh:
            exit_type='stop'; exit_ref=stop_ref; exit_bar=b; break
        if th:
            exit_type='target'; exit_ref=target_ref; exit_bar=b; break
    exit_fill=exit_ref - direction*TICK*SLIP_TICKS
    ticks=(exit_fill-entry_fill)/TICK*direction
    gross=ticks*TICK_VALUE*contracts
    commission=COMMISSION_RT*contracts; net=gross-commission
    ref_risk=abs(entry_ref-stop_ref)/TICK*TICK_VALUE*contracts
    return {'variant':tag,'research_day_et':day,'direction':'LONG' if direction==1 else 'SHORT','contracts':contracts,
            'entry_time_et':bars[start_idx]['dt_et'].isoformat(),'entry_ref':entry_ref,'entry_fill':entry_fill,'stop_ref':stop_ref,'target_ref':target_ref,
            'exit_time_et':exit_bar['dt_et'].isoformat(),'exit_type':exit_type,'exit_ref':exit_ref,'exit_fill':exit_fill,'gross_pnl':gross,'commission':commission,
            'net_pnl':net,'r_multiple':(net/ref_risk if ref_risk else None),'equity_before':equity,'equity_after':equity+net,'reference_risk_dollars':ref_risk}

def analyze_cycle(c,equities):
    counts,missing,short=session_quality(c)
    if missing or short: return [],{'excluded':'missing' if missing else 'short','counts':counts}
    asia=[x for x in c if in_asia(x)]; ny=[x for x in c if in_ny(x)]
    asia_hi=max(x['high'] for x in asia); asia_lo=min(x['low'] for x in asia)
    hi,lo,hi_ext,lo_ext=london_state(c,asia_hi,asia_lo)
    if hi==lo: return [],{'excluded':'double_or_none','counts':counts}
    direction=-1 if hi else 1; day=ny[0]['dt_et'].date().isoformat(); trades=[]
    # Variant A
    entry_ref=ny[0]['open']; stop_ref=(hi_ext+TICK) if hi else (lo_ext-TICK)
    valid_stop=(direction==-1 and stop_ref>entry_ref) or (direction==1 and stop_ref<entry_ref)
    if valid_stop:
        contracts,_=size_trade(equities['A'],entry_ref,stop_ref)
        if contracts>0:
            risk=abs(entry_ref-stop_ref); target=entry_ref+direction*TARGET_R*risk
            t=simulate(direction,entry_ref,stop_ref,target,ny,0,contracts,equities['A'],'A',day); trades.append(t); equities['A']=t['equity_after']
    # R1-H1 sequence using full cycle index so swing confirmations match research validator
    last_hi=last_lo=None; sweep_idx=mss_idx=disp_idx=None; mss_level=None; sweep_ext=None; ambiguous=False
    bodies=[abs(x['close']-x['open']) for x in c]
    for i,b in enumerate(c):
        if i>=2:
            p1,p2=c[i-1],c[i-2]
            if p1['high']>p2['high'] and p1['high']>b['high']: last_hi=p1['high']
            if p1['low']<p2['low'] and p1['low']<b['low']: last_lo=p1['low']
        if not in_ny(b): continue
        sweep_hi=b['high']>asia_hi and b['close']<=asia_hi
        sweep_lo=b['low']<asia_lo and b['close']>=asia_lo
        if sweep_hi and sweep_lo:
            ambiguous=True
        if sweep_idx is None and not ambiguous:
            if direction==-1 and sweep_hi: sweep_idx=i; mss_level=last_lo; sweep_ext=b['high']
            elif direction==1 and sweep_lo: sweep_idx=i; mss_level=last_hi; sweep_ext=b['low']
        if sweep_idx is not None and mss_idx is None and mss_level is not None and i>sweep_idx:
            if direction==-1 and b['close']<mss_level: mss_idx=i
            elif direction==1 and b['close']>mss_level: mss_idx=i
        med=statistics.median(bodies[i-20:i]) if i>=20 else None; body=bodies[i]
        disp=(direction==-1 and b['close']<b['open'] and med is not None and body>=1.5*med) or (direction==1 and b['close']>b['open'] and med is not None and body>=1.5*med)
        if mss_idx is not None and disp_idx is None and i>=mss_idx and disp: disp_idx=i
    if not ambiguous and sweep_idx is not None and mss_idx is not None and disp_idx is not None and sweep_idx<mss_idx<=disp_idx:
        next_i=disp_idx+1
        if next_i<len(c) and in_ny(c[next_i]):
            entry_ref=c[next_i]['open']; stop_ref=(sweep_ext+TICK) if direction==-1 else (sweep_ext-TICK)
            valid_stop=(direction==-1 and stop_ref>entry_ref) or (direction==1 and stop_ref<entry_ref)
            if valid_stop:
                contracts,_=size_trade(equities['R1'],entry_ref,stop_ref)
                if contracts>0:
                    risk=abs(entry_ref-stop_ref); target=entry_ref+direction*TARGET_R*risk
                    ny_start_idx=next(j for j,x in enumerate(c) if in_ny(x)); start_in_ny=next_i-ny_start_idx
                    t=simulate(direction,entry_ref,stop_ref,target,ny,start_in_ny,contracts,equities['R1'],'R1-H1',day); trades.append(t); equities['R1']=t['equity_after']
    return trades,{'counts':counts,'candidate':True}

def summarize(trades,start=START_EQUITY):
    if not trades: return {'trades':0,'starting_equity':start,'ending_equity':start}
    nets=[t['net_pnl'] for t in trades]; rs=[t['r_multiple'] for t in trades if t['r_multiple'] is not None]
    wins=[x for x in nets if x>0]; losses=[x for x in nets if x<=0]
    equity=start; peak=start; maxdd=0.0; maxddpct=0.0; streak=mxstreak=0
    for p in nets:
        equity+=p; peak=max(peak,equity); dd=peak-equity; maxdd=max(maxdd,dd); maxddpct=max(maxddpct,(dd/peak*100 if peak else 0))
        if p<=0: streak+=1; mxstreak=max(mxstreak,streak)
        else: streak=0
    gp=sum(wins); gl=abs(sum(losses)); exits={k:sum(t['exit_type']==k for t in trades) for k in ('stop','target','time')}
    return {'trades':len(trades),'wins':len(wins),'losses':len(losses),'win_rate_pct':100*len(wins)/len(trades),'starting_equity':start,'ending_equity':equity,
            'net_pnl':sum(nets),'return_pct':100*(equity/start-1),'avg_trade':statistics.mean(nets),'avg_r':statistics.mean(rs) if rs else None,'expectancy_r':statistics.mean(rs) if rs else None,
            'gross_profit':gp,'gross_loss':gl,'profit_factor':(gp/gl if gl else None),'max_drawdown_dollars':maxdd,'max_drawdown_pct':maxddpct,
            'longest_losing_streak':mxstreak,'avg_contracts':statistics.mean(t['contracts'] for t in trades),'exit_counts':exits}

def main():
    ap=argparse.ArgumentParser(); ap.add_argument('csv'); ap.add_argument('--json-out'); ap.add_argument('--trades-out'); a=ap.parse_args()
    rows=load_csv(a.csv); cycles=split_cycles(rows); eq={'A':START_EQUITY,'R1':START_EQUITY}; alltr=[]; exclusions={}
    for c in cycles:
        ts,meta=analyze_cycle(c,eq); alltr.extend(ts); key=meta.get('excluded')
        if key: exclusions[key]=exclusions.get(key,0)+1
    by={v:[t for t in alltr if t['variant']==v] for v in ('A','R1-H1')}
    result={'spec':'london-backtest-v1','data_first_utc':rows[0]['dt_utc'].isoformat(),'data_last_utc':rows[-1]['dt_utc'].isoformat(),'cycles':len(cycles),'exclusions':exclusions,
            'assumptions':{'starting_equity':START_EQUITY,'risk_pct':RISK_PCT,'max_contracts':MAX_CONTRACTS,'commission_round_turn_per_contract':COMMISSION_RT,'slippage_ticks_each_side':SLIP_TICKS,'target_r':TARGET_R},
            'variant_A':summarize(by['A']),'variant_R1_H1':summarize(by['R1-H1'])}
    if a.json_out: Path(a.json_out).write_text(json.dumps(result,indent=2))
    if a.trades_out: Path(a.trades_out).write_text(json.dumps(alltr,indent=2))
    print(json.dumps(result,indent=2))

if __name__=='__main__': main()
