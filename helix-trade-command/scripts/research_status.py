#!/usr/bin/env python3
import json, sys
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]; status=ROOT/'evidence'/'latest-status.json'; robust=ROOT/'evidence'/'latest-6e-robustness.json'
obj={'primary':json.loads(status.read_text()) if status.exists() else None,'robustness_6e':json.loads(robust.read_text()) if robust.exists() else None}
print(json.dumps(obj,indent=2))
