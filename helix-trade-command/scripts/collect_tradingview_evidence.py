#!/usr/bin/env python3
import argparse, json, os, re, subprocess, sys, tempfile, time
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

TZ=ZoneInfo('America/New_York')
REASON={0:'not_yet_recorded',1:'no_single_london_sweep',2:'missing_session',3:'short_session',4:'double_london_sweep',5:'ambiguous_ny_bar',6:'candidate_without_full_ny_sequence',7:'counted_event',8:'wrong_timeframe'}
FIELDS=['HELIX_DAY_KEY','HELIX_REASON_CODE','HELIX_CANDIDATE','HELIX_COUNTED_EVENT','HELIX_SUCCESS','HELIX_EVENTS','HELIX_WINS','HELIX_SUCCESS_PCT','HELIX_WILSON_LO','HELIX_GATE_CODE','HELIX_DAYS_RECORDED']

def run(*args, timeout=30):
    return subprocess.run(args,capture_output=True,text=True,timeout=timeout,check=True).stdout

def ensure_connected(port):
    run('npx','-y','agent-browser','connect',str(port),timeout=20)

def get_data_window_text():
    # Open Data Window if needed, then read visible page text. We parse only the collector row.
    snap=run('npx','-y','agent-browser','snapshot','-i',timeout=20)
    if 'tab "Data window" [selected' not in snap:
        m=re.search(r'button "Object tree and data window" \[ref=(e\d+)\]',snap)
        if m: run('npx','-y','agent-browser','click','@'+m.group(1),timeout=20); time.sleep(.7)
        snap=run('npx','-y','agent-browser','snapshot','-i',timeout=20)
        m=re.search(r'tab "Data window"(?: \[selected)? \[ref=(e\d+)\]',snap)
        if m and '[selected' not in m.group(0): run('npx','-y','agent-browser','click','@'+m.group(1),timeout=20); time.sleep(.7)
    return run('npx','-y','agent-browser','read',timeout=20)

def parse(text):
    if 'Helix R1-H1 Prospective Collector' not in text: raise RuntimeError('collector indicator not visible in TradingView Data Window')
    vals={}
    for f in FIELDS:
        p=re.compile(re.escape(f)+r'\s+([−-]?\d+(?:\.\d+)?|∅)')
        m=p.search(text)
        if not m: raise RuntimeError(f'missing telemetry field {f}')
        raw=m.group(1).replace('−','-')
        vals[f]=None if raw=='∅' else float(raw)
    day=int(vals['HELIX_DAY_KEY'] or 0)
    if day<=0: return None, vals
    ds=str(day)
    if len(ds)!=8: raise RuntimeError(f'invalid day key {day}')
    reason=int(vals['HELIX_REASON_CODE'])
    success_raw=int(vals['HELIX_SUCCESS'])
    record={
      'research_day_et':f'{ds[:4]}-{ds[4:6]}-{ds[6:8]}',
      'source':'TradingView M6E1! 5m Data Window telemetry',
      'hypothesis':'R1-H1','instrument':'M6E1!','timeframe_minutes':5,
      'reason_code':reason,'reason':REASON.get(reason,'unknown'),
      'candidate':bool(int(vals['HELIX_CANDIDATE'])),
      'counted_event':bool(int(vals['HELIX_COUNTED_EVENT'])),
      'success': None if success_raw<0 else bool(success_raw),
      'tradingview_cumulative_events':int(vals['HELIX_EVENTS']),
      'tradingview_cumulative_wins':int(vals['HELIX_WINS']),
      'tradingview_gate_code':int(vals['HELIX_GATE_CODE']),
      'tradingview_days_recorded':int(vals['HELIX_DAYS_RECORDED'])
    }
    return record, vals

def main():
    ap=argparse.ArgumentParser(); ap.add_argument('--port',type=int,default=9222); ap.add_argument('--out',required=True); ap.add_argument('--raw-out')
    a=ap.parse_args(); ensure_connected(a.port); text=get_data_window_text(); record, vals=parse(text)
    if a.raw_out: Path(a.raw_out).write_text(json.dumps(vals,indent=2)+'\n')
    if record is None:
        print(json.dumps({'status':'no_finalized_validation_day','telemetry':vals},indent=2)); return 10
    Path(a.out).parent.mkdir(parents=True,exist_ok=True); Path(a.out).write_text(json.dumps(record,indent=2)+'\n'); print(json.dumps(record,indent=2))
    return 0
if __name__=='__main__': raise SystemExit(main())
