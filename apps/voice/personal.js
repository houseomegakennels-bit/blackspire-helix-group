import { randomUUID, createHash } from 'node:crypto';

const fail=(status,message)=>Object.assign(new Error(message),{status});
const kinds=new Set(['reminder','memory','list','bill','appointment','note']);
const clean=(value,max,required=false)=>{
  if(typeof value!=='string'||value.length>max||(required&&!value.trim()))throw fail(400,'Check the text and try again.');
  return value.trim();
};
function validate(input) {
  if(!input||!kinds.has(input.kind))throw fail(400,'Choose a supported item type.');
  const item={kind:input.kind,title:clean(input.title,240,true),detail:clean(input.detail??'',4000),list:clean(input.list??'',80),due:null,amountCents:null,currency:'USD'};
  if(input.due!=null&&input.due!==''){
    if(typeof input.due!=='string'||!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z$/.test(input.due)||!Number.isFinite(Date.parse(input.due)))throw fail(400,'Choose a valid date and time.');
    item.due=new Date(input.due).toISOString();
    if(item.due!==input.due.replace(/Z$/,input.due.includes('.')?'Z':'.000Z'))throw fail(400,'Choose a valid calendar date.');
  }
  if(['reminder','bill','appointment'].includes(item.kind)&&!item.due)throw fail(400,'This item needs a date and time.');
  if(item.kind==='bill'&&input.amountCents!=null){
    if(!Number.isSafeInteger(input.amountCents)||input.amountCents<0||input.amountCents>100000000)throw fail(400,'Enter a valid amount.');
    item.amountCents=input.amountCents;
  }
  if(item.kind==='list'&&!item.list)item.list='My list';
  return item;
}

// Personal entries are user-authored data. They never confer workspace permissions.
export function createPersonalStore(db,{clock=Date.now}={}) {
  db.exec(`CREATE TABLE IF NOT EXISTS personal_items(
    id TEXT PRIMARY KEY, principal TEXT NOT NULL, workspace TEXT NOT NULL,
    payload TEXT NOT NULL, state TEXT NOT NULL DEFAULT 'open', revision INTEGER NOT NULL,
    created INTEGER NOT NULL, updated INTEGER NOT NULL);
    CREATE INDEX IF NOT EXISTS personal_owner ON personal_items(principal,workspace);
    CREATE TABLE IF NOT EXISTS personal_requests(
      principal TEXT NOT NULL,workspace TEXT NOT NULL,request_id TEXT NOT NULL,
      fingerprint TEXT NOT NULL,result TEXT NOT NULL,created INTEGER NOT NULL,
      PRIMARY KEY(principal,workspace,request_id));`);
  const scope=(principal,workspace)=>{
    if(typeof principal!=='string'||!principal||typeof workspace!=='string'||!workspace)throw fail(401,'Sign in and choose a workspace.');
  };
  const decode=row=>({id:row.id,...JSON.parse(row.payload),state:row.state,revision:row.revision,created:row.created,updated:row.updated});
  function list(principal,workspace){scope(principal,workspace);return db.prepare('SELECT * FROM personal_items WHERE principal=? AND workspace=? ORDER BY updated DESC').all(principal,workspace).map(decode);}
  function mutate(principal,workspace,request){
    scope(principal,workspace);
    if(typeof request.requestId!=='string'||!/^[A-Za-z0-9-]{16,100}$/.test(request.requestId))throw fail(400,'A request identifier is required.');
    const fingerprint=createHash('sha256').update(JSON.stringify({action:request.action,id:request.id,revision:request.revision,item:request.item})).digest('hex');
    db.exec('BEGIN IMMEDIATE');
    try{
      const old=db.prepare('SELECT fingerprint,result FROM personal_requests WHERE principal=? AND workspace=? AND request_id=?').get(principal,workspace,request.requestId);
      if(old){if(old.fingerprint!==fingerprint)throw fail(409,'Request changed. Refresh before trying again.');db.exec('COMMIT');return JSON.parse(old.result);}
      if(request.action!=='delete'&&db.prepare('SELECT count(*) n FROM personal_requests WHERE principal=? AND workspace=?').get(principal,workspace).n>=10000)throw fail(409,'Organizer history needs maintenance. Contact support.');
      let result;
      if(request.action==='create'){
        if(db.prepare('SELECT count(*) n FROM personal_items WHERE principal=? AND workspace=?').get(principal,workspace).n>=1000)throw fail(409,'Your organizer is full. Remove old items first.');
        const payload=validate(request.item),id=randomUUID(),now=clock();
        db.prepare('INSERT INTO personal_items(id,principal,workspace,payload,revision,created,updated) VALUES(?,?,?,?,1,?,?)').run(id,principal,workspace,JSON.stringify(payload),now,now);
        result={saved:true,id,revision:1};
      }else{
        const row=typeof request.id==='string'?db.prepare('SELECT * FROM personal_items WHERE id=? AND principal=? AND workspace=?').get(request.id,principal,workspace):null;
        if(!row)throw fail(404,'Item unavailable.');
        if(request.revision!==row.revision)throw fail(409,'This item changed. Refresh before saving.');
        if(request.action==='delete'){
          db.prepare('DELETE FROM personal_items WHERE id=?').run(row.id);result={deleted:true,id:row.id};
        }else if(request.action==='update'){
          const payload=validate(request.item);
          db.prepare('UPDATE personal_items SET payload=?,updated=?,revision=revision+1 WHERE id=?').run(JSON.stringify(payload),clock(),row.id);
          result={saved:true,id:row.id,revision:row.revision+1};
        }else if(['complete','reopen'].includes(request.action)){
          db.prepare('UPDATE personal_items SET state=?,updated=?,revision=revision+1 WHERE id=?').run(request.action==='complete'?'done':'open',clock(),row.id);
          result={saved:true,id:row.id,revision:row.revision+1};
        }else throw fail(400,'Unsupported action.');
      }
      // Receipts contain only IDs and revision numbers, never the deleted content.
      db.prepare('INSERT INTO personal_requests VALUES(?,?,?,?,?,?)').run(principal,workspace,request.requestId,fingerprint,JSON.stringify(result),clock());
      db.exec('COMMIT');return result;
    }catch(error){db.exec('ROLLBACK');throw error;}
  }
  function today(principal,workspace){
    const items=list(principal,workspace),now=clock(),end=now+86400000;
    return {asOf:new Date(now).toISOString(),window:'next-24-hours',overdue:items.filter(x=>x.state==='open'&&x.due&&Date.parse(x.due)<now),upcoming:items.filter(x=>x.state==='open'&&x.due&&Date.parse(x.due)>=now&&Date.parse(x.due)<end),unfinished:items.filter(x=>x.state==='open'&&['list','note'].includes(x.kind)),delivery:'in-app-only',connections:{calendar:false,inbox:false,weather:false,householdSharing:false,documentExtraction:false}};
  }
  return {list,mutate,today};
}
