import "server-only";

import { createHash, timingSafeEqual } from "node:crypto";

const routes: Record<string,string> = {
  "seller.opportunities.search":"/api/internal/capabilities/seller-opportunities",
  "buyer.profiles.search":"/api/internal/capabilities/buyer-profiles",
  "buyer.matches.search":"/api/internal/capabilities/buyer-profiles",
  "deal.records.search":"/api/internal/capabilities/deal-records",
  "deal.analysis.get":"/api/internal/capabilities/deal-analysis",
  "nexus.enrichment.status":"/api/internal/capabilities/nexus-enrichment",
};
const permissions: Record<string,string> = {
  "seller.opportunities.search":"seller.opportunities.read","buyer.profiles.search":"buyer.profiles.read",
  "buyer.matches.search":"buyer.matches.read","deal.records.search":"deal.records.read",
  "deal.analysis.get":"deal.analysis.read","nexus.enrichment.status":"nexus.enrichment.read",
};
const keys=["version","releaseSha","releaseRunId","apiGeneration","workerGeneration","workspaceId","principalId","principalSecurityVersion",
  "grantId","grantVersion","grantSecurityVersion","capabilityId","permission","taskId","attemptId","workerId","claimDigest","method","path",
  "bodySha256","issuedAt","expiresAt","proof"];
const safeId=(value:unknown)=>typeof value==="string"&&/^[A-Za-z0-9._:-]{1,256}$/.test(value);
const equal=(left:string,right:string)=>{const a=Buffer.from(left),b=Buffer.from(right);return a.length===b.length&&timingSafeEqual(a,b);};

export type ReceiverAuthority={bindingDigest:string};

// Public headers are only candidate material. Authority exists only after the
// Command API atomically consumes the opaque permit against current durable
// principal, grant, task, attempt and release-generation state.
export async function authorizeInternalCapability(request:Request,bodyBytes:string,workspaceId:unknown,capabilityId:string):Promise<ReceiverAuthority|null>{
 try{
  if(Buffer.byteLength(bodyBytes)>32768||typeof workspaceId!=="string")return null;
  const expectedToken=process.env.BLACKSPIRE_CAPABILITY_TOKEN?.trim()??"";
  const supplied=request.headers.get("authorization")??"";
  if(expectedToken.length<32||!supplied.startsWith("Bearer ")||!equal(supplied.slice(7),expectedToken))return null;
  const url=new URL(request.url);
  if(request.method!=="POST"||url.search!==""||routes[capabilityId]!==url.pathname)return null;
  const encoded=request.headers.get("x-blackspire-receiver-authority")??"";
  if(!/^[A-Za-z0-9_-]{100,8192}$/.test(encoded)||Buffer.from(encoded,"base64url").toString("base64url")!==encoded)return null;
  const authority=JSON.parse(Buffer.from(encoded,"base64url").toString("utf8")) as Record<string,unknown>;
  if(!authority||Array.isArray(authority)||Object.keys(authority).sort().join(",")!==[...keys].sort().join(",")||authority.version!==1
    ||authority.capabilityId!==capabilityId||authority.permission!==permissions[capabilityId]||authority.workspaceId!==workspaceId
    ||authority.method!=="POST"||authority.path!==url.pathname||authority.bodySha256!==createHash("sha256").update(bodyBytes).digest("hex")
    ||!safeId(authority.principalId)||!safeId(authority.taskId)||!safeId(authority.attemptId)||!safeId(authority.workerId)
    ||!/^[-a-f0-9]{36}$/.test(String(authority.releaseRunId??""))||!/^[a-f0-9]{40}$/.test(String(authority.releaseSha??""))
    ||![authority.apiGeneration,authority.workerGeneration].every(v=>/^[a-f0-9]{32}$/.test(String(v??"")))
    ||![authority.claimDigest,authority.bodySha256].every(v=>/^[a-f0-9]{64}$/.test(String(v??"")))
    ||!/^[A-Za-z0-9_-]{43}$/.test(String(authority.proof??""))
    ||![authority.principalSecurityVersion,authority.grantVersion,authority.grantSecurityVersion].every(v=>Number.isSafeInteger(v)&&Number(v)>=1)
    ||!Number.isSafeInteger(authority.issuedAt)||!Number.isSafeInteger(authority.expiresAt)||Number(authority.expiresAt)-Number(authority.issuedAt)!==15000
    ||Number(authority.expiresAt)<=Date.now()||Number(authority.issuedAt)>Date.now()+1000)return null;
  const frontendSha=(process.env.VERCEL_GIT_COMMIT_SHA||process.env.BLACKSPIRE_RECEIVER_RELEASE_SHA||"").trim();
  if(!/^[a-f0-9]{40}$/.test(frontendSha)||authority.releaseSha!==frontendSha)return null;
  const expectedWorkspace=process.env.BLACKSPIRE_SELLER_ENGINE_WORKSPACE_ID?.trim()??"";
  if(!safeId(expectedWorkspace)||authority.workspaceId!==expectedWorkspace)return null;
  const base=process.env.BLACKSPIRE_AUTHORITY_CONSUMER_URL?.trim()??"",token=process.env.BLACKSPIRE_AUTHORITY_CONSUMER_TOKEN?.trim()??"";
  const endpoint=new URL("/api/internal/capability-authority/consume",base);
  if(token.length<32||(endpoint.protocol!=="https:"&&!(endpoint.protocol==="http:"&&["127.0.0.1","localhost","::1"].includes(endpoint.hostname))))return null;
  const response=await fetch(endpoint,{method:"POST",redirect:"error",signal:AbortSignal.timeout(3000),
    headers:{"content-type":"application/json",authorization:`Bearer ${token}`},body:JSON.stringify({authority})});
  if(!response.body)return null;const reader=response.body.getReader(),chunks:Uint8Array[]=[];let size=0;
  try{while(true){const part=await reader.read();if(part.done)break;size+=part.value.byteLength;if(size>4096){await reader.cancel();return null;}chunks.push(part.value);}}
  finally{reader.releaseLock();}
  const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}if(!response.ok)return null;
  const result=JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(bytes));
  if(!result||Array.isArray(result)||Object.keys(result).sort().join(",")!=="bindingDigest,ok"||result.ok!==true||!/^[a-f0-9]{64}$/.test(result.bindingDigest))return null;
  const {proof: _proof,...claims}=authority;
  const proofDigest=createHash("sha256").update(String(authority.proof)).digest("hex");
  if(!equal(result.bindingDigest,createHash("sha256").update(JSON.stringify({...claims,proofDigest})).digest("hex")))return null;
  return Object.freeze({bindingDigest:result.bindingDigest});
 }catch{return null;}
}
