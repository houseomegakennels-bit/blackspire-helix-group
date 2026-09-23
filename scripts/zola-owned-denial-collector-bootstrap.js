import {register} from 'node:module';
import {RENEWAL,renewalHash,renewalFail} from '../packages/zola-six-reads/owned-denial-renewal.js';
import {readRenewalJson,selectRenewalReceipt,readRenewalProof} from '../packages/zola-six-reads/owned-denial-host.js';
if(process.getuid?.()!==0||process.versions.node!=='22.23.1'||process.argv.length!==4
 ||process.argv[1]!=='/opt/blackspire-command/releases/'+RENEWAL.releaseSha+'/scripts/zola-six-read-collect.js'
 ||process.argv[2]!=='--premerge-held'||process.argv[3]!==RENEWAL.configPath)renewalFail();
const config=readRenewalJson(RENEWAL.configPath),proof=readRenewalProof(config);
const {openDenialSessionRuntime}=await import(RENEWAL.canonicalRoot+'/packages/zola-six-reads/denial-runtime.js');
const runtime=await openDenialSessionRuntime(RENEWAL.releaseSha);
try{if(renewalHash(runtime.profile)!==proof.intent.profileDigest)renewalFail();await runtime.assertCurrent();selectRenewalReceipt(config);}finally{runtime.close();}
register(new URL('../packages/zola-six-reads/owned-denial-loader.js',import.meta.url));
