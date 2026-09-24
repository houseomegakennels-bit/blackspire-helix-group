import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createHash, timingSafeEqual } from 'node:crypto';
import { stripTypeScriptTypes } from 'node:module';

const source=fs.readFileSync(new URL('../frontend/src/lib/internal-capability-auth.ts',import.meta.url),'utf8')
  .replace(/^import .*;\n/gm,'').replace(/^export type .*;\n/gm,'').replace('export async function','async function');
const bodyBytes=JSON.stringify({workspaceId:'authority-ws',limit:5}),now=Date.now();
const baseAuthority={version:1,releaseSha:'a'.repeat(40),releaseRunId:'11111111-1111-4111-8111-111111111111',apiGeneration:'b'.repeat(32),workerGeneration:'c'.repeat(32),
  workspaceId:'authority-ws',principalId:'principal',principalSecurityVersion:1,grantId:'grant',grantVersion:1,grantSecurityVersion:1,
  capabilityId:'seller.opportunities.search',permission:'seller.opportunities.read',taskId:'task',attemptId:'attempt',workerId:'worker',claimDigest:'d'.repeat(64),
  method:'POST',path:'/api/internal/capabilities/seller-opportunities',bodySha256:createHash('sha256').update(bodyBytes).digest('hex'),issuedAt:now,expiresAt:now+15000,proof:'e'.repeat(43)};
const binding=value=>{const {proof,...claims}=value;const proofDigest=createHash('sha256').update(proof).digest('hex');return createHash('sha256').update(JSON.stringify({...claims,proofDigest})).digest('hex');};
function load(fetchImpl){
 const process={env:{BLACKSPIRE_CAPABILITY_TOKEN:'x'.repeat(32),BLACKSPIRE_SELLER_ENGINE_WORKSPACE_ID:'authority-ws',VERCEL_GIT_COMMIT_SHA:'a'.repeat(40),BLACKSPIRE_AUTHORITY_CONSUMER_URL:'https://command.example.invalid',BLACKSPIRE_AUTHORITY_CONSUMER_TOKEN:'y'.repeat(32)}};
 return vm.runInNewContext(`${stripTypeScriptTypes(source)}\nauthorizeInternalCapability`,{Buffer,URL,TextDecoder,AbortSignal,createHash,timingSafeEqual,process,fetch:fetchImpl,Date});
}
function request(authority=baseAuthority,url='https://frontend.invalid/api/internal/capabilities/seller-opportunities',body=bodyBytes){
 return new Request(url,{method:'POST',headers:{authorization:`Bearer ${'x'.repeat(32)}`,'x-blackspire-receiver-authority':Buffer.from(JSON.stringify(authority)).toString('base64url')},body});
}

test('actual frontend validator consumes one exact authority and binds the API result',async()=>{
 let calls=0;const authorize=load(async(url,options)=>{calls++;assert.equal(String(url),'https://command.example.invalid/api/internal/capability-authority/consume');assert.equal(options.headers.authorization,`Bearer ${'y'.repeat(32)}`);return Response.json({ok:true,bindingDigest:binding(baseAuthority)});});
 const result=await authorize(request(),bodyBytes,'authority-ws','seller.opportunities.search');
 assert.equal(result.bindingDigest,binding(baseAuthority));assert.equal(calls,1);
});

test('actual frontend validator rejects missing, substituted, query-bearing, malformed and replayed authority',async()=>{
 let calls=0;const authorize=load(async()=>{calls++;return calls===1?Response.json({ok:true,bindingDigest:binding(baseAuthority)}):Response.json({error:'not found'},{status:404});});
 const missing=new Request('https://frontend.invalid/api/internal/capabilities/seller-opportunities',{method:'POST',headers:{authorization:`Bearer ${'x'.repeat(32)}`},body:bodyBytes});
 assert.equal(await authorize(missing,bodyBytes,'authority-ws','seller.opportunities.search'),null);
 for(const [authority,url,body,workspace,capability] of [
  [{...baseAuthority,principalId:'other'},undefined,bodyBytes,'authority-ws','seller.opportunities.search'],
  [baseAuthority,'https://frontend.invalid/api/internal/capabilities/seller-opportunities?x=1',bodyBytes,'authority-ws','seller.opportunities.search'],
  [baseAuthority,undefined,JSON.stringify({workspaceId:'authority-ws',limit:4}),'authority-ws','seller.opportunities.search'],
  [baseAuthority,undefined,bodyBytes,'other-ws','seller.opportunities.search'],
  [{...baseAuthority,proof:'bad'},undefined,bodyBytes,'authority-ws','seller.opportunities.search'],
 ])assert.equal(await authorize(request(authority,url,body),body,workspace,capability),null);
 assert.equal(calls,1);
 calls=0;
 assert.ok(await authorize(request(),bodyBytes,'authority-ws','seller.opportunities.search'));
 assert.equal(await authorize(request(),bodyBytes,'authority-ws','seller.opportunities.search'),null);
 assert.equal(calls,2);
});
