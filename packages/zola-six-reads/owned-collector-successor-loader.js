import {SUCCESSOR,successorHash,successorFail} from './owned-collector-successor.js';
import {ownedSixReadConfigMatches,OWNED_SIX_READ} from '../zola-release/owned-six-read-overlay.js';
export const SOURCE_HASHES=Object.freeze({permit:'19264cdf8249394aafb48aaf5110291147bd109be5f4d74d3a08635f4bc50938',commander:'51f46133478866db086d4bc0b46c800f64ca176bc20c7bbcd979b632ad36dc36',held:'f6b967b3d6c5043c7a00c49036763b45d7e8239ef46a033fb63d7e5524bce0f4',collector:'a62c5dd9b97bf6a2c8d9dc10fe4cf7d6276a7b155de620553c20faeaf33d6f00'});
const replace=(s,n,v)=>{const p=s.split(n);if(p.length!==2)successorFail();return p.join(v);};
export function transformSuccessorSource(kind,source){
 if(!Object.hasOwn(SOURCE_HASHES,kind)||successorHash(source)!==SOURCE_HASHES[kind])successorFail();
 const base=SUCCESSOR.root+'/packages/zola-six-reads/';
 if(kind==='permit'){
  source=replace(source,'export function inspectPremergeReadHistory(events){','export function inspectOriginalPremergeReadHistory(events){');
  source=replace(source,'export async function runPremergeReadPermit','export function inspectPremergeReadHistory(events){return inspectSuccessorHistory(events,{inspectOriginal:inspectOriginalPremergeReadHistory,inspectSequence:inspectReleaseSequenceHistory,validateClaims:validatePremergeReadClaims,identity:isProductionAcceptanceIdentity});}\nexport async function runPremergeReadPermit');
  const split=source.indexOf('export async function runPremergeReadPermit');let run=source.slice(split);
  for(const name of ['intent','active','result','retired'])run=run.replaceAll("'premerge_reads_"+name+"'","'premerge_successor_reads_"+name+"'");
  run=run.replaceAll('schema:1,type,attemptId','schema:2,type,attemptId');
  run=replace(run,"stream.append({schema:1,type:'premerge_successor_reads_intent'","stream.append({schema:2,type:'premerge_successor_reads_intent'");
  run=replace(run,'configDigest:hash(config),claims,claimsDigest});','configDigest:hash(config),claims,claimsDigest,terminalProofDigest:prior.terminal.terminalProofDigest,archiveProofDigest:prior.terminal.archiveProofDigest});');
  run=replace(run,'config.version!==4','!ownedSixReadConfigMatches(config,context)');
  run=replace(run,'  lease=acquire({root,exclusive:true,owner:0,groupId});','  await assertSuccessorReady(config,stream.events());\n  selectSuccessorReceipt(config);await verifySuccessorRoleProof(config);\n  lease=acquire({root,exclusive:true,owner:0,groupId});');
  run=replace(run,'lease=acquire({root,exclusive:true,owner:0,groupId});lease.assertIdentity();','lease=acquire({root,exclusive:true,owner:0,groupId});lease.assertIdentity();\n  await assertSuccessorReady(config,stream.events());selectSuccessorReceipt(config);await verifySuccessorRoleProof(config);');
  source=source.slice(0,split)+run;
  return "import {inspectSuccessorHistory} from '"+base+"owned-collector-successor.js';\nimport {assertSuccessorReady} from '"+base+"owned-collector-successor-host.js';\nimport {selectSuccessorReceipt,verifySuccessorRoleProof} from '"+base+"owned-denial-successor.js';\nconst OWNED_SIX_READ="+JSON.stringify(OWNED_SIX_READ)+";\n"+ownedSixReadConfigMatches.toString()+'\n'+source;
 }
 if(kind==='commander')return replace(source,"  if(row?.schema===2&&String(row.type).startsWith('candidate_deployment_'))continue;", "  if(row?.schema===2&&['premerge_observation_failure','premerge_successor_reads_intent','premerge_successor_reads_active','premerge_successor_reads_result','premerge_successor_reads_retired'].includes(row.type))continue;\n  if(row?.schema===2&&String(row.type).startsWith('candidate_deployment_'))continue;");
 if(kind==='held')return replace(source,"[`${artifactRoot}/scripts/zola-six-read-collect.js`,premerge?", "[...(premerge?['--import','"+SUCCESSOR.root+"/scripts/zola-owned-collector-successor-bootstrap.js']:[]),`${artifactRoot}/scripts/zola-six-read-collect.js`,premerge?");
 source=replace(source,'export function openCollectorJournal(directory, runId, { owner = 0 } = {}) {','function openOriginalCollectorJournal(directory, runId, { owner = 0 } = {}) {');
 source=replace(source,"const denialReceipt = [4,5,6,7].includes(config.version) ? readRootOwnedJson(config.denialReceiptPath, { groupId: 0 }) : null;", "const denialReceipt = config.version===6 ? selectSuccessorReceipt(config) : [4,5,7].includes(config.version) ? readRootOwnedJson(config.denialReceiptPath, { groupId: 0 }) : null;");
 source=replace(source,'verifyDenialReceipt(receipt) {\n      assertIdentity();','verifyDenialReceipt(receipt) {\n      assertIdentity();\n      if(config.version===6){verifySuccessorDatabase(receipt,config,dbstat);assertIdentity();return;}');
 return "import {selectSuccessorReceipt,verifySuccessorDatabase} from '"+base+"owned-denial-successor.js';\nimport {openSuccessorCollectorJournal} from '"+base+"owned-collector-successor-segment.js';\nexport const openCollectorJournal=(directory,runId,options)=>openSuccessorCollectorJournal(directory,runId,options,openOriginalCollectorJournal);\n"+source;
}
export async function load(url,context,nextLoad){
 const result=await nextLoad(url,context);const canonical='file://'+SUCCESSOR.canonicalRoot;
 const kind=url===canonical+'/packages/zola-release/premerge-read-permit.js'?'permit':url===canonical+'/packages/zola-release/commander.js'?'commander':url===canonical+'/packages/zola-release/production-held-operations.js'?'held':url==='file:///opt/blackspire-command/releases/'+SUCCESSOR.releaseSha+'/packages/zola-six-reads/collector-host.js'?'collector':null;
 if(!kind)return result;if(result.format!=='module')successorFail();return {...result,source:transformSuccessorSource(kind,Buffer.from(result.source).toString('utf8'))};
}
