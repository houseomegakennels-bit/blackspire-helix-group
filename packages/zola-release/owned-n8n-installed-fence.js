// Credentials stay inside protected readers and are never returned by this fence.
const fail=()=>{throw new Error('Owned n8n installed credential fence rejected');};
export function assertOwnedN8nInstalledIngress({manifest,ingress,source,releaseSha,artifactDigest}){
 const m=manifest.value,v=ingress.value;
 if(m?.schema!==1||m.kind!=='zola_installed_buyer_writer'||m.releaseSha!==releaseSha||m.artifactDigest!==artifactDigest||m.workspace!=='blackspire-command'
  ||!/^\/etc\/blackspire\/buyer-writer-ingress-[a-f0-9]{64}\.json$/.test(m.ingressConfig?.path??'')||m.ingressConfig.digest!==ingress.digest
  ||!v||Object.keys(v).sort().join(',')!=='bindingFile,issuerCredential,version,workspace,writerCredential'||v.version!==1||v.workspace!==m.workspace
  ||v.bindingFile!=='/etc/blackspire/buyer-writer-binding.json'||v.bindingFile!==source.bindingFile
  ||v.writerCredential!==source.writerCredential||v.issuerCredential!==source.issuerCredential
  ||typeof v.writerCredential!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(v.writerCredential)||typeof v.issuerCredential!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(v.issuerCredential)||v.writerCredential===v.issuerCredential)fail();
 return true;
}
export async function verifyOwnedN8nProtectedAsyncFence({snapshot,verifyAsync}){
 const before=snapshot();await verifyAsync();const after=snapshot();
 if(JSON.stringify(before)!==JSON.stringify(after))fail();
}
