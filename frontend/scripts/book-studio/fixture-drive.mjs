// In-memory transport for tests only; never a real Drive receipt.
import { createHash } from 'node:crypto';
const hash = bytes => createHash('md5').update(bytes).digest('hex');
export function fixtureDrive() {
 const objects = new Map(); let uploads = 0;
 const privateMeta = {shared:false,permissions:[{type:'user',role:'owner'}]};
 objects.set('folder',{meta:{id:'folder',mimeType:'application/vnd.google-apps.folder',...privateMeta}});
 return {objects,get uploads(){return uploads;}, async get(id){return structuredClone(objects.get(id)?.meta);},async list(parent,name){return [...objects.values()].filter(x=>x.meta.parents?.[0]===parent&&x.meta.name===name).map(x=>({id:x.meta.id}));},async upload(parent,name,bytes){const id=`file_${++uploads}`;objects.set(id,{bytes,meta:{id,name,size:String(bytes.length),md5Checksum:hash(bytes),parents:[parent],...privateMeta}});return{id};},async download(id){return objects.get(id).bytes;}};
}
