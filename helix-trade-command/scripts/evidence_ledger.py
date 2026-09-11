#!/usr/bin/env python3
import argparse, hashlib, json, math, os, tempfile
from datetime import datetime, timezone
from pathlib import Path

GENESIS = "0" * 64

def canonical(obj): return json.dumps(obj, sort_keys=True, separators=(",", ":"))
def wilson(w, n):
    if n <= 0: return [None, None]
    z=1.959963984540054; p=w/n; z2=z*z; den=1+z2/n
    c=(p+z2/(2*n))/den; m=z*math.sqrt((p*(1-p)+z2/(4*n))/n)/den
    return [100*(c-m),100*(c+m)]
def gate(w,n):
    lo,_=wilson(w,n); pct=None if n==0 else 100*w/n
    if n<30: return "PROVISIONAL"
    return "PASS" if pct>=55 and lo>50 else "FAIL"
def read_records(path):
    if not path.exists(): return []
    return [json.loads(x) for x in path.read_text().splitlines() if x.strip()]
def verify(records):
    prev=GENESIS
    for i,r in enumerate(records):
        stored=r.get("record_hash"); body={k:v for k,v in r.items() if k!="record_hash"}
        if body.get("prev_hash")!=prev: raise ValueError(f"chain break at {i}")
        calc=hashlib.sha256(canonical(body).encode()).hexdigest()
        if calc!=stored: raise ValueError(f"hash mismatch at {i}")
        prev=stored
    return prev

def atomic_write(path,text):
    path.parent.mkdir(parents=True,exist_ok=True)
    fd,tmp=tempfile.mkstemp(dir=str(path.parent)); os.close(fd); Path(tmp).write_text(text); os.replace(tmp,path)
def main():
    ap=argparse.ArgumentParser(); ap.add_argument("--ledger",required=True); ap.add_argument("--status",required=True); ap.add_argument("--record-json"); ap.add_argument("--verify",action="store_true")
    a=ap.parse_args(); lp=Path(a.ledger); sp=Path(a.status); rows=read_records(lp); tip=verify(rows)
    if a.record_json:
        rec=json.loads(Path(a.record_json).read_text()); day=rec.get("research_day_et")
        if any(x.get("research_day_et")==day for x in rows): raise SystemExit(f"duplicate research day: {day}")
        body={**rec,"captured_at_utc":datetime.now(timezone.utc).isoformat(),"prev_hash":tip}
        body["record_hash"]=hashlib.sha256(canonical(body).encode()).hexdigest(); rows.append(body); tip=body["record_hash"]
        atomic_write(lp,"\n".join(canonical(x) for x in rows)+"\n")
    wins=sum(1 for x in rows if x.get("counted_event") and x.get("success") is True); events=sum(1 for x in rows if x.get("counted_event"))
    pct=None if not events else 100*wins/events; ci=wilson(wins,events)
    status={"hypothesis":"R1-H1","validation_start":"2026-09-12","days_recorded":len(rows),"events":events,"wins":wins,"success_pct":pct,"wilson95":ci,"gate_status":gate(wins,events),"events_remaining":max(0,30-events),"ledger_tip_sha256":tip,"live_trading":False,"updated_at_utc":datetime.now(timezone.utc).isoformat()}
    atomic_write(sp,json.dumps(status,indent=2)+"\n"); print(json.dumps(status,indent=2))
if __name__=="__main__": main()
