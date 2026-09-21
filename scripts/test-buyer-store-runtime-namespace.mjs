import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import assert from 'node:assert/strict';
import {randomBytes,createHash} from 'node:crypto';
import {spawn,spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {writeReleaseEvidence} from '../packages/shared/release-evidence.js';
import {buyerStoreNamespaceBindings} from '../packages/buyer-store/namespace.js';
import {observeBuyerStoreGenerations} from '../packages/buyer-store/runtime-generations.js';
import {OWNED_POSTGRES_TARGET,ownedPostgresProfileDigest} from '../packages/buyer-writer/owned-postgres.js';
import {createBuyerStoreLocalClient} from '../packages/buyer-store/local-client.js';
const node='/opt/nodejs/node-v22.23.1-linux-x64/bin/node',here=fileURLToPath(import.meta.url),repo=path.resolve(path.dirname(here),'..');
const hash=v=>createHash('sha256').update(v).digest('hex'),json=v=>JSON.stringify(v)+'\n';
const exec=(file,args,input)=>spawnSync(file,args,{input,encoding:'utf8',timeout:30000,maxBuffer:65536});
const requireOk=(r,label)=>{assert.equal(r.status,0,label+' failed');return r.stdout.trim();};
if(process.argv[2]==='--inside'){
 const input=JSON.parse(fs.readFileSync(process.argv[3],'utf8')),{root,mappings,uid,gid,groups,configuration,artifact}=input;
 requireOk(exec('/usr/bin/mount',['--make-rprivate','/']),'private mounts');
 for(const [source,destination,writable] of mappings){
  const target=root+destination;fs.mkdirSync(path.dirname(target),{recursive:true});if(fs.statSync(source).isDirectory())fs.mkdirSync(target,{recursive:true});else fs.writeFileSync(target,'');
  requireOk(exec('/usr/bin/mount',['--bind',source,target]),'bind');if(!writable)requireOk(exec('/usr/bin/mount',['-o','remount,bind,ro',target]),'read-only bind');
 }
 fs.mkdirSync(root+'/proc',{recursive:true});requireOk(exec('/usr/bin/mount',['-t','proc','-o','nosuid,nodev,noexec','proc',root+'/proc']),'proc');
 fs.mkdirSync(root+'/dev',{recursive:true});requireOk(exec('/usr/bin/mount',['--bind','/dev',root+'/dev']),'dev');
 fs.mkdirSync(root+'/opt/blackspire-command',{recursive:true});fs.symlinkSync('releases/'+configuration.client.releaseSha,root+'/opt/blackspire-command/current');
 requireOk(exec('/usr/sbin/ip',['link','set','lo','up']),'private loopback');
 const client=createBuyerStoreLocalClient({configuration:configuration.client,connect:()=>net.createConnection({path:root+'/run/blackspire-buyer-store/store.sock'})});
 const launch=async expected=>{
  const daemon=spawn('/usr/sbin/chroot',[root,'/usr/bin/setpriv','--reuid='+uid,'--regid='+gid,'--groups='+groups.join(','),'--no-new-privs',node,artifact+'/scripts/runtime-fixture-driver.mjs'],{env:{PATH:'/usr/bin:/bin'},stdio:['ignore','pipe','pipe']});
  let output='',error='';daemon.stdout.on('data',v=>{output+=v;});daemon.stderr.on('data',v=>{error+=v;});
  try{
   for(let i=0;i<100&&!output.includes('LISTENING');i++){if(daemon.exitCode!==null)break;await new Promise(r=>setTimeout(r,50));}
   assert.equal(output.includes('LISTENING'),true,'nonroot daemon start: '+error.slice(0,200));
   assert.equal(await client.checkAvailability(),expected,'authenticated runtime readiness');
   if(expected){
    const manifestPath=input.sources+'/etc/blackspire-buyer-store/installed.json',before=fs.readFileSync(manifestPath),manifest=JSON.parse(before);
    fs.writeFileSync(manifestPath,json({...manifest,apiGeneration:'f'.repeat(32)}));assert.equal(await client.checkAvailability(),false);fs.writeFileSync(manifestPath,before);
    assert.equal(await client.checkAvailability(),true);
   }
  }finally{
   daemon.kill('SIGTERM');await new Promise(resolve=>{if(daemon.exitCode!==null)return resolve();daemon.once('exit',resolve);setTimeout(()=>{daemon.kill('SIGKILL');},2000).unref();});
  }
 };
 await launch(true);
 // Root mutation is confined to this disposable artifact; a fresh runtime must
 // reject its digest. No production artifact or process is touched.
 fs.appendFileSync(input.sources+artifact+'/packages/buyer-store/runtime-artifact-worker.js','\n');
 await launch(false);
 console.log('PASS: actual nonroot mount+network namespace, full deployed artifact verification, native runtime and authenticated ready IPC, real SCRAM/TLS PostgreSQL, fixed read-only bus generations, generation drift and fresh-start artifact tamper refusal');
}else{
 assert.equal(process.getuid(),0);assert.equal(process.versions.node,'22.23.1');
 const base=fs.mkdtempSync('/run/buyer-runtime-proof-'),owner=randomBytes(16).toString('hex'),name='zola-runtime-proof-'+owner;
 const image=process.env.BUYER_WRITER_TEST_IMAGE;assert.match(image??'',/^postgres@sha256:[a-f0-9]{64}$/);
 let id,network,bridge;const docker=(args,input)=>exec('/usr/bin/docker',args,input);
 try{
  const root=base+'/root',sources=base+'/sources';fs.mkdirSync(root);fs.mkdirSync(sources);
  const user=requireOk(exec('/usr/bin/getent',['passwd','blackspire-buyer-store']),'user').split(':'),uid=Number(user[2]),gid=Number(user[3]);
  const ipc=Number(requireOk(exec('/usr/bin/getent',['group','blackspire-buyer-store-client']),'ipc').split(':')[2]),common=Number(requireOk(exec('/usr/bin/getent',['group','blackspire']),'group').split(':')[2]),groups=[gid,ipc,common];
  requireOk(exec('/usr/bin/openssl',['req','-x509','-newkey','rsa:2048','-nodes','-keyout',base+'/tls.key','-out',base+'/tls.crt','-days','1','-subj','/CN=127.0.0.1','-addext','subjectAltName=IP:127.0.0.1']),'fixture certificate');
  const ca=fs.readFileSync(base+'/tls.crt','utf8');
  network=requireOk(docker(['network','create','--internal','--label','blackspire.test-owner='+owner,name]),'network');
  id=requireOk(docker(['create','--name',name,'--label','blackspire.test-owner='+owner,'--network',network,'--read-only','--memory','256m','--cpus','1','--pids-limit','128','--tmpfs','/var/lib/postgresql/data:rw,size=128m','--tmpfs','/var/run/postgresql:rw,size=8m','--tmpfs','/tmp:rw,size=8m','-e','POSTGRES_USER=blackspire_cluster_admin','-e','POSTGRES_HOST_AUTH_METHOD=trust',image]),'container');requireOk(docker(['start',id]),'start');
  for(let i=0;i<60;i++){if(docker(['exec',id,'pg_isready','-h','127.0.0.1','-U','blackspire_cluster_admin','-d','postgres']).status===0)break;await new Promise(r=>setTimeout(r,100));}
  const meta=JSON.parse(requireOk(docker(['inspect',id]),'inspect'))[0];assert.equal(meta.Config.Labels['blackspire.test-owner'],owner);assert.equal(meta.Mounts.some(m=>m.Type==='bind'||m.Type==='volume'),false);
  const host=Object.values(meta.NetworkSettings.Networks)[0].IPAddress;assert.match(host,/^172\./);
  for(const ext of ['crt','key'])requireOk(docker(['exec','-i',id,'sh','-c','cat > /tmp/tls.'+ext+' && chown postgres:postgres /tmp/tls.'+ext+' && chmod 600 /tmp/tls.'+ext],fs.readFileSync(base+'/tls.'+ext)),'certificate transfer');
  const sql=text=>requireOk(docker(['exec','-i',id,'psql','-h','127.0.0.1','-X','-qAt','-v','ON_ERROR_STOP=1','-U','blackspire_cluster_admin','-d','postgres'],text),'fixture SQL');
  const repositoryPassword=randomBytes(32).toString('base64url'),capabilityPassword=randomBytes(32).toString('base64url');
  sql("CREATE ROLE postgres LOGIN NOSUPERUSER CREATEDB CREATEROLE REPLICATION BYPASSRLS;CREATE ROLE buyer_repository_login LOGIN PASSWORD '"+repositoryPassword+"';CREATE ROLE buyer_capability_login LOGIN PASSWORD '"+capabilityPassword+"';ALTER SYSTEM SET ssl='on';ALTER SYSTEM SET ssl_cert_file='/tmp/tls.crt';ALTER SYSTEM SET ssl_key_file='/tmp/tls.key';");
  requireOk(docker(['exec','-i',id,'sh','-c','cat > /var/lib/postgresql/data/pg_hba.conf'],'local all all trust\nhostssl all buyer_repository_login,buyer_capability_login all scram-sha-256\nhost all all all reject\n'),'HBA');requireOk(docker(['exec',id,'psql','-X','-qAt','-U','blackspire_cluster_admin','-d','postgres','-c','SELECT pg_reload_conf()']),'reload');
  const identity=JSON.parse(requireOk(docker(['exec',id,'psql','-X','-qAt','-U','blackspire_cluster_admin','-d','postgres','-c',"SELECT json_build_object('creatorOid',(SELECT oid::int FROM pg_roles WHERE rolname='postgres'),'systemIdentifier',(pg_control_system()).system_identifier::text)"]),'identity'));
  const releaseSha='a'.repeat(40),artifact='/opt/blackspire-command/releases/'+releaseSha,artifactRoot=sources+artifact;
  fs.mkdirSync(artifactRoot,{recursive:true});fs.cpSync(repo+'/packages',artifactRoot+'/packages',{recursive:true});fs.cpSync(repo+'/node_modules',artifactRoot+'/node_modules',{recursive:true});fs.mkdirSync(artifactRoot+'/scripts');
  fs.writeFileSync(artifactRoot+'/package.json',json({type:'module'}));fs.writeFileSync(artifactRoot+'/COMMIT_SHA',releaseSha+'\n');
  const driver="import fs from 'node:fs';import net from 'node:net';import assert from 'node:assert/strict';import {startBuyerStoreRuntime} from '../packages/buyer-store/runtime.js';assert.notEqual(process.getuid(),0);assert.throws(()=>fs.writeFileSync('/etc/blackspire-buyer-store/runtime.json','forbidden'));assert.throws(()=>fs.readFileSync('/etc/blackspire/command-api.env'));const proxy=net.createServer(s=>{const p=net.connect('/run/blackspire-buyer-store/pg-proxy.sock');s.on('error',()=>p.destroy());p.on('error',()=>s.destroy());s.pipe(p).pipe(s);});await new Promise(r=>proxy.listen(55432,'127.0.0.1',r));const server=await startBuyerStoreRuntime();console.log('LISTENING');process.on('SIGTERM',()=>server.close(()=>proxy.close(()=>process.exit(0))));";
  fs.writeFileSync(artifactRoot+'/scripts/runtime-fixture-driver.mjs',driver);
  const evidence=writeReleaseEvidence(artifactRoot,{commitSha:releaseSha,expectedEnvironment:'production',buildTimestamp:'2026-09-21T00:00:00Z',buildId:'synthetic-runtime',ciProvider:'local-disposable',artifactName:'synthetic',packageVersion:'1.0.0',nodeVersion:'v22.23.1',repository:'synthetic'});
  fs.writeFileSync(artifactRoot+'/.release-complete','');fs.writeFileSync(artifactRoot+'/.deployment-record.json',json({schema:'blackspire-deployment-record',version:1,commitSha:releaseSha,artifactDigest:evidence.artifact.digest,environment:'production',recordedAt:'2026-09-21T00:00:00.000Z'}));
  const profile={version:1,...OWNED_POSTGRES_TARGET,...identity,caSha256:hash(ca)};
  const configuration={version:1,client:{version:1,releaseSha,profileDigest:ownedPostgresProfileDigest(profile),key:randomBytes(32).toString('base64url')},profile,ca,repositoryPassword,capabilityPassword,publicKey:'sb_publishable_fixture',operatorOwnerId:null,ipcGroupId:ipc};
  const [apiGeneration,workerGeneration]=observeBuyerStoreGenerations(),manifest={version:1,kind:'buyer-store-installed',releaseSha,artifactDigest:evidence.artifact.digest,configurationDigest:hash(JSON.stringify(configuration)),runId:'00000000-0000-4000-8000-000000000001',apiGeneration,workerGeneration};
  fs.mkdirSync(sources+'/etc/blackspire-buyer-store',{recursive:true});fs.mkdirSync(sources+'/etc/blackspire/release-admission',{recursive:true});
  for(const [name,value]of [['runtime.json',configuration],['installed.json',manifest]]){const p=sources+'/etc/blackspire-buyer-store/'+name;fs.writeFileSync(p,json(value),{mode:0o640});fs.chownSync(p,0,gid);}
  const ipcPath=sources+'/run/blackspire-buyer-store';fs.mkdirSync(ipcPath,{recursive:true,mode:0o750});fs.chownSync(ipcPath,uid,ipc);
  bridge=net.createServer(socket=>{const db=net.connect({host,port:5432});socket.on('error',()=>db.destroy());db.on('error',()=>socket.destroy());socket.pipe(db).pipe(socket);});await new Promise(r=>bridge.listen(ipcPath+'/pg-proxy.sock',r));fs.chmodSync(ipcPath+'/pg-proxy.sock',0o660);fs.chownSync(ipcPath+'/pg-proxy.sock',uid,ipc);
  const mappings=buyerStoreNamespaceBindings(releaseSha).map(destination=>[destination.startsWith('/etc/blackspire')||destination===artifact?sources+destination:destination,destination,false]);mappings.push([ipcPath,'/run/blackspire-buyer-store',true]);
  const input=base+'/input.json';fs.writeFileSync(input,json({root,sources,mappings,uid,gid,groups,configuration,artifact}),{mode:0o600});
  const child=spawn('/usr/bin/unshare',['--mount','--net','--fork',node,here,'--inside',input],{env:{PATH:'/usr/bin:/bin'},stdio:['ignore','pipe','pipe']});
  let stdout='',stderr='';child.stdout.on('data',x=>stdout+=x);child.stderr.on('data',x=>stderr+=x);const timer=setTimeout(()=>child.kill('SIGKILL'),45000);
  const status=await new Promise(resolve=>child.once('exit',resolve));clearTimeout(timer);assert.equal(status,0,stderr.slice(0,1500));console.log(stdout.trim());
 }finally{
  if(bridge)await new Promise(r=>bridge.close(r));
  if(id){const value=JSON.parse(requireOk(docker(['inspect',id]),'cleanup inspect'))[0];assert.equal(value.Config.Labels['blackspire.test-owner'],owner);requireOk(docker(['rm','-f',id]),'cleanup container');}
  if(network){const value=JSON.parse(requireOk(docker(['network','inspect',network]),'network inspect'))[0];assert.equal(value.Labels['blackspire.test-owner'],owner);requireOk(docker(['network','rm',network]),'cleanup network');}
  fs.rmSync(base,{recursive:true,force:true});
 }
}
