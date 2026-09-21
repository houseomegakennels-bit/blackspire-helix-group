import test from 'node:test';
import assert from 'node:assert/strict';
import {activateBuyerWriterBeforeHeld} from '../packages/zola-release/buyer-writer-activation.js';

const bound={releaseSha:'a'.repeat(40),operationId:'11111111-1111-4111-8111-111111111111',
 attemptId:'22222222-2222-4222-8222-222222222222',inputDigest:'3'.repeat(64),
 checkOutputDigest:'4'.repeat(64)};
function fixture({loseUpgrade=false}={}){
 const events=[],calls=[],state={gateway:false,upgrade:false,compliant:false,unit:false,lost:loseUpgrade};
 const journal={stream:()=>({events:()=>structuredClone(events),append:event=>events.push(structuredClone(event))})};
 const io={lstatSync(filename){
  if(filename.includes('gateway-installation')&&state.unit)return {};
  if(filename.endsWith('.intent.json')&&state.gateway)return {};
  if(filename.includes('gateway-configuration-upgrade')&&state.upgrade)return {};
  const error=new Error('absent');error.code='ENOENT';throw error;
 }};
 const run=async(script,args)=>{
  const mode=args[0];calls.push(`${script}:${mode}`);
  if(script.includes('source-v1'))return {status:'BUYER_WRITER_SOURCE_V1_PREPARED'};
  if(script.includes('gateway-v4')){
   if(mode==='--inspect')return {status:state.gateway?'COMPLETE':'ABSENT',candidateDigest:'5'.repeat(64)};
   state.gateway=true;return {status:'BUYER_WRITER_GATEWAY_V4_PREPARED',candidateDigest:'5'.repeat(64)};
  }
  if(script.includes('upgrade-buyer')){
   state.upgrade=true;if(state.lost){state.lost=false;throw new Error('lost upgrade acknowledgement');}
   return {status:'UPGRADED'};
  }
  if(script.includes('provision-buyer')){
   if(mode==='--inspect')return {status:state.compliant?'COMPLIANT':'NONCOMPLIANT'};
   if(mode==='--verify')return {status:'COMPLIANT'};
   state.compliant=true;return {status:'PROVISIONED'};
  }
  if(script.includes('buyer-writer-gateway-install')){state.unit=true;return{status:'UNIT_PREPARED'};}
  if(script.includes('zola-config-install'))return {status:'INSTALLED_RELOAD_REQUIRED'};
  throw new Error('unexpected script');
 };
 const inspectArtifact=async()=>({status:'SEALED_ARTIFACT_VERIFIED',releaseSha:bound.releaseSha,
  artifactDigest:'6'.repeat(64),deployed:false,productionAccepted:false});
 const reloadSystemd=async()=>{calls.push('systemctl:daemon-reload');return {status:'SYSTEMD_RELOADED'};};
 return {events,calls,state,journal,io,run,inspectArtifact,reloadSystemd};
}
const options=f=>({journal:f.journal,run:f.run,io:f.io,inspectArtifact:f.inspectArtifact,
 reloadSystemd:f.reloadSystemd,readJson(filename){
  if(!filename.includes('gateway-configuration-upgrade'))throw new Error('unexpected journal');
  return {version:2,kind:'buyer_writer_gateway_configuration_upgrade',
   releaseSha:bound.releaseSha,operationId:bound.operationId,attemptId:bound.attemptId,
   artifactDigest:'6'.repeat(64),candidateDigest:'5'.repeat(64),phase:'PUBLISHED',
   configurationFile:'/etc/blackspire-buyer-writer-gateway/gateway.json',
   backupFile:'/var/lib/blackspire-operator/gateway-configuration-upgrade/'
    +bound.operationId+'.backup.json',oldConfigDigest:'7'.repeat(64),newConfigDigest:'8'.repeat(64)};
 }});

test('pre-HELD activation durably orders every production prerequisite',async()=>{
 const f=fixture(),result=await activateBuyerWriterBeforeHeld(bound,options(f));
 assert.equal(result.status,'BUYER_WRITER_PRE_HELD_READY');
 assert.deepEqual(f.events.filter(row=>row.type==='buyer_writer_activation_result').map(row=>row.phase),
  ['source_v1','gateway_v4','gateway_upgrade','database_provisioning','configuration_install','gateway_unit']);
 assert.ok(f.calls.indexOf('scripts/prepare-buyer-writer-source-v1.js:--prepare')
  <f.calls.indexOf('scripts/upgrade-buyer-writer-gateway-configuration.js:--upgrade'));
 assert.ok(f.calls.indexOf('scripts/provision-buyer-writer-production.js:--apply')
  <f.calls.indexOf('scripts/zola-config-install.js:--install'));
 assert.equal(f.calls.find(row=>row.includes('gateway-v4')),
  'scripts/prepare-buyer-writer-gateway-v4.js:--prepare');
 assert.ok(f.calls.indexOf('scripts/zola-config-install.js:--install')
  <f.calls.indexOf('systemctl:daemon-reload'));
});

