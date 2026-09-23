import {OWNED_SIX_READ,transformOwnedSixReadSource} from './owned-six-read-overlay.js';
const target='file://'+OWNED_SIX_READ.canonicalRoot+'/packages/zola-release/premerge-read-permit.js';
export async function load(url,context,nextLoad){
 const result=await nextLoad(url,context);if(url!==target)return result;
 if(result.format!=='module')throw Error('Owned six-read module refused');
 return {...result,source:transformOwnedSixReadSource(Buffer.from(result.source).toString('utf8'))};
}
