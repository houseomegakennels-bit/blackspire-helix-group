// Read-only parser integration. Synthetic records stay in memory and confer no authority.
import fs from 'node:fs';import {register} from 'node:module';import {randomUUID} from 'node:crypto';
import {SUCCESSOR,successorHash as hash,successorPrefixDigest,successorFail} from '../packages/zola-six-reads/owned-collector-successor.js';
import {OWNED_SIX_READ} from '../packages/zola-release/owned-six-read-overlay.js';
try{
 if(process.getuid?.()!==0||process.versions.node!=='22.23.1'||process.argv.length!==2)successorFail();
 const decode=file=>{const fd=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);try{const st=fs.fstatSync(fd);if(!st.isFile()||st.uid!==0||st.nlink!==1||(st.mode&0o7777)!==0o600||st.size>1048576)successorFail();const bytes=fs.readFileSync(fd,'utf8');if(!bytes.endsWith('\n'))successorFail();let previous='0'.repeat(64);return bytes.trimEnd().split('\n').map((line,sequence)=>{const row=JSON.parse(line);if(row.sequence!==sequence||row.previous!==previous||row.digest!==hash({sequence,previous,event:row.event}))successorFail();previous=row.digest;return row.event;});}finally{fs.closeSync(fd);}};
 const all=decode('/var/lib/blackspire-operator/release-operations/release.jsonl'),workflow=decode('/var/lib/blackspire-operator/release-operations/n8n.jsonl');
 let end=0;while(end<all.length&&successorPrefixDigest(all.slice(0,end+1))!==SUCCESSOR.originalReleasePrefixDigest)end++;
 if(end===all.length)successorFail();const events=all.slice(0,end+1);
 register(new URL('../packages/zola-six-reads/owned-collector-successor-loader.js',import.meta.url));
 register('file://'+OWNED_SIX_READ.frozenRoot+'/packages/zola-release/owned-sequence-loader.js',import.meta.url);
 const {inspectReleaseCommander}=await import(SUCCESSOR.canonicalRoot+'/packages/zola-release/commander.js');
 const {inspectPremergeReadHistory}=await import(SUCCESSOR.canonicalRoot+'/packages/zola-release/premerge-read-permit.js');
 const {inspectReleaseSequenceHistory}=await import(SUCCESSOR.canonicalRoot+'/packages/zola-release/commander-sequence.js');
 const publicRouting=await import(SUCCESSOR.canonicalRoot+'/packages/zola-release/public-command-routing-host.js');if(typeof publicRouting.publishPublicCommandRouting!=='function')successorFail();
 const state=inspectReleaseSequenceHistory(events),old=events.find(e=>e.type==='premerge_reads_intent');
 const terminal={schema:2,type:'premerge_observation_failure',attemptId:SUCCESSOR.attemptId,originalClaimsDigest:SUCCESSOR.originalClaimsDigest,collectorDigest:SUCCESSOR.collectorDigest,terminalProofDigest:'1'.repeat(64),archiveProofDigest:'2'.repeat(64),originalReleasePrefixDigest:SUCCESSOR.originalReleasePrefixDigest};
 events.push(terminal);const journal={stream:name=>({events:()=>structuredClone(name==='release'?events:workflow)})};
 inspectReleaseCommander(journal);if(inspectPremergeReadHistory(events).intent!==null)successorFail();
 const claims={...old.claims,permitId:randomUUID(),tokenDigest:'3'.repeat(64),issuedAt:Math.max(Date.now(),old.claims.expiresAt),expiresAt:Math.max(Date.now(),old.claims.expiresAt)+899000};
 const claimsDigest=hash(claims),base={schema:2,attemptId:SUCCESSOR.attemptId,claimsDigest};
 events.push({...base,type:'premerge_successor_reads_intent',inputDigest:state.pending.inputDigest,checkOutputDigest:state.pending.checkOutputDigest,configDigest:SUCCESSOR.configDigest,claims,terminalProofDigest:terminal.terminalProofDigest,archiveProofDigest:terminal.archiveProofDigest});
 events.push({...base,type:'premerge_successor_reads_active'});
 const evidence={readCount:6,crossOwnerDenials:6,paidProviderCalls:0,mutationDelta:0,collectorDigest:'4'.repeat(64)};
 events.push({...base,type:'premerge_successor_reads_result',evidence,evidenceDigest:hash(evidence)},{...base,type:'premerge_successor_reads_retired',outcome:'PASS'});
 inspectReleaseCommander(journal);if(!inspectPremergeReadHistory(events).result)successorFail();
 events.push({schema:4,type:'sequence_stage_confirmed',operationId:SUCCESSOR.operationId,ordinal:13,stage:'six_reads',attemptId:SUCCESSOR.attemptId,inputDigest:state.pending.inputDigest,checkOutputDigest:state.pending.checkOutputDigest,output:evidence,outputDigest:hash(evidence)});
 inspectReleaseCommander(journal);if(inspectReleaseSequenceHistory(events).nextOrdinal!==14)successorFail();
 process.stdout.write('SUCCESSOR_NATIVE_PARSER_COMPOSITION_VERIFIED_NO_WRITES\n');
}catch{process.stderr.write('Successor parser composition rejected\n');process.exitCode=1;}
