#!/usr/bin/env node
// Exact immutable frontend source, real Next HTTP, synthetic loopback database.
// Only the root supervisor may invoke this in its private network namespace.
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { execFileSync, spawn } from 'node:child_process';
import { randomBytes, createHash } from 'node:crypto';
import { RECOVERY_SHA } from '../packages/zola-rollback/intake.js';
import { cases } from '../packages/zola-six-reads/offline.js';
import { blackspireCapabilityRegistry } from '../packages/capabilities/index.js';
import { validateCapabilityOutput } from '../packages/capabilities/contract.js';

const sourceRoot = fileURLToPath(new URL('../', import.meta.url));
const hash = value => createHash('sha256').update(value).digest('hex');
const run = (file, args, options = {}) => execFileSync(file, args, { cwd: sourceRoot, timeout: 10000, maxBuffer: 32 * 1024 * 1024,
  env: { PATH: '/usr/bin:/bin', LC_ALL: 'C', GIT_NO_REPLACE_OBJECTS: '1' }, ...options });
let database, frontend, completion, checkout, childFailure = false;
try {
  assert.equal(process.argv.length, 2);
  assert.equal(process.getuid(), 0);
  assert.deepEqual(Object.keys(process.env).sort(), ['NODE_NO_WARNINGS','PATH','ZOLA_CANDIDATE_PARENT_NET','ZOLA_SIX_READ_DISPOSABLE_DIR'].sort());
  assert.match(process.env.ZOLA_CANDIDATE_PARENT_NET, /^net:\[\d+\]$/);
  const namespace = fs.readlinkSync('/proc/self/ns/net');
  assert.notEqual(namespace, process.env.ZOLA_CANDIDATE_PARENT_NET);
  const assertNetwork = () => {
    assert.equal(fs.readlinkSync('/proc/self/ns/net'), namespace);
    assert.deepEqual(JSON.parse(run('/usr/sbin/ip', ['-j','link','show'])).map(v => v.ifname), ['lo']);
    for (const family of ['-4','-6']) assert.equal(run('/usr/sbin/ip', [family,'route','show','default']).toString().trim(), '');
  };
  assertNetwork(); run('/usr/sbin/ip', ['link','set','lo','up']);
  const root = process.env.ZOLA_SIX_READ_DISPOSABLE_DIR;
  assert.equal(fs.realpathSync(root), root);
  assert.ok(path.isAbsolute(root) && path.basename(root).startsWith('zola-six-read-'));
  const stat = fs.lstatSync(root);
  assert.ok(stat.isDirectory() && stat.uid === 0 && (stat.mode & 0o777) === 0o700);
  assert.deepEqual(fs.readdirSync(root), []);
  checkout = path.join(root, 'recovery-frontend'); fs.mkdirSync(checkout, { mode: 0o700 });
  // Git exports tracked bytes only; no checkout .env, credentials or Git config.
  const paths = ['frontend/src','frontend/package.json','frontend/package-lock.json','frontend/tsconfig.json','frontend/next.config.ts','frontend/postcss.config.mjs'];
  const archive = run('/usr/bin/git', ['archive', RECOVERY_SHA, ...paths]);
  run('/usr/bin/tar', ['-x','-C',checkout], { input: archive });
  const app = path.join(checkout, 'frontend');
  for (const file of ['package.json','package-lock.json']) assert.equal(hash(fs.readFileSync(path.join(app,file))), hash(fs.readFileSync(path.join(sourceRoot,'frontend',file))));
  const files = run('/usr/bin/git', ['ls-tree','-r','--name-only',RECOVERY_SHA,...paths]).toString().trim().split('\n');
  assert.ok(files.every(file => !/(^|\/)\.env/.test(file)), 'tracked environment files refused');
  const sourceDigest = hash(JSON.stringify(files.map(file => [file,hash(fs.readFileSync(path.join(checkout,file)))])));
  fs.symlinkSync(path.join(sourceRoot,'frontend/node_modules'), path.join(app,'node_modules'), 'dir');
  const events = [], token = randomBytes(32).toString('hex'), workspace = 'recovery-frontend-fixture';
  const rows = {
    seller_leads: [{id:'seller-1',property_id:'property-1',status:'New',motivation_score:90,lead_category:'Review',motivation_reasons:[],recommended_action:'Review',properties:{id:'property-1',property_address:'1 Fixture Street',county:'Forsyth',state:'NC'},owners:[]}],
    BuyerProfile: [{id:'buyer-1',buyer_name:'Synthetic buyer',county:'Forsyth',state:'NC',is_cash_buyer:true,purchase_count:3,score:80}],
    deal_leads: [{id:'DE-0001',seller_lead_id:'seller-1',owner_name:'Synthetic owner',property_address:'1 Fixture Street',county:'Forsyth',status:'New',motivation_score:90,deal_analysis:{maximum_allowable_offer:150000,assignment_fee_target:10000},seller_conversations:null,buyer_matches:null}],
    deal_analysis: [{lead_id:'DE-0001',estimated_arv:230000,repair_estimate:20000,seller_asking_price:170000,maximum_allowable_offer:150000,assignment_fee_target:10000}],
    nexus_contacts: [{id:'contact-1',seller_lead_id:'seller-1',owner_name:'Synthetic owner',property_address:'1 Fixture Street',primary_phone:null,contact_confidence_score:80,status:'Stored',provider:'fixture',updated_at:'2026-09-07T00:00:00Z'}],
  };
  database = http.createServer((request,response) => {
    const url = new URL(request.url, 'http://127.0.0.1');
    events.push({method:request.method,path:url.pathname});
    response.setHeader('content-type','application/json');
    if (!['GET','HEAD'].includes(request.method) || !url.pathname.startsWith('/rest/v1/')) { response.statusCode=405; response.end('{"error":"fixture denied"}'); return; }
    const table=url.pathname.slice('/rest/v1/'.length);
    let selected=rows[table] ?? [];
    for (const [key,value] of url.searchParams) if (value.startsWith('eq.')) selected=selected.filter(row=>String(row[key])===value.slice(3));
    const limit=Number(url.searchParams.get('limit') ?? selected.length); selected=selected.slice(0,limit);
    response.setHeader('content-range',`0-${Math.max(0,selected.length-1)}/${selected.length}`);
    const single=request.headers.accept?.includes('application/vnd.pgrst.object+json');
    if(single && selected.length!==1){response.statusCode=406;response.end('{"code":"PGRST116","details":"The result contains 0 rows"}');return;}
    response.end(request.method==='HEAD'?undefined:JSON.stringify(single?selected[0]:selected));
  });
  await new Promise(resolve=>database.listen(0,'127.0.0.1',resolve));
  const reserve=http.createServer();await new Promise(resolve=>reserve.listen(0,'127.0.0.1',resolve));
  const port=reserve.address().port;await new Promise(resolve=>reserve.close(resolve));
  const databaseOrigin=`http://127.0.0.1:${database.address().port}`;
  frontend=spawn(process.execPath,[path.join(app,'node_modules/next/dist/bin/next'),'dev','--webpack','--hostname','127.0.0.1','--port',String(port)],{
    cwd:app,env:{PATH:path.dirname(process.execPath)+':/usr/bin:/bin',NODE_NO_WARNINGS:'1',NEXT_TELEMETRY_DISABLED:'1',
      SUPABASE_URL:databaseOrigin,SUPABASE_SERVICE_ROLE_KEY:token,NEXT_PUBLIC_SUPABASE_URL:databaseOrigin,NEXT_PUBLIC_SUPABASE_ANON_KEY:token,
      BLACKSPIRE_CAPABILITY_TOKEN:token,BLACKSPIRE_SELLER_ENGINE_WORKSPACE_ID:workspace},stdio:['ignore','pipe','pipe']});
  frontend.on('error',()=>{childFailure=true;});
  let logs=0;for(const stream of [frontend.stdout,frontend.stderr])stream.on('data',chunk=>{logs+=chunk.length;if(logs>256*1024)frontend.kill('SIGKILL');});
  completion=new Promise(resolve=>frontend.once('close',(code)=>resolve(code)));
  const request=async(entry,body,authorization=token)=>{
    const response=await fetch(`http://127.0.0.1:${port}${entry.route}`,{method:'POST',redirect:'error',headers:{'content-type':'application/json',...(authorization?{authorization:`Bearer ${authorization}`}:{})},body:JSON.stringify(body),signal:AbortSignal.timeout(60000)});
    const bytes=await response.text();assert.ok(bytes.length<128*1024);return {status:response.status,data:JSON.parse(bytes)};
  };
  const deadline=Date.now()+20000;
  while(true){try{const r=await request(cases[0],{},null);assert.equal(r.status,404);break;}catch(error){if(Date.now()>deadline||frontend.exitCode!==null||childFailure)throw error;await new Promise(resolve=>setTimeout(resolve,100));}}
  const results=[];
  for(const entry of cases){
    const body={workspaceId:workspace,...entry.input,...(entry.id==='buyer.matches.search'?{matchesOnly:true}:{})};
    const before=events.length;
    for(const [auth,scope] of [[null,workspace],['wrong-token',workspace],[token,'foreign-workspace']])assert.equal((await request(entry,{...body,workspaceId:scope},auth)).status,404);
    assert.equal(events.length,before,'denials must precede database I/O');
    const own=await request(entry,body);assert.equal(own.status,200,`${entry.id} unavailable`);
    validateCapabilityOutput(blackspireCapabilityRegistry.get(entry.id),own.data);
    const count=entry.collection?own.data[entry.collection].length:own.data.found===false?0:own.data.source===null?0:1;
    assert.ok(count>0&&count<=5,`${entry.id} needs a nonempty bounded witness`);
    results.push({capability:entry.id,status:'PASS_IMMUTABLE_NEXT_HTTP',boundedResultCount:count,anonymousDenial:true,wrongCredentialDenial:true,foreignWorkspaceDenial:true,databaseRequests:events.length-before});
  }
  assert.equal(events.filter(e=>!['GET','HEAD'].includes(e.method)).length,0,'immutable frontend attempted mutation');
  assertNetwork(); assert.equal(childFailure,false); assert.equal(frontend.exitCode,null);
  assert.equal(hash(JSON.stringify(files.map(file=>[file,hash(fs.readFileSync(path.join(checkout,file)))]))),sourceDigest,'immutable tracked source changed');
  process.stdout.write(JSON.stringify({version:1,recoverySha:RECOVERY_SHA,status:'PASS_IMMUTABLE_FRONTEND_HTTP',productionAccepted:false,sourceDigest,archiveDigest:hash(archive),results,
    dependencyScope:'Reused installed dependencies; exact recovery package and lock bytes match current checkout; installed package integrity not independently verified',
    observedDatabaseMutationAttempts:0,externalNetwork:'kernel isolated; loopback only',limitations:['Next development runtime, not production build or deployment','Synthetic database; no live row-owner policy or complete functional rollback acceptance']})+'\n');
}catch(error){process.stderr.write(`Immutable recovery frontend failed: ${String(error.message).slice(0,160)}\n`);process.exitCode=1;}
finally{
  if(frontend){frontend.kill('SIGTERM');const timer=setTimeout(()=>frontend.kill('SIGKILL'),2000);await completion;clearTimeout(timer);}
  if(database){database.closeAllConnections();await new Promise(resolve=>database.close(resolve));}
  if(checkout)fs.rmSync(checkout,{recursive:true,force:true});
}
