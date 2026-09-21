import {createHash,randomUUID} from 'node:crypto';
import {validateOperationPermitSigningConfiguration} from './operation-permit-signer.js';
import {BUYER_WRITER_LOCAL_STATEMENTS} from './local-gateway-server.js';

const denied=()=>new Error('Buyer writer admitted client unavailable');
const UUID=/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/;
const exact=(value,keys)=>value!==null&&typeof value==='object'&&!Array.isArray(value)
  &&[Object.prototype,null].includes(Object.getPrototypeOf(value))
  &&Reflect.ownKeys(value).length===keys.length&&keys.every(key=>{
    const descriptor=Object.getOwnPropertyDescriptor(value,key);
    return descriptor?.enumerable&&Object.hasOwn(descriptor,'value');
  });

const AUTHORITY=['issuer','audience','subject','keyId','origin','releaseSha',
  'operationId','attemptId','workspace'];
const HANDLE=['version','outerAttemptId','authority','operation','requestId','jti','bodyDigest'];
const DIGEST=/^[a-f0-9]{64}$/;
const hash=value=>createHash('sha256').update(value).digest('hex');
// Digest comparison requires a value retained independently in the trusted journal.
// The handle is correlation metadata, never a bearer capability or replay request.
export function buyerWriterAdmissionHandleDigest(handle){
  if(!exact(handle,HANDLE)||handle.version!==1||!UUID.test(handle.outerAttemptId)
    ||!UUID.test(handle.requestId)||!UUID.test(handle.jti)||!DIGEST.test(handle.bodyDigest)
    ||!['issue','cancel','reconcile','apply','receipt'].includes(handle.operation)
    ||!exact(handle.authority,AUTHORITY))throw denied();
  validateOperationPermitSigningConfiguration(handle.authority,handle.authority.keyId);
  return hash(JSON.stringify({...Object.fromEntries(HANDLE.filter(key=>key!=='authority')
    .map(key=>[key,handle[key]])),authority:Object.fromEntries(AUTHORITY
    .map(key=>[key,handle.authority[key]]))}));
}

function operationInput(kind,text,values){
  if(!Array.isArray(values))throw denied();
  if(kind==='issuer'&&text===BUYER_WRITER_LOCAL_STATEMENTS.issue&&values.length===8){
    if(!UUID.test(values[7]))throw denied();
    return {operation:'issue',parameters:{p_job:values[0],p_owner:values[1],
      p_workspace:values[2],p_digest:values[3],p_context:JSON.parse(values[4]),
      p_expected_criteria:JSON.parse(values[5]),p_expected_updated_at:values[6],
      p_request:values[7]}};
  }
  if(kind==='issuer'&&text===BUYER_WRITER_LOCAL_STATEMENTS.cancel&&values.length===3)
    return {operation:'cancel',parameters:{p_job:values[0],p_owner:values[1],
      p_workspace:values[2]}};
  if(kind==='issuer'&&text===BUYER_WRITER_LOCAL_STATEMENTS.reconcile&&values.length===5)
    return {operation:'reconcile',parameters:{p_job:values[0],p_owner:values[1],
      p_workspace:values[2],p_request:values[3],p_expected_updated_at:values[4]}};
  if(kind==='runtime'&&text===BUYER_WRITER_LOCAL_STATEMENTS.apply&&values.length===3)
    return {operation:'apply',parameters:{p_digest:values[0],p_workspace:values[1],
      q:JSON.parse(values[2])}};
  if(kind==='runtime'&&text===BUYER_WRITER_LOCAL_STATEMENTS.receipt&&values.length===7)
    return {operation:'receipt',parameters:{p_digest:values[0],p_workspace:values[1],
      p_job:values[2],p_dispatch:values[3],p_generation:values[4],
      p_operation:values[5],p_index:values[6]}};
  throw denied();
}

function admittedResult(operation,response){
  if(!exact(response,['status','body'])||!Number.isInteger(response.status)
    ||response.body===null||typeof response.body!=='object'||Array.isArray(response.body))
    throw denied();
  if(response.status!==200){
    const error=denied();
    error.code=response.status===400?'22023':response.status===403?'42501'
      :response.status===409?'23505':'ADMISSION_UNAVAILABLE';
    throw error;
  }
  if(response.body.automaticRetry!==false)throw denied();
  const result={...response.body};
  delete result.automaticRetry;delete result.recovered;delete result.admissionCorrelation;
  if(operation==='cancel'){
    if(!exact(result,['cancelled','jobId'])||result.cancelled!==true)throw denied();
    return null;
  }
  return result;
}

