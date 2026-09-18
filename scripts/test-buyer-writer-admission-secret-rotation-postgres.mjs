import assert from 'node:assert/strict';
import fs from 'node:fs';
import {execFileSync,spawnSync} from 'node:child_process';
import {generateKeyPairSync,randomBytes,randomUUID} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import pg from 'pg';
import {rotateBuyerWriterAdmissionSecret} from '../packages/buyer-writer/admission-secret-rotation.js';

const image=process.env.BUYER_WRITER_TEST_IMAGE
 ??'postgres@sha256:ef257d85f76e48da1c64832459b59fcaba1a4dac97bf5d7450c77753542eee94';
const name='zola-admission-rotation-'+process.pid+'-'+Date.now();
const adminPassword='disposable-admin-fixture',oldPassword=randomBytes(32).toString('base64url');
const newPassword=randomBytes(32).toString('base64url'),login='buyer_writer_admission_login';
const run=args=>execFileSync('docker',args,{encoding:'utf8',stdio:['ignore','pipe','pipe'],timeout:60_000}).trim();
const literal=value=>"'"+String(value).replaceAll("'","''")+"'";
let container=false,admin;
try{
  run(['run','--detach','--rm','--name',name,'-p','127.0.0.1::5432','-e','POSTGRES_PASSWORD='+adminPassword,image]);
  container=true;
  for(let i=0;i<120;i++){
    const ready=spawnSync('docker',['exec',name,'pg_isready','-U','postgres'],{stdio:'ignore'});
    if(ready.status===0)break;
    if(i===119)assert.fail('disposable PostgreSQL did not become ready');
    await delay(250);
  }
  const binding=run(['port',name,'5432/tcp']),port=Number(binding.slice(binding.lastIndexOf(':')+1));
  assert.ok(Number.isInteger(port)&&port>0);
  admin=new pg.Client({host:'127.0.0.1',port,database:'postgres',user:'postgres',password:adminPassword});
  admin.on('error',()=>{});await admin.connect();
  await admin.query('create role '+login+' login noinherit nosuperuser nocreatedb nocreaterole noreplication nobypassrls password '+literal(oldPassword));
  await admin.query(`create or replace function pg_temp.rotate_admission_secret(role_name name,secret text)
    returns void language plpgsql set search_path=pg_catalog as $$
    begin
      if role_name::text<>'buyer_writer_admission_login' or secret is null then raise exception 'rejected'; end if;
      execute format('alter role %I password %L',role_name,secret);
    end $$`);
  const ca=fs.readFileSync(new URL('../tests/fixtures/buyer-writer/supabase-production-ca.crt',import.meta.url),'utf8');
  const releaseSha='a'.repeat(40),operationId=randomUUID(),attemptId=randomUUID(),workspace='blackspire-command';
  const authority={releaseSha,operationId,attemptId,workspace,gatewayIdentity:'blackspire-writer'};
  const runtime={host:'127.0.0.1',port,database:'postgres',password:randomBytes(32).toString('base64url'),ca};
  const issuer={...runtime,password:randomBytes(32).toString('base64url')};
  const permit=JSON.stringify({issuer:'issuer',audience:'buyer-writer',subject:randomUUID(),keyId:'fixture',
    origin:'https://writer.invalid',releaseSha,operationId,attemptId,workspace});
  const oldConfiguration={version:3,mode:'research-admission',workspace,socketPath:'/run/blackspire/buyer-writer.sock',
    gatewayCapability:randomBytes(32).toString('base64url'),creatorOid:10,authority,runtime,issuer,admission:{
      connection:{host:'127.0.0.1',port,database:'postgres',user:login,password:oldPassword,ca},
      operationPermitConfiguration:permit,
      publicKeyPem:generateKeyPairSync('ed25519').publicKey.export({type:'spki',format:'pem'})}};
  const newConfiguration=structuredClone(oldConfiguration);
  newConfiguration.admission.connection.password=newPassword;
  let published='old';const events=[];
  const authenticate=async config=>{
    const client=new pg.Client({host:'127.0.0.1',port,database:'postgres',user:login,
      password:config.admission.connection.password,connectionTimeoutMillis:2000});
    client.on('error',()=>{});
    try{await client.connect();const result=await client.query('select current_user=$1 as safe',[login]);
      return result.rows.length===1&&result.rows[0].safe===true;
    }catch{return false;}finally{await client.end().catch(()=>{});}
  };
  const result=await rotateBuyerWriterAdmissionSecret({operationId:randomUUID(),oldConfiguration,newConfiguration,
    appendJournal:async event=>{events.push(event);return event;},now:Date.now,controls:{
      assertQuiesced:async()=>true,stopGateway:async()=>true,
      prepareConfiguration:async()=>({fixture:true}),
      bindPassword:async password=>{await admin.query('select pg_temp.rotate_admission_secret($1::name,$2::text)',[login,password]);return true;},
      authenticate,publishConfiguration:async()=>{published='new';return true;},
      startGateway:async()=>true,
      verify:async config=>published===(config.admission.connection.password===newPassword?'new':'old')&&await authenticate(config),
      restoreConfiguration:async()=>{published='old';return true;},
      finalizeConfiguration:async()=>true,
    }});
  assert.equal(result.status,'ROTATED');assert.equal(await authenticate(newConfiguration),true);
  assert.equal(await authenticate(oldConfiguration),false);assert.equal(events.at(-1).status,'COMPLETED');
  assert.equal(JSON.stringify([result,events]).includes(newPassword),false);
  process.stdout.write(JSON.stringify({ok:true,checks:5,postgres:'disposable',productionTouched:false})+'\n');
}finally{
  await admin?.end().catch(()=>{});
  if(container)try{run(['rm','-f',name]);}catch{}
}
