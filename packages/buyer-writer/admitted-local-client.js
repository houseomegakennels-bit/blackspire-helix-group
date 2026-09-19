import {randomUUID} from 'node:crypto';
import {BUYER_WRITER_LOCAL_STATEMENTS} from './local-gateway-server.js';

const denied=()=>new Error('Buyer writer admitted client unavailable');
const UUID=/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/;
const exact=(value,keys)=>value!==null&&typeof value==='object'&&!Array.isArray(value)
  &&Object.keys(value).length===keys.length&&keys.every(key=>Object.hasOwn(value,key));

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
  delete result.automaticRetry;delete result.recovered;
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

  const admit=async(input)=>{
    const issuedAt=Math.floor(now()/1000),requestId=input.operation==='issue'
      ?input.parameters.p_request:uuid(),jti=uuid();
    let request;
    try{request=signer.sign({configuration,operation:input.operation,requestId,jti,
      issuedAt,expiresAt:issuedAt+30,parameters:input.parameters});}catch{throw denied();}
    if(!request||typeof request.body!=='string'||typeof request.token!=='string')throw denied();
    const body=Buffer.from(request.body,'utf8');
    let response;
    try{response=await client.admittedRequest({origin:request.origin,method:request.method,
      path:request.path,rawHeaders:['content-type','application/json','content-length',
        String(body.length),'authorization','Bearer '+request.token],body});}
    catch{throw denied();}
    return admittedResult(input.operation,response);
  };
  const query=kind=>async(text,values)=>{
    if(kind==='runtime'&&text===BUYER_WRITER_LOCAL_STATEMENTS.context)
      return client.runtimeQuery(text,values);
    let input;
    try{input=operationInput(kind,text,values);}catch{throw denied();}
    return {rows:[{result:await admit(input)}]};
  };
  const recover=async parameters=>{
    if(!exact(parameters,['p_workspace','p_owner','p_original_issuer','p_original_jti',
      'p_original_request','p_original_digest','p_route_operation']))throw denied();
    return admit({operation:'recover',parameters});
  };

  return Object.freeze({
    runtimeQuery:query('runtime'),
    issuerQuery:query('issuer'),
    recover,
    checkAvailability:()=>client.checkAvailability(),
    isHealthy:()=>client.isHealthy(),
    close:()=>client.close(),
  });
}
