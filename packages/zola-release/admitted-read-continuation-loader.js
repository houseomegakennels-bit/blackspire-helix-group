import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
const root=fileURLToPath(new URL('../../',import.meta.url)).replace(/\/$/,'');
const target='file:///mnt/blackspire-builds/development-cache/0/workspaces/zola-owned-cloud-attempt9-20260923/scripts/zola-release-owned-n8n-operator.js';
const expected='f04d8c6eacde4f42fb2be67382b9c7db868d7511783e313dab76b735a5046c98';
const change=(s,a,b)=>{const parts=s.split(a);if(parts.length!==2)throw Error('Read recovery composition refused');return parts.join(b);};
export async function load(url,context,nextLoad){
 const result=await nextLoad(url,context);
 const namespaceRoots=['/mnt/blackspire-builds/development-cache/0/workspaces/zola-final-release-20260921','/mnt/blackspire-builds/development-cache/0/workspaces/zola-owned-cloud-attempt9-20260923'];
 if(namespaceRoots.some(r=>url==='file://'+r+'/packages/buyer-store/namespace.js')){
  const text=Buffer.from(result.source).toString('utf8');
  if(createHash('sha256').update(text).digest('hex')!=='23628ecbabdc9fdd8a29bf322811072ec9e05e6fee6798a50705bdecb9a04784')throw Error('Namespace source refused');
  return {...result,source:change(change(text,"['/', '/tmp','/dev'","['/', '/root','/var/tmp','/tmp','/dev'"),"  if(s.uid!==0||s.gid!==0)fail();","  if(s.uid!==0||s.gid!==0)fail();\n  if(relative==='/bin'){if(!s.isSymbolicLink()||s.nlink!==1||io.readlinkSync(filename)!=='usr/bin')fail();return;}")};
 }
 if(url!==target)return result;
 const original=Buffer.from(result.source).toString('utf8');
 if(result.format!=='module'||createHash('sha256').update(original).digest('hex')!==expected)throw Error('Read recovery source refused');
 let source=change(original,"return {...fixed,provider_acl_check:providerAdapter};","return wrapReadRecoveryOperations(context,{...fixed,provider_acl_check:providerAdapter});");
 source=change(source,"held:{activate,establishHeld:","held:{ensureWriterBinding:ensureReadRecoveryWriterBinding,activate,establishHeld:");
 source=change(source,"}catch{process.stdout.write(JSON.stringify({status:'STOPPED',reason:'OWNED_N8N_OPERATOR_REJECTED'", "}catch(error){console.error(String(error.stack).split('\\n').slice(1,5).join('\\n'));process.stdout.write(JSON.stringify({status:'STOPPED',reason:'OWNED_N8N_OPERATOR_REJECTED'");

 return {...result,source:"import {wrapReadRecoveryOperations} from '"+root+"/packages/zola-release/admitted-read-fresh-acceptance.js';\nimport {ensureReadRecoveryWriterBinding} from '"+root+"/packages/zola-release/admitted-read-postmerge-writer.js';\n"+source};
}
