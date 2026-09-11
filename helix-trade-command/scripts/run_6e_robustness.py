#!/usr/bin/env python3
import json, subprocess, sys
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo
ROOT=Path(__file__).resolve().parents[1]; OUT=ROOT/'evidence'/'latest-6e-robustness.json'; TZ=ZoneInfo('America/New_York')
# Robustness is deliberately separate from the primary M6E ledger. If a local 6E CSV is present, run the frozen R1 validator; otherwise record unavailability without affecting the primary gate.
def main():
    candidates=[Path('/root/helix-data/6E_5min_20260308_20260415.csv')]
    src=next((p for p in candidates if p.exists()),None)
    payload={'updated_at_et':datetime.now(TZ).isoformat(),'instrument':'6E','role':'robustness_only','affects_primary_gate':False}
    if not src: payload.update(status='NO_DATA'); OUT.write_text(json.dumps(payload,indent=2)+'\n'); return 0
    tmp=ROOT/'evidence'/'_6e_tmp.json'
    p=subprocess.run([sys.executable,str(ROOT/'scripts/r1_h1_validator.py'),str(src),'--mintick','0.0001','--validation-start','2026-09-12','--json-out',str(tmp)],capture_output=True,text=True)
    latest=datetime.fromisoformat('2026-04-15T23:25:00+00:00') if src.name=='6E_5min_20260308_20260415.csv' else None
    payload['status']='STALE_DATA' if latest and latest.astimezone(TZ).date().isoformat()<'2026-09-12' else ('OK' if p.returncode==0 else 'ERROR'); payload['source']=str(src); payload['stdout']=p.stdout[-2000:]
    if latest: payload['latest_source_utc']=latest.isoformat()
    if tmp.exists(): payload['result']=json.loads(tmp.read_text()); tmp.unlink()
    OUT.parent.mkdir(parents=True,exist_ok=True); OUT.write_text(json.dumps(payload,indent=2)+'\n'); return 0 if p.returncode==0 else 1
if __name__=='__main__': raise SystemExit(main())
