#!/usr/bin/env python3
import argparse, hashlib, json, math, os, statistics, tempfile
from datetime import datetime, timezone
from pathlib import Path

GENESIS='0'*64

def canonical(x): return json.dumps(x,sort_keys=True,separators=(',',':'))
def read_rows(p): return [] if not p.exists() else [json.loads(x) for x in p.read_text().splitlines() if x.strip()]
def verify(rows):
    prev=GENESIS
    for i,r in enumerate(rows):
        stored=r.get('record_hash'); body={k:v for k,v in r.items() if k!='record_hash'}
        if body.get('prev_hash')!=prev: raise ValueError(f'chain break at {i}')
        calc=hashlib.sha256(canonical(body).encode()).hexdigest()
        if calc!=stored: raise ValueError(f'hash mismatch at {i}')
        prev=stored
    return prev

def atomic_write(p,text):
    p.parent.mkdir(parents=True,exist_ok=True); fd,tmp=tempfile.mkstemp(dir=str(p.parent)); os.close(fd); Path(tmp).write_text(text); os.replace(tmp,p)
def stats(rows):
    trades=[r for r in rows if r.get('counted_trade')]
    rs=[float(r['r_multiple']) for r in trades if r.get('r_multiple') is not None]
    pnls=[float(r['net_pnl']) for r in trades if r.get('net_pnl') is not None]
    n=len(rs); wins=sum(x>0 for x in pnls); mean=(statistics.mean(rs) if rs else None)
    lower=None
    if n>=2:
        sd=statistics.stdev(rs); lower=mean-1.959963984540054*sd/math.sqrt(n)
    gp=sum(x for x in pnls if x>0); gl=abs(sum(x for x in pnls if x<=0)); pf=(gp/gl if gl else (999.0 if gp>0 else None))
    status='PROVISIONAL'
    if n>=30:
        status='PASS' if mean is not None and mean>0.10 and lower is not None and lower>0 and pf is not None and pf>=1.25 else 'FAIL'
    return n,wins,mean,lower,pf,sum(pnls)
def main():
    ap=argparse.ArgumentParser(); ap.add_argument('--ledger',required=True); ap.add_argument('--status',required=True); ap.add_argument('--record-json'); ap.add_argument('--verify',action='store_true')
    a=ap.parse_args(); lp=Path(a.ledger); sp=Path(a.status); rows=read_rows(lp); tip=verify(rows)
    if a.record_json:
        rec=json.loads(Path(a.record_json).read_text()); day=rec.get('research_day_et')
        if any(x.get('research_day_et')==day for x in rows): raise SystemExit(f'duplicate research day: {day}')
        body={**rec,'captured_at_utc':datetime.now(timezone.utc).isoformat(),'prev_hash':tip}; body['record_hash']=hashlib.sha256(canonical(body).encode()).hexdigest(); rows.append(body); tip=body['record_hash']
        atomic_write(lp,'\n'.join(canonical(x) for x in rows)+'\n')
    n,wins,mean,lower,pf,net=stats(rows)
    gate='PROVISIONAL' if n<30 else ('PASS' if mean is not None and mean>0.10 and lower is not None and lower>0 and pf is not None and pf>=1.25 else 'FAIL')
    status={'hypothesis':'LONDON-V2','validation_start':'2026-09-12','days_recorded':len(rows),'trades':n,'wins':wins,'expectancy_r':mean,'mean_r_lower95':lower,'profit_factor':pf,'net_pnl':net,'gate_status':gate,'trades_remaining':max(0,30-n),'ledger_tip_sha256':tip,'live_trading':False,'broker_execution_authorized':False,'updated_at_utc':datetime.now(timezone.utc).isoformat()}
    atomic_write(sp,json.dumps(status,indent=2,allow_nan=False)+'\n'); print(json.dumps(status,indent=2,allow_nan=False))
if __name__=='__main__': main()