test('lost upgrade acknowledgement reconciles the exact attempt without replaying completed phases',async()=>{
 const f=fixture({loseUpgrade:true});
 await assert.rejects(()=>activateBuyerWriterBeforeHeld(bound,options(f)),/lost upgrade acknowledgement/);
 assert.deepEqual(f.events.filter(row=>row.type==='buyer_writer_activation_result').map(row=>row.phase),
  ['source_v1','gateway_v4']);
 const before=f.calls.filter(row=>row.includes('source-v1')).length;
 const gatewayBefore=f.calls.filter(row=>row.includes('gateway-v4')).length;
 const result=await activateBuyerWriterBeforeHeld(bound,options(f));
 assert.equal(result.status,'BUYER_WRITER_PRE_HELD_READY');
 assert.equal(f.calls.filter(row=>row.includes('source-v1')).length,before);
 assert.equal(f.calls.filter(row=>row.includes('gateway-v4')).length,gatewayBefore,
  'reconcile must not inspect the replaced pre-upgrade gateway');
 assert.ok(f.calls.includes('scripts/upgrade-buyer-writer-gateway-configuration.js:--reconcile'));
});

test('systemd reload failure keeps configuration activation incomplete',async()=>{
 const f=fixture();f.reloadSystemd=async()=>{throw new Error('reload failed');};
 await assert.rejects(()=>activateBuyerWriterBeforeHeld(bound,options(f)),/reload failed/);
 assert.deepEqual(f.events.filter(row=>row.type==='buyer_writer_activation_result').map(row=>row.phase),
  ['source_v1','gateway_v4','gateway_upgrade','database_provisioning']);
 assert.ok(f.calls.includes('scripts/zola-config-install.js:--install'));
});

test('lost gateway unit acknowledgement reconciles retained state without repeating prior activation',async()=>{
 const f=fixture(),original=f.run;let lost=true;
 f.run=async(script,args)=>{const result=await original(script,args);if(script.includes('buyer-writer-gateway-install')&&lost){lost=false;throw new Error('unit acknowledgement lost');}return result;};
 await assert.rejects(activateBuyerWriterBeforeHeld(bound,options(f)),/unit acknowledgement lost/);
 const before=f.calls.filter(s=>!s.includes('buyer-writer-gateway-install')).length;
 await activateBuyerWriterBeforeHeld(bound,options(f));
 assert.equal(f.calls.filter(s=>!s.includes('buyer-writer-gateway-install')).length,before);
 assert.ok(f.calls.includes('scripts/buyer-writer-gateway-install.js:--reconcile-prepared'));
 assert.equal(f.calls.filter(s=>s==='scripts/buyer-writer-gateway-install.js:--prepare').length,1);
});

test('owned activation binds its separate source and journal to the protected descriptor',async()=>{
 const {OWNED_POSTGRES_TARGET,ownedPostgresProfileDigest}=await import('../packages/buyer-writer/owned-postgres.js');
 const profile={version:1,...OWNED_POSTGRES_TARGET,creatorOid:16401,systemIdentifier:'123456789',caSha256:'d'.repeat(64)};
 const input={...bound,backendProfile:'owned-postgres-v1',profileDigest:ownedPostgresProfileDigest(profile)};
 const f=fixture(),calls=[],run=f.run;f.run=async(script,args)=>{calls.push({script,args});return run(script,args);};
 await activateBuyerWriterBeforeHeld(input,{...options(f),readProfile:()=>profile});
 const source=calls.find(row=>row.script.includes('source-v1'));
 assert.ok(source.args.includes('/var/lib/blackspire-operator/preparation/owned-gateway-provisioning.json'));
 assert.ok(source.args.includes('/etc/blackspire/owned-postgres/management.json'));
 assert.equal(f.events[0].binding.profileDigest,input.profileDigest);
 const count=calls.length;
 await assert.rejects(()=>activateBuyerWriterBeforeHeld(input,{...options(f),readProfile:()=>({...profile,creatorOid:16402})}),/activation rejected/);
 assert.equal(calls.length,count);
 await assert.rejects(()=>activateBuyerWriterBeforeHeld(bound,options(f)),/activation rejected/);
});

test('owned operator upgrade state reconciles without re-preparing against replaced gateway',async()=>{
 const {OWNED_POSTGRES_TARGET,ownedPostgresProfileDigest}=await import('../packages/buyer-writer/owned-postgres.js');
 const profile={version:1,...OWNED_POSTGRES_TARGET,creatorOid:16401,systemIdentifier:'123456789',caSha256:'d'.repeat(64)};
 const input={...bound,backendProfile:'owned-postgres-v1',profileDigest:ownedPostgresProfileDigest(profile)},root='/var/lib/blackspire-operator/owned-gateway-transition';
 const f=fixture({loseUpgrade:true}),original=options(f),stat=f.io.lstatSync;
 const opts={...original,readProfile:()=>profile,paths:{upgradeStateDirectory:root},io:{lstatSync:p=>stat(p.replace(root,'/var/lib/blackspire-operator/gateway-configuration-upgrade'))},readJson:p=>({...original.readJson(p.replace(root,'/var/lib/blackspire-operator/gateway-configuration-upgrade')),backupFile:root+'/'+bound.operationId+'.backup.json'})};
 await assert.rejects(activateBuyerWriterBeforeHeld(input,opts),/lost upgrade acknowledgement/);
 const prepared=f.calls.filter(c=>c.includes('gateway-v4')).length;
 await activateBuyerWriterBeforeHeld(input,opts);
 assert.equal(f.calls.filter(c=>c.includes('gateway-v4')).length,prepared);
 assert.ok(f.calls.includes('scripts/upgrade-buyer-writer-gateway-configuration.js:--reconcile'));
});
