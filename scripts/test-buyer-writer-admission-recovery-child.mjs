import {readFileSync} from 'node:fs';
import pg from 'pg';
import {createAdmissionBridge} from '../packages/buyer-writer/admission-bridge.js';
import {createBuyerWriterAdmissionPostgres} from '../packages/buyer-writer/admission-postgres.js';

assertInput(process.versions.node==='22.23.1');
const input=JSON.parse(readFileSync(0,'utf8'));
assertInput(input&&typeof input==='object'&&!Array.isArray(input));
assertInput(Number.isInteger(input.expectedCreatorOid));
const request={
 origin:input.request.origin,method:input.request.method,path:input.request.path,
 rawHeaders:input.request.rawHeaders,body:Buffer.from(input.request.bodyBase64,'base64'),
};
const connection={...input.connection,ca:input.connection.ca};
let admission;
try{
 admission=await createBuyerWriterAdmissionPostgres({
  connection,expectedCreatorOid:input.expectedCreatorOid,Pool:pg.Pool,
 });
 const bridge=createAdmissionBridge({
  mode:'research-admission',configuration:input.configuration,
  verificationConfiguration:input.verificationConfiguration,admissionExecutor:admission.executor,
  now:()=>Math.floor(Date.now()/1000),
 });
 const response=await bridge(request);
 process.stdout.write(JSON.stringify(response));
}finally{await admission?.close();}

function assertInput(value){
 if(value!==true)throw new Error('Fresh recovery fixture rejected');
}
