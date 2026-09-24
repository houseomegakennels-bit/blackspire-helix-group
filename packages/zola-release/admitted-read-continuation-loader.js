import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
const root=fileURLToPath(new URL('../../',import.meta.url)).replace(/\/$/,'');
const target='file:///mnt/blackspire-builds/development-cache/0/workspaces/zola-owned-cloud-attempt9-20260923/scripts/zola-release-owned-n8n-operator.js';
const expected='f04d8c6eacde4f42fb2be67382b9c7db868d7511783e313dab76b735a5046c98';
const change=(s,a,b)=>{const parts=s.split(a);if(parts.length!==2)throw Error('Read recovery composition refused');return parts.join(b);};
export async function load(url,context,nextLoad){
 const result=await nextLoad(url,context);if(url!==target)return result;
 const original=Buffer.from(result.source).toString('utf8');
 if(result.format!=='module'||createHash('sha256').update(original).digest('hex')!==expected)throw Error('Read recovery source refused');
 let source=change(original,"return {...fixed,provider_acl_check:providerAdapter};","return wrapReadRecoveryOperations(context,{...fixed,provider_acl_check:providerAdapter});");
 source=change(source,"held:{activate,establishHeld:","held:{ensureWriterBinding:ensureReadRecoveryWriterBinding,activate,establishHeld:");
 return {...result,source:"import {wrapReadRecoveryOperations} from '"+root+"/packages/zola-release/admitted-read-fresh-acceptance.js';\nimport {ensureReadRecoveryWriterBinding} from '"+root+"/packages/zola-release/admitted-read-postmerge-writer.js';\n"+source};
}
