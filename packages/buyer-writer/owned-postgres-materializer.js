import fs from 'node:fs';
import pg from 'pg';
import {databaseTlsOptions} from './database-profile.js';
import {OWNED_DATABASE_BOUNDARY_SQL,verifyOwnedDatabaseBoundary} from './owned-database-evidence.js';
import path from 'node:path';
import {createHash,randomUUID,randomBytes,X509Certificate,createPrivateKey} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {readReleaseProtectedBytes,verifyReleaseSource} from '../zola-release/commander-host.js';
import {openReleaseJournal} from '../zola-release/commander-journal.js';
import * as owned from './owned-postgres.js';

const ROOT='/var/lib/blackspire-operator/owned-postgres-materialization';
const CONFIG='/etc/blackspire/owned-postgres';
const DATA_ROOT='/mnt/blackspire-builds/zola-owned-postgres';
const SERVER=CONFIG+'/server';
const NAME='blackspire-owned-postgres';
const INIT=NAME+'-bootstrap';
const UNIT='/etc/systemd/system/blackspire-owned-postgres.service';
const PROXY='/etc/systemd/system/blackspire-owned-postgres-proxy';
const hash=v=>createHash('sha256').update(typeof v==='string'||Buffer.isBuffer(v)?v:JSON.stringify(v)).digest('hex');
const fail=()=>{throw new Error('Owned PostgreSQL materialization blocked; retain protected evidence');};
const sync=p=>{const fd=fs.openSync(p,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);try{fs.fsyncSync(fd);}finally{fs.closeSync(fd);}};
function directory(p,mode=0o700,uid=0){const s=fs.lstatSync(p);if(!s.isDirectory()||s.isSymbolicLink()||s.uid!==uid||(s.mode&0o7777)!==mode)fail();}
function ancestors(p){for(let q=p;;q=path.dirname(q)){const s=fs.lstatSync(q);if(!s.isDirectory()||s.isSymbolicLink()||s.uid!==0||(s.mode&0o022))fail();if(q==='/')break;}}
function write(p,value,mode=0o600,uid=0,gid=0){const fd=fs.openSync(p,fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_NOFOLLOW,mode);try{fs.writeFileSync(fd,value);fs.fchownSync(fd,uid,gid);fs.fchmodSync(fd,mode);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}sync(path.dirname(p));}
function read(p){return JSON.parse(readReleaseProtectedBytes(p,2*1024*1024));}
function optional(p){try{return read(p);}catch(e){if(!fs.existsSync(p))return null;throw e;}}
function run(program,args,input){try{return execFileSync(program,args,{input,encoding:'utf8',timeout:90000,maxBuffer:1048576,stdio:['pipe','pipe','pipe'],env:{PATH:'/usr/bin:/bin',LANG:'C',LC_ALL:'C'}}).trim();}catch{fail();}}
const docker=(args,input)=>run('/usr/bin/docker',args,input);
function inspect(kind,name){try{return JSON.parse(docker(kind==='network'?['network','inspect',name]:['inspect',name]))[0];}catch{
 // A list observation distinguishes true absence from a broken Docker daemon.
 const names=docker(kind==='network'?['network','ls','--format','{{.Name}}']:['ps','-a','--format','{{.Names}}']).split('\n');if(names.includes(name))fail();return null;
}}
function fileProof(p,{uid=0,gid=uid,mode=0o600}={}){const s=fs.lstatSync(p);if(!s.isFile()||s.isSymbolicLink()||s.nlink!==1||s.uid!==uid||s.gid!==gid||(s.mode&0o7777)!==mode)fail();return{sha256:hash(fs.readFileSync(p)),size:s.size,uid,mode};}

