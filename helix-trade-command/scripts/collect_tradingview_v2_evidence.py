#!/usr/bin/env python3
import argparse,json,re,subprocess,time
from pathlib import Path

REASON={0:'not_yet_recorded',1:'no_single_sweep',2:'missing_session',3:'short_session',4:'double_sweep',5:'no_mss',6:'no_displacement_fvg',7:'no_fill_or_invalid_trade',8:'counted_trade',9:'wrong_timeframe'}
FIELDS=['V2_DAY_KEY','V2_REASON_CODE','V2_CANDIDATE','V2_COUNTED_TRADE','V2_WIN','V2_R_MULTIPLE','V2_NET_PNL','V2_TRADES','V2_WINS','V2_EXPECTANCY_R','V2_MEAN_R_LOWER95','V2_PROFIT_FACTOR','V2_GATE_CODE','V2_DAYS_RECORDED']

def run(*args,timeout=30): return subprocess.run(args,capture_output=True,text=True,timeout=timeout,check=True).stdout

def data_window_text(port):
    run('npx','-y','agent-browser','connect',str(port),timeout=20)
    snap=run('npx','-y','agent-browser','snapshot','-i',timeout=20)
    if 'tab "Data window" [selected' not in snap:
        m=re.search(r'button "Object tree and data window" \[ref=(e\d+)\]',snap)
        if m: run('npx','-y','agent-browser','click','@'+m.group(1),timeout=20); time.sleep(.7)
        snap=run('npx','-y','agent-browser','snapshot','-i',timeout=20)
        m=re.search(r'tab "Data window"(?: \[selected)? \[ref=(e\d+)\]',snap)
        if m and '[selected' not in m.group(0): run('npx','-y','agent-browser','click','@'+m.group(1),timeout=20); time.sleep(.7)
    return run('npx','-y','agent-browser','read',timeout=20)

def parse(text):
    if 'Helix London V2 Prospective Collector' not in text: raise RuntimeError('V2 collector not visible in TradingView Data Window')
    vals={}
    for f in FIELDS:
        m=re.search(re.escape(f)+r'\s+([−-]?\d+(?:\.\d+)?|∅)',text)
        if not m: raise RuntimeError(f'missing telemetry field {f}')
        raw=m.group(1).replace('−','-'); vals[f]=None if raw=='∅' else float(raw)
    day=int(vals['V2_DAY_KEY'] or 0)
    if day<=0: return None,vals
    ds=str(day)
    if len(ds)!=8: raise RuntimeError(f'invalid day key {day}')
    reason=int(vals['V2_REASON_CODE']); win=int(vals['V2_WIN'])
    rec={'research_day_et':f'{ds[:4]}-{ds[4:6]}-{ds[6:8]}','source':'TradingView M6E1! 5m Data Window telemetry','hypothesis':'LONDON-V2','instrument':'M6E1!','timeframe_minutes':5,
         'reason_code':reason,'reason':REASON.get(reason,'unknown'),'candidate':bool(int(vals['V2_CANDIDATE'])),'counted_trade':bool(int(vals['V2_COUNTED_TRADE'])),'win':None if win<0 else bool(win),
         'r_multiple':vals['V2_R_MULTIPLE'],'net_pnl':vals['V2_NET_PNL'],'tradingview_cumulative_trades':int(vals['V2_TRADES']),'tradingview_cumulative_wins':int(vals['V2_WINS']),
         'tradingview_expectancy_r':vals['V2_EXPECTANCY_R'],'tradingview_mean_r_lower95':vals['V2_MEAN_R_LOWER95'],'tradingview_profit_factor':vals['V2_PROFIT_FACTOR'],'tradingview_gate_code':int(vals['V2_GATE_CODE']),'tradingview_days_recorded':int(vals['V2_DAYS_RECORDED'])}
    return rec,vals

def main():
    ap=argparse.ArgumentParser(); ap.add_argument('--port',type=int,default=9222); ap.add_argument('--out',required=True); ap.add_argument('--raw-out'); a=ap.parse_args()
    text=data_window_text(a.port); rec,vals=parse(text)
    if a.raw_out: Path(a.raw_out).write_text(json.dumps(vals,indent=2)+'\n')
    if rec is None: print(json.dumps({'status':'no_finalized_validation_day','telemetry':vals},indent=2)); return 10
    Path(a.out).parent.mkdir(parents=True,exist_ok=True); Path(a.out).write_text(json.dumps(rec,indent=2)+'\n'); print(json.dumps(rec,indent=2)); return 0
if __name__=='__main__': raise SystemExit(main())
