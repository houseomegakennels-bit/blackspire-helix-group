import {hash} from './commander-journal.js';
const keys=['releaseSha','previousMainSha','recoverySha','protectedInputDigest','workspace','principal','inputDigest'];
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const fail=()=>{throw new Error('Owned provider input binding rejected');};
// Only the external successor operator uses this adapter. The native sequence
// input and its journal digest remain unchanged.
export function bindOwnedProviderInput({operation,input,release,protectedInputDigest,fence}){
 if(release?.schema!==3||(release.releaseSha!=='a8e05ef40e44b6695df5b30356af0e411fe36f1a'&&!(release.releaseSha==='f1f004ffcfe43ff92271ed3618f9b3d3bb7ac57e'&&release.operationId==='b9679cbd-5331-45ae-a026-02b7f5e117e9'&&release.profileDigest==='2563185421523bf337e382a38ca389c5991406cb2adecc952048cdf5cf058505'))||release.backendProfile!=='owned-postgres-v1'
  ||!(/^[a-f0-9]{64}$/).test(release.profileDigest??'')||typeof fence!=='function')fail();
 const base={releaseSha:release.releaseSha,previousMainSha:release.previousMainSha,recoverySha:release.recoverySha,
  protectedInputDigest,workspace:release.workspace,principal:release.principal};
 const expected={...base,inputDigest:hash(base)},captured=JSON.stringify(expected);
 const validate=args=>{
  if(!args?.input||Object.keys(args.input).sort().join(',')!==[...keys].sort().join(',')
   ||JSON.stringify(args.input)!==captured||JSON.stringify(input)!==captured
   ||args.state?.context?.operationId!==release.operationId
   ||!keys.every(k=>args.state.context[k]===expected[k])||args.ordinal!==7
   ||(args.attemptId!==undefined&&args.attemptId!==null)
   ||(args.inputDigest!==undefined&&(!(/^[a-f0-9]{64}$/).test(args.checkOutputDigest??'')||args.inputDigest!==hash({sequence:expected.inputDigest,stage:'provider_acl_check',ordinal:7,check:args.checkOutputDigest}))))fail();
 };
 const result={};
 for(const method of ['check','observe']){
  if(typeof operation?.[method]!=='function')fail();
  result[method]=async args=>{
   validate(args);const before=await fence();validate(args);
   const output=await operation[method]({...args,input:Object.freeze({...expected,backendProfile:release.backendProfile,profileDigest:release.profileDigest})});
   const after=await fence();validate(args);if(!same(before,after))fail();return output;
  };
 }
 return Object.freeze(result);
}
