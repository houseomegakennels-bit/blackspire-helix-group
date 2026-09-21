import {createHash} from 'node:crypto';
const hash=value=>createHash('sha256').update(value).digest('hex');
// Persist received HTTP status before attempting to consume the response body.
export async function retainOwnedN8nResponse(response,{store,bodyDigest,operatorSha}){
 if(store)store.record('transport-headers',{version:1,status:response.status,method:'PATCH',credentialId:'RzOyDmXYmx58yZHi',bodyDigest,operatorSha});
 let chunks=[],size=0;try{for await(const chunk of response.body){size+=chunk.length;if(size>2*1024*1024)throw Error('Bounded n8n response exceeded');chunks.push(chunk);}}catch(error){if(store)store.record('transport-body',{version:1,status:response.status,complete:false,bytes:size,rawDigest:hash(Buffer.concat(chunks))});throw error;}
 const raw=Buffer.concat(chunks),text=raw.toString('utf8');let body;try{body=JSON.parse(text);}catch{body=text;}
 if(store)store.record('transport-body',{version:1,status:response.status,complete:true,bytes:size,rawDigest:hash(raw),responseDigest:hash(JSON.stringify(body))});return {status:response.status,body};
}
