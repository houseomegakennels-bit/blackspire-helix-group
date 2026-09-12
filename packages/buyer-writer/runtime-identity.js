import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const execute=promisify(execFile);
const numeric=value=>typeof value==='string'&&/^(0|[1-9][0-9]{0,9})$/.test(value)&&Number(value)<=4294967294?Number(value):null;

// Resolve fixed operating-system identities, never a group selected by the file
// being authorized. The API's primary group may be shared with the worker.
export async function resolveBuyerWriterIdentity({uid=process.getuid(),euid=process.geteuid(),gid=process.getgid(),egid=process.getegid(),groups=process.getgroups(),lookup=execute}={}) {
  try {
    const options={encoding:'utf8',timeout:1000,maxBuffer:4096,killSignal:'SIGKILL',env:{PATH:'/usr/bin:/bin'}};
    const started=performance.now();
    const [user,group,worker,workerUser]=await Promise.all([
      lookup('/usr/bin/getent',['passwd','blackspire-api'],options),
      lookup('/usr/bin/getent',['group','blackspire-api'],options),
      lookup('/usr/bin/id',['-G','blackspire-worker'],options),
      lookup('/usr/bin/getent',['passwd','blackspire-worker'],options),
    ]);
    if(performance.now()-started>2000)throw new Error();
    const record=(result,count,name='blackspire-api')=>{
      if(typeof result?.stdout!=='string'||result.stdout.length>4096)throw new Error();
      const line=result.stdout.trim();if(line.includes('\n')||line.includes('\r'))throw new Error();
      const fields=line.split(':');if(fields.length!==count||fields[0]!==name)throw new Error();return fields;
    };
    const userFields=record(user,7),groupFields=record(group,4),workerFields=record(workerUser,7,'blackspire-worker');
    const apiUid=numeric(userFields[2]),privateGid=numeric(groupFields[2]),workerUid=numeric(workerFields[2]);
    if(workerUid===null||workerUid===0||workerUid===apiUid||numeric(workerFields[3])===null||numeric(workerFields[3])===0||numeric(workerFields[3])===privateGid||apiUid===null||apiUid===0||privateGid===null||privateGid===0||numeric(userFields[3])!==privateGid||uid!==apiUid||euid!==apiUid||gid!==egid||gid===0)throw new Error();
    if(!Array.isArray(groups)||!new Set([...groups,gid]).has(privateGid))throw new Error();
    if(typeof worker?.stdout!=='string'||worker.stdout.length>4096)throw new Error();
    const workerGroups=worker.stdout.trim().split(/\s+/).map(numeric);
    if(!workerGroups.length||workerGroups.includes(null)||workerGroups.includes(privateGid))throw new Error();
    return Object.freeze({uid:apiUid,credentialGroupId:privateGid,workerUid});
  }catch{throw new Error('Buyer writer process identity unavailable');}
}
