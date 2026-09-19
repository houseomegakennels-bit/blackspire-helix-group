import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {isIP} from 'node:net';
import {buildBuyerWorkflow} from './n8n-workflow.js';

const keys=['version','workflowId','workflowVersion','releaseSha','backupSha256','gatewayOrigin','webhookId','ingressCredentialId','writerCredentialId'];
const id=v=>typeof v==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(v);
const uuid=v=>typeof v==='string'&&/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(v);
const sha=v=>createHash('sha256').update(v).digest('hex');
const canonical=value=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'
  ?Object.fromEntries(Object.keys(value).sort().map(k=>[k,canonical(value[k])])):value;
const bytes=value=>JSON.stringify(canonical(value),null,2)+'\n';
function nodeId(workflowId,name){
  // RFC 4122 namespace UUID plus an unambiguous workflow/name pair. IDs carry no authority.
  const b=createHash('sha1').update(Buffer.from('718078e874dc4b4584fca44d0c4bb356','hex'))
    .update(JSON.stringify([workflowId,name])).digest().subarray(0,16);
  b[6]=(b[6]&15)|0x50;b[8]=(b[8]&63)|0x80;
  const h=b.toString('hex');return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}`;
}

// Pure offline packaging. Supplied references and claimed backup/release identity
// are NOT live credential resolution, backup verification or authority to apply.
// Never accepts the legacy secret-bearing export, API keys or writer secrets.
export function prepareBuyerWorkflowPackage(config){
  try{
    if(!config||Array.isArray(config)||Object.keys(config).length!==keys.length||keys.some(k=>!Object.hasOwn(config,k))
      ||config.version!==1||!id(config.workflowId)||!uuid(config.workflowVersion)||!id(config.webhookId)
      ||!(/^[a-f0-9]{40}$/).test(config.releaseSha??'')||!(/^[a-f0-9]{64}$/).test(config.backupSha256??''))throw new Error();
    for(const k of ['ingressCredentialId','writerCredentialId'])if(config[k]!==null&&!id(config[k]))throw new Error();
    if(config.ingressCredentialId!==null&&config.ingressCredentialId===config.writerCredentialId)throw new Error();
    if(config.gatewayOrigin!==null){
      const u=new URL(config.gatewayOrigin);
      if(u.protocol!=='https:'||u.origin!==config.gatewayOrigin||u.username||u.password||u.port||isIP(u.hostname)
        ||!u.hostname.includes('.')||u.hostname.endsWith('.local'))throw new Error();
    }
    const missing=['gatewayOrigin','ingressCredentialId','writerCredentialId'].filter(k=>config[k]===null);
    const sourceSha256=Object.fromEntries(['n8n-package','n8n-workflow','protocol','dates','source-context','normalize','plan']
      .map(name=>[name+'.js',sha(readFileSync(new URL('./'+name+'.js',import.meta.url)))]));
    let payload=null,inventory=[];
    if(!missing.length){
      const candidate=buildBuyerWorkflow(config);
      for(const n of candidate.nodes)n.id=nodeId(config.workflowId,n.name);
      if(new Set(candidate.nodes.map(n=>n.id)).size!==candidate.nodes.length)throw new Error();
      payload=bytes(candidate);
      inventory=candidate.nodes.map(n=>({name:n.name,type:n.type,credentialType:n.credentials?'httpHeaderAuth':null}));
    }
    const manifest={version:1,kind:'buyer-workflow-offline-package',status:missing.length?'requirements-pending':'offline-candidate',
      configuration:{...config},missing,payloadSha256:payload===null?null:sha(payload),sourceSha256,inventory,
      credentialResolution:'UNVERIFIED',liveRevisionAndBackupVerification:'REQUIRED',
      liveApplyAuthorized:false,providerAclGate:'REQUIRED',cloudExecutionTest:'NOT_RUN',
      transitionRequirements:['verify exact backup digest and live published revision','resolve both secure credential references',
        'verify gateway writer readiness and authenticated caller transition','coordinate exclusive workflow administration window',
        'reconcile uncertain updates read-only before any retry','capture protected published post-change snapshot']};
    return {manifest,manifestBytes:bytes(manifest),payload};
  }catch{throw new Error('Buyer workflow package configuration rejected');}
}
