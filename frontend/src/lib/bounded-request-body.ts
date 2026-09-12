import "server-only";
export async function readBoundedRequestBody(request:Request,maxBytes=32768):Promise<string>{
 const declared=Number(request.headers.get("content-length")??"NaN");if(Number.isFinite(declared)&&(declared<0||declared>maxBytes))throw new Error("request refused");
 if(!request.body)throw new Error("request refused");const reader=request.body.getReader(),chunks:Uint8Array[]=[];let size=0;
 try{while(true){const part=await reader.read();if(part.done)break;size+=part.value.byteLength;if(size>maxBytes){await reader.cancel();throw new Error("request refused");}chunks.push(part.value);}}finally{reader.releaseLock();}
 const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}return new TextDecoder("utf-8",{fatal:true}).decode(bytes);
}