// A durable intent is a no-replay boundary. Unknown partial effects always stop;
// only a complete independently observed result may close an interrupted stage.
export async function runOwnedMaterializationStages({stages,load,save,binding}){
 for(const stage of stages){
  const intent=load(stage.name+'.intent'),result=load(stage.name+'.result');
  if(result&&!intent)fail();
  if(intent&&JSON.stringify(intent)!==JSON.stringify({version:1,binding,stage:stage.name}))fail();
  if(result){if(Object.keys(result).sort().join(',')!=='binding,proof,stage,version'||result.version!==1||result.binding!==binding||result.stage!==stage.name||!result.proof)fail();if(stage.historical===true)continue;const observed=await stage.observe();if(!observed||JSON.stringify(result)!==JSON.stringify({version:1,binding,stage:stage.name,proof:observed}))fail();continue;}
  if(intent){const observed=await stage.observe();if(!observed)fail();save(stage.name+'.result',{version:1,binding,stage:stage.name,proof:observed});continue;}
  await stage.before();save(stage.name+'.intent',{version:1,binding,stage:stage.name});
  await stage.apply();const observed=await stage.observe();if(!observed)fail();
  save(stage.name+'.result',{version:1,binding,stage:stage.name,proof:observed});
 }
 return{status:'OWNED_POSTGRES_MATERIALIZED',binding};
}

