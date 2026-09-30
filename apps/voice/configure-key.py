#!/usr/bin/env python3
"""Interactive server-only credential installation. Never prints the key."""
import getpass, os, re, json, urllib.request, urllib.error, subprocess, tempfile
from pathlib import Path
if os.geteuid()!=0: raise SystemExit('Run with sudo.')
print('Zola live voice uses a separately billed OpenAI API project.')
print('Limits: 5 minutes per session, 6 session starts per UTC day. No automatic refill.')
key=getpass.getpass('OpenAI project API key (hidden): ').strip()
if not re.fullmatch(r'sk-[A-Za-z0-9_-]{20,300}', key): raise SystemExit('Key format is invalid. No change made.')
try:
 req=urllib.request.Request('https://api.openai.com/v1/models/gpt-realtime-mini',headers={'Authorization':'Bearer '+key})
 with urllib.request.urlopen(req,timeout=15) as response: json.load(response)
except Exception:
 raise SystemExit('Provider access could not be verified. No change made; check the project key and model access.')
directory=Path('/etc/blackspire')
fd,temporary=tempfile.mkstemp(prefix='.voice-',dir=directory)
try:
 os.fchmod(fd,0o600)
 with os.fdopen(fd,'w') as file:
  file.write('OPENAI_API_KEY='+key+'\n');file.flush();os.fsync(file.fileno())
 os.replace(temporary,directory/'voice.env')
finally:
 if os.path.exists(temporary):os.unlink(temporary)
del key
subprocess.run(['systemctl','restart','blackspire-voice.service'],check=True)
print('Voice credential installed. Open Zola and tap Talk to Zola for the first audio test.')
