// This operator recovery preserves the original uncertain request authority.
// A new code revision is independently fenced; it never relabels that request.
export const ORIGINAL_N8N_OPERATOR_SHA='5c7cc20350025db8339d8210a496a78cb51f6af4';
const fixed={releaseSha:'a8e05ef40e44b6695df5b30356af0e411fe36f1a',operationId:'c8b00904-7017-434a-918e-8aaadbae82fd',stageAttemptId:'f163d812-3711-471b-863a-038e85d59137'};
const fail=()=>{throw Error('Owned n8n recovery authority refused');};
export function assertOwnedN8nRecoveryAuthority({original,expected,currentOperatorSha}){
 if(!/^[a-f0-9]{40}$/.test(currentOperatorSha??'')||currentOperatorSha===ORIGINAL_N8N_OPERATOR_SHA||!original||original.operatorSha!==ORIGINAL_N8N_OPERATOR_SHA||Object.entries(fixed).some(([k,v])=>original[k]!==v||expected?.[k]!==v))fail();
 if(JSON.stringify(original)!==JSON.stringify({...expected,operatorSha:ORIGINAL_N8N_OPERATOR_SHA}))fail();
 return original;
}

export function createOwnedN8nRecoveryContinuation({withFence,proof,metadata}){
 const assertConfigured=async binding=>withFence(binding,async fence=>{
  const before=proof(binding),current=await metadata();
  if(JSON.stringify(current)!==JSON.stringify(before.after))fail();
  await fence();const after=proof(binding);if(JSON.stringify(before)!==JSON.stringify(after))fail();
 });
 return {assertConfigured,synchronize:assertConfigured};
}
