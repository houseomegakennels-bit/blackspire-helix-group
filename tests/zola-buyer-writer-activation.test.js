import test from 'node:test';
import assert from 'node:assert/strict';
import {activateBuyerWriterBeforeHeld} from '../packages/zola-release/buyer-writer-activation.js';

const bound={releaseSha:'a'.repeat(40),operationId:'11111111-1111-4111-8111-111111111111',
 attemptId:'22222222-2222-4222-8222-222222222222',inputDigest:'3'.repeat(64),
 checkOutputDigest:'4'.repeat(64)};
function fixture({loseUpgrade=false}={}){
 const events=[],calls=[],state={gateway:false,upgrade:false,compliant:false,lost:loseUpgrade};
 const journal={stream:()=>({events:()=>structuredClone(events),append:event=>events.push(structuredClone(event))})};
 const io={lstatSync(filename){
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
  if(script.includes('zola-config-install'))return {status:'INSTALLED_RELOAD_REQUIRED'};
  throw new Error('unexpected script');
 };
 const inspectArtifact=async()=>({status:'SEALED_ARTIFACT_VERIFIED',releaseSha:bound.releaseSha,
  artifactDigest:'6'.repeat(64),deployed:false,productionAccepted:false});
 const reloadSystemd=async()=>{calls.push('systemctl:daemon-reload');return {status:'SYSTEMD_RELOADED'};};
 return {events,calls,state,journal,io,run,inspectArtifact,reloadSystemd};
}
const options=f=>({journal:f.journal,run:f.run,io:f.io,inspectArtifact:f.inspectArtifact,
 reloadSystemd:f.reloadSystemd,readJson(){throw new Error('unexpected journal');}});

test('pre-HELD activation durably orders every production prerequisite',async()=>{
 const f=fixture(),result=await activateBuyerWriterBeforeHeld(bound,options(f));
 assert.equal(result.status,'BUYER_WRITER_PRE_HELD_READY');
 assert.deepEqual(f.events.filter(row=>row.type==='buyer_writer_activation_result').map(row=>row.phase),
  ['source_v1','gateway_v4','gateway_upgrade','database_provisioning','configuration_install']);
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
 const result=await activateBuyerWriterBeforeHeld(bound,options(f));
 assert.equal(result.status,'BUYER_WRITER_PRE_HELD_READY');
 assert.equal(f.calls.filter(row=>row.includes('source-v1')).length,before);
 assert.ok(f.calls.includes('scripts/upgrade-buyer-writer-gateway-configuration.js:--reconcile'));
});

test('systemd reload failure keeps configuration activation incomplete',async()=>{
 const f=fixture();f.reloadSystemd=async()=>{throw new Error('reload failed');};
 await assert.rejects(()=>activateBuyerWriterBeforeHeld(bound,options(f)),/reload failed/);
 assert.deepEqual(f.events.filter(row=>row.type==='buyer_writer_activation_result').map(row=>row.phase),
  ['source_v1','gateway_v4','gateway_upgrade','database_provisioning']);
 assert.ok(f.calls.includes('scripts/zola-config-install.js:--install'));
});
