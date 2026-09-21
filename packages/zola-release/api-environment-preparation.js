import {randomBytes} from 'node:crypto';
import {hashAdminPassword,verifyAdminPassword} from '../shared/password-auth.js';

export const API_ENVIRONMENT_FILE='/etc/blackspire/command-api.env';
export const API_ENVIRONMENT_STATE='/var/lib/blackspire-operator/api-environment/state.json';
export const API_PASSWORD_FILE='/var/lib/blackspire-operator/zola-admin-password';
export const API_CONSUMER_TOKEN_FILE='/var/lib/blackspire-operator/authority-consumer-token';
const fail=()=>{throw new Error('API environment preparation rejected');};
const keys=['COMMAND_ADMIN_PASSWORD_HASH','SESSION_SECRET','ALLOW_BEARER_AUTH','COMMAND_ADMIN_TOKEN','BLACKSPIRE_AUTHORITY_CONSUMER_TOKEN'];
const token=value=>typeof value==='string'&&/^[A-Za-z0-9_-]{32,256}$/.test(value);
export function validateApiEnvironmentPlan(plan,{releaseSha,password,consumerToken}){
 if(!plan||Object.keys(plan).sort().join(',')!=='environment,releaseSha,schema'||plan.schema!==1||plan.releaseSha!==releaseSha
  ||!plan.environment||Object.keys(plan.environment).sort().join(',')!==[...keys].sort().join(','))fail();
 const env=plan.environment;
 if(!verifyAdminPassword(password,env.COMMAND_ADMIN_PASSWORD_HASH)||env.ALLOW_BEARER_AUTH!=='true'
  ||!token(env.SESSION_SECRET)||!token(env.COMMAND_ADMIN_TOKEN)||!token(consumerToken)
  ||env.BLACKSPIRE_AUTHORITY_CONSUMER_TOKEN!==consumerToken
  ||new Set([env.SESSION_SECRET,env.COMMAND_ADMIN_TOKEN,consumerToken,password]).size!==4)fail();
 return keys.map(key=>`${key}=${env[key]}\n`).join('');
}
// Retain generated credentials before publishing the absent API-only file. An
// interrupted publication reuses these same bytes; existing foreign files are
// never overwritten. The host owns all fixed-path/identity/ACL/service checks.
export async function prepareApiEnvironment({releaseSha},{host,generate=()=>randomBytes(32).toString('base64url')}={}){
 try{
  if(!/^[a-f0-9]{40}$/.test(releaseSha??''))fail();
  await host.assertStopped();const source=await host.readSource();
  let plan=await host.readPlan();
  if(!plan){
   if(await host.readEnvironment()!==null)fail();
   const environment={COMMAND_ADMIN_PASSWORD_HASH:hashAdminPassword(source.password),SESSION_SECRET:generate(),ALLOW_BEARER_AUTH:'true',
    COMMAND_ADMIN_TOKEN:generate(),BLACKSPIRE_AUTHORITY_CONSUMER_TOKEN:source.consumerToken};
   plan={schema:1,releaseSha,environment};validateApiEnvironmentPlan(plan,{releaseSha,...source});
   await host.assertStopped();await host.assertSource(source);await host.retainPlan(plan);
  }
  const bytes=validateApiEnvironmentPlan(plan,{releaseSha,...source});
  await host.assertStopped();await host.assertSource(source);
  const current=await host.readEnvironment();
  if(current!==null&&current!==bytes)fail();
  if(current===null)await host.publishAbsent(bytes);
  await host.assertStopped();await host.assertSource(source);
  if(await host.readEnvironment()!==bytes)fail();
  await host.verifyIsolation();
  return Object.freeze({status:'API_ENVIRONMENT_PREPARED',releaseSha,passwordPreserved:true,workerExcluded:true});
 }catch{fail();}
}
