import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';

export const ADMISSION_SECRET_ROTATION_JOURNAL_ROOT='/var/lib/blackspire-operator/buyer-writer-admission-rotation';
const UUID=/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/;
const DIGEST=/^[a-f0-9]{64}$/;
const phases=new Set(['started','quiesced','prepared','database-commit-sent','database-new-confirmed',
  'configuration-published','gateway-ready','completed','rolled-back','fail-closed']);
const statuses=new Set(['IN_PROGRESS','COMPLETED','ROLLED_BACK','FAIL_CLOSED']);
const exact=(value,keys)=>value&&typeof value==='object'&&!Array.isArray(value)
  &&Object.keys(value).sort().join(',')===[...keys].sort().join(',');
const fail=()=>{throw new Error('Buyer writer admission secret rotation journal rejected');};
const hash=value=>createHash('sha256').update(value).digest('hex');

function eventBody(value,previousDigest){
  if(!exact(value,['version','kind','operationId','phase','status','oldConfigDigest','newConfigDigest','updatedAt'])
    ||value.version!==1||value.kind!=='buyer_writer_admission_secret_rotation'||!UUID.test(value.operationId??'')
    ||!phases.has(value.phase)||!statuses.has(value.status)||!DIGEST.test(value.oldConfigDigest??'')
    ||!DIGEST.test(value.newConfigDigest??'')||value.oldConfigDigest===value.newConfigDigest
    ||typeof value.updatedAt!=='string'||new Date(value.updatedAt).toISOString()!==value.updatedAt)fail();
  if(value.status==='IN_PROGRESS'&&!['started','quiesced','prepared','database-commit-sent','database-new-confirmed',
    'configuration-published','gateway-ready'].includes(value.phase)
    ||value.status==='COMPLETED'&&value.phase!=='completed'
    ||value.status==='ROLLED_BACK'&&value.phase!=='rolled-back'
    ||value.status==='FAIL_CLOSED'&&value.phase!=='fail-closed')fail();
  if(previousDigest!==null&&!DIGEST.test(previousDigest??''))fail();
  return {...value,previousDigest};
}
export function encodeAdmissionSecretRotationEvent(value,previousDigest=null){
  const body=eventBody(value,previousDigest),eventDigest=hash(JSON.stringify(body));
  return Object.freeze({...body,eventDigest});
}

export function inspectAdmissionSecretRotationJournal(text){
  try{
    if(typeof text!=='string'||Buffer.byteLength(text)>1024*1024||text&&!text.endsWith('\n'))fail();
    const rows=text?text.slice(0,-1).split('\n').map(line=>JSON.parse(line)):[];
    let previous=null,operationId=null,oldConfigDigest=null,newConfigDigest=null;
    for(const row of rows){
      if(!exact(row,['version','kind','operationId','phase','status','oldConfigDigest','newConfigDigest',
        'updatedAt','previousDigest','eventDigest'])||!DIGEST.test(row.eventDigest??''))fail();
      const {eventDigest,...body}=row;
      const rebuilt=encodeAdmissionSecretRotationEvent({
        version:body.version,kind:body.kind,operationId:body.operationId,phase:body.phase,status:body.status,
        oldConfigDigest:body.oldConfigDigest,newConfigDigest:body.newConfigDigest,updatedAt:body.updatedAt,
      },previous);
      if(JSON.stringify(rebuilt)!==JSON.stringify(row))fail();
      if(operationId!==null&&(row.operationId!==operationId||row.oldConfigDigest!==oldConfigDigest
        ||row.newConfigDigest!==newConfigDigest))fail();
      operationId=row.operationId;oldConfigDigest=row.oldConfigDigest;newConfigDigest=row.newConfigDigest;
      previous=eventDigest;
    }
    return Object.freeze({rows:Object.freeze(rows.map(Object.freeze)),lastDigest:previous});
  }catch(error){if(error?.message?.includes('journal rejected'))throw error;fail();}
}

function safeRoot(root,io){
  if(typeof root!=='string'||!path.isAbsolute(root)||path.resolve(root)!==root||root==='/')fail();
  const parent=path.dirname(root),p=io.lstatSync(parent);
  if(!p.isDirectory()||p.isSymbolicLink()||p.uid!==0||(p.mode&0o022)!==0)fail();
  try{
    const stat=io.lstatSync(root);
    if(!stat.isDirectory()||stat.isSymbolicLink()||stat.uid!==0||stat.gid!==0||(stat.mode&0o7777)!==0o700)fail();
  }catch(error){
    if(error?.code!=='ENOENT')throw error;
    io.mkdirSync(root,{mode:0o700});io.chownSync(root,0,0);io.chmodSync(root,0o700);
  }
}
function syncDirectory(directory,io){
  const fd=io.openSync(directory,fs.constants.O_RDONLY|fs.constants.O_DIRECTORY|fs.constants.O_NOFOLLOW);
  try{io.fsyncSync(fd);}finally{io.closeSync(fd);}
}

export function appendAdmissionSecretRotationJournal(value,{
  root=ADMISSION_SECRET_ROTATION_JOURNAL_ROOT,io=fs,uid=process.getuid?.(),
}={}){
  if(uid!==0)fail();
  let fd;
  try{
    safeRoot(root,io);const filename=path.join(root,'journal.jsonl');
    fd=io.openSync(filename,fs.constants.O_RDWR|fs.constants.O_CREAT|fs.constants.O_NOFOLLOW|fs.constants.O_CLOEXEC,0o600);
    const stat=io.fstatSync(fd);
    if(!stat.isFile()||stat.uid!==0||stat.gid!==0||stat.nlink!==1||(stat.mode&0o7777)!==0o600||stat.size>1024*1024)fail();
    const bytes=Buffer.alloc(stat.size);
    if(stat.size&&io.readSync(fd,bytes,0,bytes.length,0)!==bytes.length)fail();
    const history=inspectAdmissionSecretRotationJournal(bytes.toString('utf8'));
    const record=encodeAdmissionSecretRotationEvent(value,history.lastDigest);
    if(history.rows.length){
      const first=history.rows[0];
      if(first.operationId!==record.operationId||first.oldConfigDigest!==record.oldConfigDigest
        ||first.newConfigDigest!==record.newConfigDigest)fail();
    }
    const encoded=Buffer.from(JSON.stringify(record)+'\n');
    io.writeSync(fd,encoded,0,encoded.length,stat.size);io.fsyncSync(fd);syncDirectory(root,io);
    return record;
  }catch(error){if(error?.message?.includes('journal rejected'))throw error;fail();}
  finally{if(fd!==undefined)try{io.closeSync(fd);}catch{}}
}
