#!/usr/bin/env python3
import argparse, json, os, shutil, subprocess, sys, tempfile, time
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

TZ=ZoneInfo('America/New_York')
ROOT=Path(__file__).resolve().parents[1]
EVID=ROOT/'evidence'; LOG=EVID/'pipeline.log'; TMP=EVID/'latest-observation.json'; STATUS=EVID/'latest-status.json'; LEDGER=EVID/'ledger.jsonl'

def log(msg):
    EVID.mkdir(parents=True,exist_ok=True); line=f"{datetime.now(TZ).isoformat()} {msg}"; print(line); LOG.open('a').write(line+'\n')

def call(cmd, allow=(0,)):
    p=subprocess.run(cmd,capture_output=True,text=True)
    if p.returncode not in allow: raise RuntimeError(f"cmd failed {p.returncode}: {' '.join(cmd)}\n{p.stdout}\n{p.stderr}")
    return p

def publish():
    # Zola reads the runtime status through its read-only server route; no tracked frontend file is mutated.
    return None

def alert(msg):
    log('ALERT '+msg)
    hook=os.getenv('HELIX_ALERT_COMMAND')
    if hook: subprocess.run([hook,msg],check=False)

def main():
    now=datetime.now(TZ); log('prospective pipeline start')
    call([str(ROOT/'scripts/ensure_tradingview_browser.sh')])
    if now.date().isoformat()<'2026-09-12':
        call([sys.executable,str(ROOT/'scripts/evidence_ledger.py'),'--ledger',str(LEDGER),'--status',str(STATUS),'--verify']); publish(); log('pre-validation date; status refreshed only'); return 0
    last=None
    for attempt in range(1,4):
        try:
            p=call([sys.executable,str(ROOT/'scripts/collect_tradingview_evidence.py'),'--out',str(TMP),'--raw-out',str(EVID/'latest-telemetry.json')],allow=(0,10))
            if p.returncode==10: log(f'attempt {attempt}: no finalized day yet'); time.sleep(20); continue
            p=call([sys.executable,str(ROOT/'scripts/evidence_ledger.py'),'--ledger',str(LEDGER),'--status',str(STATUS),'--record-json',str(TMP)],allow=(0,1))
            publish(); log('observation recorded and status published'); return 0
        except Exception as e:
            last=e; log(f'attempt {attempt} failed: {e}'); time.sleep(15)
    alert(f'prospective evidence capture failed after 3 attempts: {last}'); return 1
if __name__=='__main__': raise SystemExit(main())
