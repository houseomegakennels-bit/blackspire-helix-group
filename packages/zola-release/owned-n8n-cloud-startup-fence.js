export class OwnedCloudSettledReadError extends Error {constructor(){super('Cloud GET transport failed after settlement');}}
// Only a completed GET transport error can be retried. A raced deadline never
// carries that type, so still-running timed-out work cannot overlap a retry.
export async function runOwnedCloudStartupFence({fence,stable,record,now=()=>performance.now(),pause=ms=>new Promise(resolve=>setTimeout(resolve,ms))}){
 const started=now(),check=()=>{stable();if(now()-started>=55000)throw Error('Cloud startup deadline reached');};
 for(let attempt=1;attempt<=2;attempt++){
  check();record('POST_PROXY_FENCE_STARTED',attempt);
  try{await fence();check();record('POST_PROXY_FENCE_VERIFIED',attempt);return;}
  catch(error){record(error instanceof OwnedCloudSettledReadError?'POST_PROXY_TRANSPORT_SETTLED':'POST_PROXY_FENCE_STOPPED',attempt);check();if(!(error instanceof OwnedCloudSettledReadError)||attempt===2)throw error;await pause(250);check();}
 }
}
