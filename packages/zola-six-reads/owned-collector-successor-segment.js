import path from 'node:path';
import {SUCCESSOR,successorHash,successorFail} from './owned-collector-successor.js';
import {readTerminalProof} from './owned-collector-successor-host.js';
import {readRootOwnedJson} from '../buyer-writer/protected-json.js';
export function openSuccessorCollectorJournal(directory,runId,options,openOriginal){
 const config=readRootOwnedJson('/var/lib/blackspire-operator/preparation/six-read-premerge-config.json',{groupId:0});
 if(successorHash(config)!==SUCCESSOR.configDigest||directory!==config.journalDirectory||runId!==SUCCESSOR.runId||options&&Object.keys(options).length)successorFail();
 const proof=readTerminalProof();
 const expectedDirectory='/var/lib/blackspire-operator/preparation/owned-collector-successor-20260923/collector';
 if(proof.segmentDirectory!==expectedDirectory||path.resolve(proof.segmentDirectory)!==expectedDirectory)successorFail();
 const predecessor={terminalProofDigest:proof.terminalProofDigest,archiveProofDigest:proof.archiveProofDigest,collectorDigest:proof.collectorDigest,originalClaimsDigest:proof.originalClaimsDigest,originalReleasePrefixDigest:proof.originalReleasePrefixDigest};
 const store=openOriginal(expectedDirectory,runId,{owner:0});let closed=false;
 const check=()=>{const current=readTerminalProof();if(successorHash({...predecessor,segmentDirectory:expectedDirectory})!==successorHash(Object.fromEntries([...Object.keys(predecessor),'segmentDirectory'].map(k=>[k,current[k]]))))successorFail();};
 try{
  check();const old=store.events();if(old.length&&successorHash(old[0])!==successorHash({type:'run',binding:SUCCESSOR.configDigest,releaseSha:SUCCESSOR.releaseSha,successor:predecessor}))successorFail();
  return {events:()=>store.events(),append(event){check();if(!store.events().length){if(successorHash(event)!==successorHash({type:'run',binding:SUCCESSOR.configDigest,releaseSha:SUCCESSOR.releaseSha}))successorFail();store.append({...event,successor:predecessor});}else store.append(event);},close(){if(!closed){closed=true;store.close();}}};
 }catch(error){store.close();throw error;}
}
