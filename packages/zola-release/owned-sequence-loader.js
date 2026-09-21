import {fileURLToPath} from 'node:url';
import {transformOwnedSequenceSource} from './owned-sequence-overlay.js';
const canonical='file:///mnt/blackspire-builds/development-cache/0/workspaces/zola-final-release-20260921/packages/zola-release/';
const local=new URL('./',import.meta.url).href;
const names=['commander-sequence.js','retired-release-history.js'];
export async function load(url,context,nextLoad){
 const name=names.find(name=>url===canonical+name||url===local+name);
 const result=await nextLoad(url,context);
 if(!name)return result;
 if(result.format!=='module'||!fileURLToPath(url).endsWith('/'+name))throw Error('Owned sequence module refused');
 return {...result,source:transformOwnedSequenceSource(name,Buffer.from(result.source).toString('utf8'))};
}
