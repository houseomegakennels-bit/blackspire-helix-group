#!/usr/bin/env python3
import os,subprocess,sys,time
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

TZ=ZoneInfo('America/New_York'); ROOT=Path(__file__).resolve().parents[1]; E=ROOT/'evidence'/'v2'; LOG=E/'pipeline.log'; TMP=E/'latest-observation.json'; STATUS=E/'latest-status.json'; LEDGER=E/'ledger.jsonl'
def log(m): E.mkdir(parents=True,exist_ok=True); line=f'{datetime.now(TZ).isoformat()} {m}'; print(line); LOG.open('a').write(line+'\n')
def call(cmd,allow=(0,)):
    p=subprocess.run(cmd,capture_output=True,text=True)
    if p.returncode not in allow: raise RuntimeError(f"cmd failed {p.returncode}: {' '.join(cmd)}\n{p.stdout}\n{p.stderr}")
    return p
def alert(m):
    log('ALERT '+m); hook=os.getenv('HELIX_ALERT_COMMAND')
    if hook: subprocess.run([hook,m],check=False)
def main():
    now=datetime.now(TZ); log('V2 prospective pipeline start'); call([str(ROOT/'scripts/ensure_tradingview_browser.sh')])
    if now.date().isoformat()<'2026-09-12':
        call([sys.executable,str(ROOT/'scripts/v2_evidence_ledger.py'),'--ledger',str(LEDGER),'--status',str(STATUS),'--verify']); log('pre-validation date; status refreshed only'); return 0
    last=None
    for attempt in range(1,4):
        try:
            p=call([sys.executable,str(ROOT/'scripts/collect_tradingview_v2_evidence.py'),'--out',str(TMP),'--raw-out',str(E/'latest-telemetry.json')],allow=(0,10))
            if p.returncode==10: log(f'attempt {attempt}: no finalized V2 day yet'); time.sleep(20); continue
            call([sys.executable,str(ROOT/'scripts/v2_evidence_ledger.py'),'--ledger',str(LEDGER),'--status',str(STATUS),'--record-json',str(TMP)],allow=(0,1)); log('V2 observation recorded'); return 0
        except Exception as ex: last=ex; log(f'attempt {attempt} failed: {ex}'); time.sleep(15)
    alert(f'V2 evidence capture failed after 3 attempts: {last}'); return 1
if __name__=='__main__': raise SystemExit(main())