export async function materializeOwnedPostgres({releaseSha}){
 if(process.getuid?.()!==0||process.getgid?.()!==0||process.versions.node!=='22.23.1')fail();
 verifyReleaseSource(releaseSha);
 const guard=openReleaseJournal();
 try{
  verifyReleaseSource(releaseSha);
  for(const unit of ['blackspire-command.service','blackspire-command-worker.service','blackspire-buyer-writer-gateway.service']){
   const v=run('/usr/bin/systemctl',['show',unit,'--property=ActiveState,SubState,MainPID,LoadState','--value']).split('\n');
   if(!v.includes('loaded')||!v.includes('inactive')||!v.includes('dead')||!v.includes('0'))fail();
  }
  ancestors(path.dirname(ROOT));ancestors(path.dirname(CONFIG));ancestors(path.dirname(DATA_ROOT));
  if(!fs.existsSync(ROOT)){fs.mkdirSync(ROOT,{mode:0o700});sync(path.dirname(ROOT));}directory(ROOT);
  let state=optional(ROOT+'/state.json');
  if(!state){
   if(fs.readdirSync(ROOT).length!==0)fail();
   for(const p of [CONFIG,DATA_ROOT,UNIT,PROXY+'.service',PROXY+'.socket'])if(fs.existsSync(p))fail();
   if(inspect('network',NAME)||inspect('container',NAME)||inspect('container',INIT)||inspect('container',NAME+'-initdb'))fail();
   if(fs.statSync('/mnt/blackspire-builds').dev===fs.statSync('/').dev)fail();
   const volume=fs.statfsSync('/mnt/blackspire-builds');if(volume.bavail*volume.bsize<8*1024**3)fail();
   const image=JSON.parse(docker(['image','inspect',owned.OWNED_POSTGRES_TARGET.image]))[0];
   if(!image.RepoDigests.includes(owned.OWNED_POSTGRES_TARGET.image))fail();
   state={version:1,releaseSha,operationId:randomUUID(),imageId:image.Id};write(ROOT+'/state.json',JSON.stringify(state)+'\n');
  }
  if(Object.keys(state).sort().join(',')!=='imageId,operationId,releaseSha,version'||state.version!==1||state.releaseSha!==releaseSha||!(/^[a-f0-9-]{36}$/).test(state.operationId)||!(/^sha256:[a-f0-9]{64}$/).test(state.imageId))fail();
  const cleanUnit=name=>{if(run('/usr/bin/systemctl',['show',name,'--property=DropInPaths','--value'])!=='')fail();};
  const binding=hash(state),label='blackspire.materialization='+state.operationId;
  const load=name=>optional(ROOT+'/'+name+'.json'),save=(name,value)=>write(ROOT+'/'+name+'.json',JSON.stringify(value)+'\n');
  const network=()=>{const n=inspect('network',NAME);if(!n)return null;if(n.Internal!==true||n.Driver!=='bridge'||n.Labels?.['blackspire.materialization']!==state.operationId)fail();
   for(const c of Object.values(n.Containers??{}))if(c.Name!==NAME)fail();return{id:n.Id,internal:true};};
  const directories=()=>{if(!fs.existsSync(CONFIG)||!fs.existsSync(owned.OWNED_POSTGRES_DATA_PATH)||!fs.existsSync(SERVER))return null;
   directory(CONFIG);directory(SERVER,0o755);directory(DATA_ROOT);directory(owned.OWNED_POSTGRES_DATA_PATH,0o700,70);return{config:CONFIG,data:owned.OWNED_POSTGRES_DATA_PATH};};
  const tls=()=>{if(!fs.existsSync(SERVER+'/server.crt')||!fs.existsSync(SERVER+'/server.key')||!fs.existsSync(ROOT+'/ca.crt'))return null;
   const cert=new X509Certificate(fs.readFileSync(SERVER+'/server.crt')),ca=new X509Certificate(fs.readFileSync(ROOT+'/ca.crt'));
   const key=createPrivateKey(fs.readFileSync(SERVER+'/server.key'));if(cert.checkIP('127.0.0.1')!=='127.0.0.1'||!cert.verify(ca.publicKey)||!cert.checkPrivateKey(key)||Date.parse(cert.validTo)<=Date.now()+86400000)fail();
   const files={};for(const name of ['postgresql.conf','pg_hba.conf','pg_ident.conf','server.crt'])files[name]=fileProof(SERVER+'/'+name,{mode:0o644});
   files['server.key']=fileProof(SERVER+'/server.key',{uid:70,mode:0o600});files.ca=fileProof(ROOT+'/ca.crt');
   for(const [name,value] of [['postgresql.conf',owned.OWNED_POSTGRES_CONFIGURATION],['pg_hba.conf',owned.OWNED_POSTGRES_HBA],['pg_ident.conf',owned.OWNED_POSTGRES_IDENT]])if(files[name].sha256!==hash(value))fail();return files;};
  const container=(name,bootstrap=false)=>{const c=inspect('container',name);if(!c)return null;
   const h=c.HostConfig,image=JSON.parse(docker(['image','inspect',owned.OWNED_POSTGRES_TARGET.image]))[0];
   if(JSON.stringify(c.Config.Cmd)!==JSON.stringify(['postgres','-D','/var/lib/postgresql/data','-c','config_file=/etc/zola-postgres/postgresql.conf'])||JSON.stringify(c.Config.Entrypoint)!==JSON.stringify(image.Config.Entrypoint)||JSON.stringify(c.Config.Env)!==JSON.stringify(image.Config.Env)||h.LogConfig.Type!=='local'||h.LogConfig.Config['max-size']!=='10m'||h.LogConfig.Config['max-file']!=='3')fail();
   if(c.Config.Labels?.['blackspire.materialization']!==state.operationId||c.Image!==state.imageId||c.Config.User!=='70:70'||!h.ReadonlyRootfs||h.Memory!==768*1024**2||h.PidsLimit!==128||h.NanoCpus!==1000000000||h.NetworkMode!==(bootstrap?'none':NAME)||h.Privileged||h.CapAdd?.length||!h.CapDrop?.includes('ALL')||!h.SecurityOpt?.includes('no-new-privileges'))fail();
   const mounts=c.Mounts.filter(m=>m.Type==='bind');if(mounts.length!==2||!mounts.some(m=>m.Source===owned.OWNED_POSTGRES_DATA_PATH&&m.Destination==='/var/lib/postgresql/data'&&m.RW)||!mounts.some(m=>m.Source===SERVER&&m.Destination==='/etc/zola-postgres'&&!m.RW))fail();
   if(Object.keys(h.PortBindings??{}).length)fail();
   return{id:c.Id,imageId:c.Image};};
  const sql=(statement,database='postgres')=>docker(['exec','--user','70:70','-i',INIT,'psql','-X','-qAt','-U','blackspire_cluster_admin','-d',database,'-v','ON_ERROR_STOP=1'],statement);
  const observation=()=>JSON.parse(sql(owned.OWNED_POSTGRES_OBSERVE_SQL));
  const runtimeProof=async()=>{
   if(run('/usr/bin/systemctl',['show','blackspire-owned-postgres.service','--property=ActiveState','--value'])!=='active'||inspect('container',NAME)?.State.Running!==true)return null;
   if(inspect('container',INIT)?.State.Running)fail();cleanUnit('blackspire-owned-postgres.service');network();container(NAME);tls();proxyProof();
   const profile=owned.validateOwnedPostgresProfile(read(CONFIG+'/profile.json')),credential=read(CONFIG+'/management.json');
   if(credential.backendProfile!=='owned-postgres-v1'||credential.host!==profile.host||credential.profileDigest!==owned.ownedPostgresProfileDigest(profile)||hash(credential.ca)!==profile.caSha256)fail();
   const client=new pg.Client({host:profile.host,port:profile.port,database:profile.database,user:profile.managementUser,password:credential.password,ssl:databaseTlsOptions({...profile,ca:credential.ca}),connectionTimeoutMillis:3000,query_timeout:5000,options:'-c default_transaction_read_only=on -c statement_timeout=5000 -c search_path=pg_catalog'});
   client.on('error',()=>{});try{await client.connect();await client.query('BEGIN READ ONLY');const r=await client.query(OWNED_DATABASE_BOUNDARY_SQL);const proof=verifyOwnedDatabaseBoundary(r.rows[0].boundary,profile);await client.query('COMMIT');return{active:true,profileDigest:credential.profileDigest,systemIdentifier:proof.systemIdentifier};}finally{await client.end().catch(()=>{});}
  };
  const proxyProof=()=>{
   cleanUnit('blackspire-owned-postgres-proxy.service');cleanUnit('blackspire-owned-postgres-proxy.socket');
   const b=optional(ROOT+'/proxy-binding.json');if(!b)return null;
   const n=network(),c=inspect('container',NAME),ip=c?.NetworkSettings?.Networks?.[NAME]?.IPAddress;
   if(b.binding!==binding||b.networkId!==n.id||b.containerId!==c.Id||b.ip!==ip)fail();
   const expected=owned.ownedPostgresProxyService(ip);
   if(!fs.existsSync(PROXY+'.socket')||!fs.existsSync(PROXY+'.service'))return null;
   if(fileProof(PROXY+'.socket',{mode:0o644}).sha256!==hash(owned.OWNED_POSTGRES_PROXY_SOCKET)||fileProof(PROXY+'.service',{mode:0o644}).sha256!==hash(expected))fail();
   if(run('/usr/bin/systemctl',['show','blackspire-owned-postgres-proxy.socket','--property=NeedDaemonReload','--value'])!=='no')return null;
   return{binding,networkId:n.id,containerId:c.Id,ip,socket:hash(owned.OWNED_POSTGRES_PROXY_SOCKET),service:hash(expected)};
  };
  const stages=[
   {name:'network',before:()=>{if(inspect('network',NAME))fail();},apply:()=>docker(['network','create','--internal','--driver','bridge','--label',label,NAME]),observe:network},
   {name:'directories',before:()=>{if(fs.existsSync(CONFIG)||fs.existsSync(DATA_ROOT))fail();},apply:()=>{
    fs.mkdirSync(CONFIG,{mode:0o700});fs.mkdirSync(SERVER,{mode:0o755});fs.chownSync(SERVER,0,0);fs.chmodSync(SERVER,0o755);fs.mkdirSync(DATA_ROOT,{mode:0o700});fs.mkdirSync(owned.OWNED_POSTGRES_DATA_PATH,{mode:0o700});fs.chownSync(owned.OWNED_POSTGRES_DATA_PATH,70,70);
    for(const p of [SERVER,CONFIG,path.dirname(CONFIG),owned.OWNED_POSTGRES_DATA_PATH,DATA_ROOT,path.dirname(DATA_ROOT)])sync(p);
   },observe:directories},
   {name:'tls',before:()=>{if(fs.readdirSync(SERVER).length)fail();},apply:()=>{
    run('/usr/bin/openssl',['req','-x509','-newkey','rsa:3072','-nodes','-keyout',ROOT+'/ca.key','-out',ROOT+'/ca.crt','-days','365','-subj','/CN=Zola owned PostgreSQL CA','-addext','basicConstraints=critical,CA:TRUE']);
    run('/usr/bin/openssl',['req','-newkey','rsa:3072','-nodes','-keyout',SERVER+'/server.key','-out',ROOT+'/server.csr','-subj','/CN=127.0.0.1']);
    write(ROOT+'/server.ext','subjectAltName=IP:127.0.0.1\nextendedKeyUsage=serverAuth\nbasicConstraints=critical,CA:FALSE\n');
    run('/usr/bin/openssl',['x509','-req','-in',ROOT+'/server.csr','-CA',ROOT+'/ca.crt','-CAkey',ROOT+'/ca.key','-CAcreateserial','-out',SERVER+'/server.crt','-days','365','-extfile',ROOT+'/server.ext']);
    for(const p of ['ca.key','ca.crt','server.csr','ca.srl']){fs.chmodSync(ROOT+'/'+p,0o600);sync(ROOT+'/'+p);}
    fs.chownSync(SERVER+'/server.key',70,70);fs.chmodSync(SERVER+'/server.key',0o600);sync(SERVER+'/server.key');fs.chownSync(SERVER+'/server.crt',0,0);fs.chmodSync(SERVER+'/server.crt',0o644);sync(SERVER+'/server.crt');
    for(const [p,v] of [['postgresql.conf',owned.OWNED_POSTGRES_CONFIGURATION],['pg_hba.conf',owned.OWNED_POSTGRES_HBA],['pg_ident.conf',owned.OWNED_POSTGRES_IDENT]])write(SERVER+'/'+p,v,0o644);sync(SERVER);sync(ROOT);
   },observe:tls},
   {name:'initdb',before:()=>{if(fs.readdirSync(owned.OWNED_POSTGRES_DATA_PATH).length)fail();},apply:()=>{
    docker(['run','--rm','--name',NAME+'-initdb','--label',label,'--pull','never','--network','none','--read-only','--user','70:70','--cap-drop','ALL','--security-opt','no-new-privileges','--memory','768m','--pids-limit','128','--mount',`type=bind,src=${owned.OWNED_POSTGRES_DATA_PATH},dst=/var/lib/postgresql/data`,owned.OWNED_POSTGRES_TARGET.image,'initdb','-D','/var/lib/postgresql/data','-U','blackspire_cluster_admin','--auth-local=peer','--auth-host=scram-sha-256']);
   write(ROOT+'/initdb.completed.json',JSON.stringify({binding,completed:true})+'\n');
   },observe:()=>{if(JSON.stringify(optional(ROOT+'/initdb.completed.json'))!==JSON.stringify({binding,completed:true}))return null;const p=owned.OWNED_POSTGRES_DATA_PATH+'/PG_VERSION';if(!fs.existsSync(p))return null;if(fs.readFileSync(p,'utf8')!=='17\n')fail();return{version:'17'};}},
   {name:'bootstrap_container',before:()=>{if(inspect('container',INIT))fail();},apply:()=>{
    const args=[...owned.ownedPostgresContainerArguments()];args[args.indexOf('--name')+1]=INIT;args[args.indexOf('--network')+1]='none';args.splice(1,0,'--label',label);docker(args);
   },observe:()=>container(INIT,true)},
   {name:'bootstrap_start',historical:true,before:()=>{if(inspect('container',INIT)?.State.Running)fail();},apply:()=>docker(['start',INIT]),observe:()=>{if(!inspect('container',INIT)?.State.Running)return null;for(let i=0;i<50;i++){try{if(sql('SELECT 1')==='1')return{ready:true};}catch{/* bounded socket readiness */}run('/usr/bin/sleep',['0.2']);}return null;}},
   {name:'template',historical:true,before:()=>{},apply:()=>sql(owned.OWNED_POSTGRES_TEMPLATE_SQL,'template1'),observe:()=>sql("SELECT NOT EXISTS(SELECT FROM pg_namespace n CROSS JOIN LATERAL aclexplode(coalesce(n.nspacl,acldefault('n',n.nspowner))) a WHERE n.nspname='public' AND a.grantee=0)",'template1')==='t'?{inert:true}:null},
   {name:'bootstrap_sql',historical:true,before:()=>{if(sql("SELECT count(*) FROM pg_roles WHERE rolname='postgres'")!=='0')fail();},apply:()=>sql(owned.OWNED_POSTGRES_BOOTSTRAP_SQL),observe:()=>{
    if(sql("SELECT count(*) FROM pg_roles WHERE rolname='postgres'")!=='1')return null;if(sql("SELECT NOT rolsuper AND NOT rolcanlogin AND rolcreatedb AND rolcreaterole AND rolreplication AND rolbypassrls FROM pg_roles WHERE rolname='postgres'")!=='t')fail();const o=observation();if(!o.ownerMatches||!o.providerObjectsAbsent||!o.sourceCredentialsAbsent||o.database!=='postgres'||o.creatorOid<=10)fail();return o;
   }},
   {name:'credentials',historical:true,before:()=>{if(fs.existsSync(CONFIG+'/management.json')||fs.existsSync(CONFIG+'/profile.json'))fail();},apply:()=>{
    const o=observation(),ca=fs.readFileSync(ROOT+'/ca.crt','utf8');const profile={version:1,...owned.OWNED_POSTGRES_TARGET,creatorOid:o.creatorOid,systemIdentifier:o.systemIdentifier,caSha256:hash(ca)};
    owned.validateOwnedPostgresProfile(profile);const credential={backendProfile:'owned-postgres-v1',profileDigest:owned.ownedPostgresProfileDigest(profile),host:'127.0.0.1',password:randomBytes(32).toString('base64url'),ca};
    write(CONFIG+'/profile.json',JSON.stringify(profile)+'\n');write(CONFIG+'/management.json',JSON.stringify(credential)+'\n');
    sql("SET log_statement='none';ALTER ROLE postgres LOGIN PASSWORD '"+credential.password+"';");
   },observe:()=>{if(!fs.existsSync(CONFIG+'/profile.json')||!fs.existsSync(CONFIG+'/management.json'))return null;const p=owned.validateOwnedPostgresProfile(read(CONFIG+'/profile.json')),c=read(CONFIG+'/management.json');if(c.profileDigest!==owned.ownedPostgresProfileDigest(p)||hash(c.ca)!==p.caSha256||sql("SELECT rolcanlogin FROM pg_roles WHERE rolname='postgres'")!=='t')return null;return{profileDigest:c.profileDigest,profile:fileProof(CONFIG+'/profile.json'),management:fileProof(CONFIG+'/management.json')};}},
   {name:'bootstrap_stop',before:()=>{},apply:()=>docker(['stop','--time','60',INIT]),observe:()=>inspect('container',INIT)?.State.Running===false?{stopped:true}:null},
   {name:'runtime_container',before:()=>{if(inspect('container',NAME)||inspect('container',INIT)?.State.Running)fail();},apply:()=>{const args=[...owned.ownedPostgresContainerArguments()];args.splice(1,0,'--label',label);docker(args);},observe:()=>container(NAME)},
   {name:'service',before:()=>{if(fs.existsSync(UNIT))fail();},apply:()=>{write(UNIT,owned.OWNED_POSTGRES_SERVICE,0o644);run('/usr/bin/systemctl',['daemon-reload']);},observe:()=>fs.existsSync(UNIT)&&fileProof(UNIT,{mode:0o644}).sha256===hash(owned.OWNED_POSTGRES_SERVICE)&&run('/usr/bin/systemctl',['show','blackspire-owned-postgres.service','--property=NeedDaemonReload','--value'])==='no'?{unitSha256:hash(owned.OWNED_POSTGRES_SERVICE)}:null},
   {name:'service_start',before:()=>{if(inspect('container',INIT)?.State.Running)fail();},apply:()=>run('/usr/bin/systemctl',['start','blackspire-owned-postgres.service']),observe:()=>run('/usr/bin/systemctl',['show','blackspire-owned-postgres.service','--property=ActiveState','--value'])==='active'&&inspect('container',NAME)?.State.Running?{active:true}:null},
   {name:'proxy',before:()=>{if(fs.existsSync(PROXY+'.socket')||fs.existsSync(PROXY+'.service')||fs.existsSync(ROOT+'/proxy-binding.json'))fail();},apply:()=>{
    const n=network(),c=inspect('container',NAME);container(NAME);const ip=c.NetworkSettings.Networks[NAME].IPAddress,service=owned.ownedPostgresProxyService(ip);
    write(ROOT+'/proxy-binding.json',JSON.stringify({binding,networkId:n.id,containerId:c.Id,ip})+'\n');
    write(PROXY+'.socket',owned.OWNED_POSTGRES_PROXY_SOCKET,0o644);write(PROXY+'.service',service,0o644);run('/usr/bin/systemctl',['daemon-reload']);
   },observe:proxyProof},
   {name:'service_enable',before:()=>{proxyProof();},apply:()=>run('/usr/bin/systemctl',['enable','blackspire-owned-postgres.service','blackspire-owned-postgres-proxy.socket']),observe:()=>run('/usr/bin/systemctl',['is-enabled','blackspire-owned-postgres.service'])==='enabled'&&run('/usr/bin/systemctl',['is-enabled','blackspire-owned-postgres-proxy.socket'])==='enabled'?{enabled:true}:null},
   {name:'proxy_start',before:()=>{proxyProof();},apply:()=>run('/usr/bin/systemctl',['start','blackspire-owned-postgres-proxy.socket']),observe:runtimeProof},
  ];
  return await runOwnedMaterializationStages({stages,load,save,binding});
 }finally{guard.close();}
}