export function createBuyerWriterAdmittedLocalClient({client,signer,configuration,
  now=Date.now,uuid=randomUUID}={}){
  if(!client||typeof client!=='object'||typeof client.admittedRequest!=='function'
    ||typeof client.runtimeQuery!=='function'||typeof client.checkAvailability!=='function'
    ||typeof client.isHealthy!=='function'||typeof client.close!=='function'
    ||!signer||typeof signer.sign!=='function'||!configuration
    ||typeof configuration!=='object'||Array.isArray(configuration)
    ||typeof now!=='function'||typeof uuid!=='function')throw denied();

  configuration=Object.freeze({...configuration});
  const admit=async(input,durable,raw=false)=>{
    if(durable!==undefined&&(!exact(durable,['outerAttemptId','persistHandle'])
      ||!UUID.test(durable.outerAttemptId)||typeof durable.persistHandle!=='function'))throw denied();
    const issuedAt=Math.floor(now()/1000),requestId=input.operation==='issue'
      ?input.parameters.p_request:uuid(),jti=uuid();
    let request;
    try{request=signer.sign({configuration,operation:input.operation,requestId,jti,
      issuedAt,expiresAt:issuedAt+30,parameters:input.parameters});}catch{throw denied();}
    if(!request||typeof request.body!=='string'||typeof request.token!=='string')throw denied();
    const body=Buffer.from(request.body,'utf8');
    if(durable!==undefined){
      const handle=Object.freeze({version:1,outerAttemptId:durable.outerAttemptId,
        authority:configuration,operation:input.operation,requestId,jti,bodyDigest:hash(body)});
      const digest=buyerWriterAdmissionHandleDigest(handle);
      try{await durable.persistHandle(handle,digest);}catch{throw denied();}
    }
    let response;
    try{response=await client.admittedRequest({origin:request.origin,method:request.method,
      path:request.path,rawHeaders:['content-type','application/json','content-length',
        String(body.length),'authorization','Bearer '+request.token],body});}
    catch{throw denied();}
    return raw?response:admittedResult(input.operation,response);
  };
  const query=kind=>async(text,values,durable)=>{
    if(kind==='runtime'&&text===BUYER_WRITER_LOCAL_STATEMENTS.context)
      return client.runtimeQuery(text,values);
    let input;
    try{input=operationInput(kind,text,values);}catch{throw denied();}
    return {rows:[{result:await admit(input,durable)}]};
  };
  const recover=async parameters=>{
    if(!exact(parameters,['p_workspace','p_owner','p_original_issuer','p_original_jti',
      'p_original_request','p_original_digest','p_route_operation']))throw denied();
    return admit({operation:'recover',parameters});
  };

  const recoverHandle=async(handle,{outerAttemptId,expectedHandleDigest}={})=>{
    // expectedHandleDigest must come from the caller's durable journal, not this handle.
    const digest=buyerWriterAdmissionHandleDigest(handle);
    if(!DIGEST.test(expectedHandleDigest)||digest!==expectedHandleDigest
      ||handle.outerAttemptId!==outerAttemptId
      ||AUTHORITY.some(key=>handle.authority[key]!==configuration[key]))throw denied();
    handle=Object.freeze({...handle,authority:Object.freeze({...handle.authority})});
    const parameters={p_workspace:configuration.workspace,p_owner:configuration.subject,
      p_original_issuer:handle.authority.issuer,p_original_jti:handle.jti,
      p_original_request:handle.requestId,p_original_digest:handle.bodyDigest,
      p_route_operation:handle.operation};
    const response=await admit({operation:'recover',parameters},undefined,true);
    const correlation=response?.body?.admissionCorrelation;
    if(response?.status!==200||response.body.recovered!==true
      ||!exact(correlation,['issuer','jti','requestId','bodyDigest','operation','requestCorrelated'])
      ||correlation.requestCorrelated!==true||correlation.issuer!==handle.authority.issuer
      ||correlation.jti!==handle.jti||correlation.requestId!==handle.requestId
      ||correlation.bodyDigest!==handle.bodyDigest||correlation.operation!==handle.operation)throw denied();
    return Object.freeze({result:admittedResult(handle.operation,response),
      requestCorrelated:true,handleDigest:digest});
  };

  return Object.freeze({
    runtimeQuery:query('runtime'),
    issuerQuery:query('issuer'),
    recover,
    recoverHandle,
    checkAvailability:()=>client.checkAvailability(),
    isHealthy:()=>client.isHealthy(),
    close:()=>client.close(),
  });
}
