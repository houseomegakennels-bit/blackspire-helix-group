import {register} from 'node:module';
import {SUCCESSOR,successorHash,successorFail} from '../packages/zola-six-reads/owned-collector-successor.js';
import {readTerminalProof} from '../packages/zola-six-reads/owned-collector-successor-host.js';
import {selectSuccessorReceipt,readSuccessorDenialProof,verifySuccessorRoleProof} from '../packages/zola-six-reads/owned-denial-successor.js';
import {readRootOwnedJson} from '../packages/buyer-writer/protected-json.js';
if(process.getuid?.()!==0||process.versions.node!=='22.23.1'||process.argv.length!==4||process.argv[1]!=='/opt/blackspire-command/releases/'+SUCCESSOR.releaseSha+'/scripts/zola-six-read-collect.js'||process.argv[2]!=='--premerge-held'||process.argv[3]!=='/var/lib/blackspire-operator/preparation/six-read-premerge-config.json')successorFail();
const config=readRootOwnedJson(process.argv[3],{groupId:0});if(successorHash(config)!==SUCCESSOR.configDigest)successorFail();
readTerminalProof();await verifySuccessorRoleProof(config);const proof=readSuccessorDenialProof(config);
const {openDenialSessionRuntime}=await import(SUCCESSOR.canonicalRoot+'/packages/zola-six-reads/denial-runtime.js');
const runtime=await openDenialSessionRuntime(SUCCESSOR.releaseSha);
try{if(successorHash(runtime.profile)!==proof.intent.profileDigest)successorFail();await runtime.assertCurrent();selectSuccessorReceipt(config);}finally{runtime.close();}
register(new URL('../packages/zola-six-reads/owned-collector-successor-loader.js',import.meta.url));