// Fixed boolean-only root observation. No credential hash or arbitrary SQL
// crosses this API; the daemon never receives cluster administrator access.
export const OWNED_REPOSITORY_FRESH_CREDENTIAL_SQL="BEGIN READ ONLY;SELECT jsonb_build_object('systemIdentifier',(SELECT system_identifier::text FROM pg_control_system()),'creatorOid',(SELECT oid::integer FROM pg_roles WHERE rolname='postgres'),'fresh',(SELECT count(*)=2 AND bool_and(rolpassword IS NULL) FROM pg_authid WHERE rolname IN('buyer_repository_login','buyer_capability_login')));COMMIT;";
export function verifyOwnedRepositoryCredentialObservation(result,profile){
 const p=owned.validateOwnedPostgresProfile(profile);
 if(!result||Object.keys(result).sort().join(',')!=='creatorOid,fresh,systemIdentifier'||result.systemIdentifier!==p.systemIdentifier||result.creatorOid!==p.creatorOid||typeof result.fresh!=='boolean')fail();
 return Object.freeze({fresh:result.fresh});
}
export function observeFreshOwnedRepositoryCredentials(){
 if(process.getuid?.()!==0)fail();const state=read(ROOT+'/state.json');const profile=owned.validateOwnedPostgresProfile(read(CONFIG+'/profile.json'));
 const retained=read(ROOT+'/runtime_container.result.json'),network=read(ROOT+'/network.result.json'),n=inspect('network',NAME);
 const c=inspect('container',NAME);if(retained.binding!==hash(state)||network.binding!==hash(state)||!n||n.Id!==network.proof.id||n.Internal!==true||n.Labels?.['blackspire.materialization']!==state.operationId||!c||c.Id!==retained.proof.id||c.Config.Labels?.['blackspire.materialization']!==state.operationId||c.Image!==state.imageId||c.Config.User!=='70:70'||c.HostConfig.NetworkMode!==NAME||!c.State.Running)fail();
 const result=JSON.parse(docker(['exec','--user','70:70','-i',NAME,'psql','-X','-qAt','-U','blackspire_cluster_admin','-d','postgres','-v','ON_ERROR_STOP=1'],OWNED_REPOSITORY_FRESH_CREDENTIAL_SQL));
 return verifyOwnedRepositoryCredentialObservation(result,profile);
}
