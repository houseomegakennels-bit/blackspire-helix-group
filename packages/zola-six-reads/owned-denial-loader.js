import {RENEWAL,renewalFail} from './owned-denial-renewal.js';
import {createHash} from 'node:crypto';
const heldUrl='file://'+RENEWAL.canonicalRoot+'/packages/zola-release/production-held-operations.js';
const collectorUrl='file:///opt/blackspire-command/releases/'+RENEWAL.releaseSha+'/packages/zola-six-reads/collector-host.js';
export const SOURCES={"held": "f6b967b3d6c5043c7a00c49036763b45d7e8239ef46a033fb63d7e5524bce0f4", "collector": "a62c5dd9b97bf6a2c8d9dc10fe4cf7d6276a7b155de620553c20faeaf33d6f00"};
const replace=(source,needle,value)=>{const pieces=source.split(needle);if(pieces.length!==2)renewalFail();return pieces.join(value);};
export function transformRenewalSource(kind,source){
 if(!Object.hasOwn(SOURCES,kind)||createHash('sha256').update(source).digest('hex')!==SOURCES[kind])renewalFail();
 if(kind==='held')return replace(source,"[`${artifactRoot}/scripts/zola-six-read-collect.js`,premerge?", "[...(premerge?['--import','"+RENEWAL.root+"/scripts/zola-owned-denial-collector-bootstrap.js']:[]),`${artifactRoot}/scripts/zola-six-read-collect.js`,premerge?");
 source=replace(source,"const denialReceipt = [4,5,6,7].includes(config.version) ? readRootOwnedJson(config.denialReceiptPath, { groupId: 0 }) : null;",
  "const denialReceipt = config.version===6 ? selectRenewalReceipt(config) : [4,5,7].includes(config.version) ? readRootOwnedJson(config.denialReceiptPath, { groupId: 0 }) : null;");
 source=replace(source,'verifyDenialReceipt(receipt) {\n      assertIdentity();','verifyDenialReceipt(receipt) {\n      assertIdentity();\n      if(config.version===6){verifyRenewalDatabase(receipt,config,dbstat);assertIdentity();return;}');
 return "import {selectRenewalReceipt,verifyRenewalDatabase} from '"+RENEWAL.root+"/packages/zola-six-reads/owned-denial-host.js';\n"+source;
}
export async function load(url,context,nextLoad){const result=await nextLoad(url,context);const kind=url===heldUrl?'held':url===collectorUrl?'collector':null;
 if(!kind)return result;if(result.format!=='module')renewalFail();return {...result,source:transformRenewalSource(kind,Buffer.from(result.source).toString('utf8'))};}
