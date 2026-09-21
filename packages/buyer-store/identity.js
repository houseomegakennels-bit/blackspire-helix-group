import {execFileSync} from 'node:child_process';
import {fail} from './local-protocol.js';
export function resolveBuyerStoreIdentity({run=execFileSync,uid=process.getuid(),gid=process.getgid(),groups=process.getgroups()}={}){
 const command=(file,args)=>run(file,args,{encoding:'utf8',timeout:1000,maxBuffer:4096,env:{PATH:'/usr/bin:/bin'}}).trim();
 const user=command('/usr/bin/getent',['passwd','blackspire-buyer-store']).split(':');
 const group=command('/usr/bin/getent',['group','blackspire-buyer-store']).split(':');
 const ipc=command('/usr/bin/getent',['group','blackspire-buyer-store-client']).split(':');
 if(user.length!==7||user[0]!=='blackspire-buyer-store'||group.length!==4||group[0]!=='blackspire-buyer-store'||ipc.length!==4||ipc[0]!=='blackspire-buyer-store-client'
  ||uid===0||gid===0||Number(user[2])!==uid||Number(user[3])!==gid||Number(group[2])!==gid||!Number.isInteger(Number(ipc[2]))||Number(ipc[2])<=0||Number(ipc[2])===gid||!groups.includes(Number(ipc[2])))fail();
 return {uid,gid,ipcGroupId:Number(ipc[2])};
}
