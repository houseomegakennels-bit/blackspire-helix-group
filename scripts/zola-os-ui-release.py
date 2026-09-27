#!/usr/bin/env python3
import hashlib,json,os,pathlib,subprocess,sys,time,urllib.request,uuid
SHA='128ea3f775c0de725cbbcbe60b4c2603627b94bd'
PREVIOUS='170f209c53b8950466694988d2274ace6fef1a54'
RECORD=pathlib.Path('/var/lib/blackspire-operator/zola-os-release-20260927')
CONFIG=pathlib.Path('/etc/nginx/sites-available/command.conf')
SOURCE=pathlib.Path('/opt/blackspire-command/releases')/SHA/'apps/jarvis-pwa/public'
DEST=pathlib.Path('/var/www/zola-ui')/SHA
def trusted_read(path):
 st=path.lstat()
 assert path.is_file() and not path.is_symlink() and st.st_uid==0 and st.st_nlink==1 and not st.st_mode&0o022
 return path.read_bytes()
def atomic(path,content,mode=0o600):
 temp=path.with_name(path.name+'.zola-'+str(uuid.uuid4()))
 fd=os.open(temp,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,mode)
 try:
  os.fchmod(fd,mode)
  remaining=memoryview(content)
  while remaining: remaining=remaining[os.write(fd,remaining):]
  os.fsync(fd)
 finally: os.close(fd)
 os.replace(temp,path)
 fd=os.open(path.parent,os.O_RDONLY|os.O_DIRECTORY)
 try: os.fsync(fd)
 finally: os.close(fd)
def fetch(url):
 with urllib.request.urlopen(url,timeout=10) as response: return response.read()
def nginx(*args):
 subprocess.run(['/usr/sbin/nginx',*args],check=True,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
def main():
 assert os.getuid()==0
 result=json.loads(trusted_read(RECORD/'result.json'))
 assert result['status']=='FEATURE_RELEASE_ACTIVE' and result['releaseSha']==SHA
 assert os.path.realpath('/opt/blackspire-command/current')==str(SOURCE.parents[2])
 ready=json.loads(fetch('http://127.0.0.1:8789/ready'))
 assert ready['ok'] is True and all(ready['checks'].values()) and ready['deploymentIdentity']['build']['value']==SHA
 old=trusted_read(CONFIG)
 before=('/var/www/zola-ui/'+PREVIOUS).encode();after=('/var/www/zola-ui/'+SHA).encode()
 assert old.count(before)==15 and after not in old
 assert not (RECORD/'ui-result.json').exists()
 if not DEST.exists():DEST.mkdir(mode=0o755)
 assert DEST.is_dir() and not DEST.is_symlink() and DEST.stat().st_uid==0
 count=0
 for path in SOURCE.iterdir():
  data=trusted_read(path);target=DEST/path.name
  if target.exists():assert trusted_read(target)==data
  else:atomic(target,data,0o644)
  count+=1
 backup=RECORD/'ui-config-before.conf'
 assert not backup.exists()
 atomic(backup,old)
 new=old.replace(before,after)
 try:
  atomic(CONFIG,new,0o644);nginx('-t');nginx('-s','reload')
  for route,name in [('/zola','index.html'),('/zola.css?v=20260927-os1','jarvis.css'),('/zola.js?v=20260927-os1','jarvis.js'),('/zola-icon-180.png','zola-icon-180.png')]:
   expected=trusted_read(SOURCE/name)
   for attempt in range(10):
    if fetch('https://command.blackspirehelix.com'+route)==expected:break
    time.sleep(0.3)
   else:raise RuntimeError('Public UI asset did not match the sealed release')
 except BaseException:
  atomic(CONFIG,old,0o644);nginx('-t');nginx('-s','reload');raise
 proof={'status':'ZOLA_OS_UI_ACTIVE','releaseSha':SHA,'files':count,'aliases':15,'configDigest':hashlib.sha256(new).hexdigest()}
 atomic(RECORD/'ui-result.json',(json.dumps(proof)+'\n').encode())
 print(json.dumps(proof))
if __name__=='__main__':
 if sys.argv[1:]!=['--apply']:raise SystemExit('Use --apply after the verified backend release succeeds')
 main()
