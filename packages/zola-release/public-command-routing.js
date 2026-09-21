import {createHash} from 'node:crypto';
import {renderOwnedBuyerLocations} from './owned-buyer-nginx.js';
const hash=v=>createHash('sha256').update(typeof v==='string'?v:JSON.stringify(v)).digest('hex');
const fail=()=>{throw new Error('Public command routing refused; retain protected state');};
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
export const PUBLIC_COMMAND_MAINTENANCE='    location / {\n        return 503;\n    }';
export const PUBLIC_COMMAND_PROXY=`    location / {
        client_max_body_size 25m;
        proxy_pass http://127.0.0.1:8789;
        proxy_http_version 1.1;
        proxy_set_header Connection "";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $remote_addr;
        proxy_set_header X-Forwarded-Proto https;
        proxy_set_header X-Forwarded-Host $host;
        proxy_intercept_errors off;
        proxy_next_upstream off;
        proxy_connect_timeout 5s;
        proxy_read_timeout 30s;
        proxy_send_timeout 30s;
    }`;
function blocks(source){const stack=[],result=[];let quote=null,comment=false;for(let i=0;i<source.length;i++){const c=source[i];if(comment){if(c==='\n')comment=false;continue;}if(c==='\\'){i++;continue;}if(quote){if(c===quote)quote=null;continue;}if(c==='"'||c==="'"){quote=c;continue;}if(c==='#'){comment=true;continue;}if(c==='{')stack.push(i);if(c==='}'){const start=stack.pop();if(start===undefined)fail();result.push({start,end:i});}}if(stack.length||quote)fail();return result;}
export function preparePublicCommandConfiguration(before){
 if(typeof before!=='string'||Buffer.byteLength(before)>65536||before.split(PUBLIC_COMMAND_MAINTENANCE).length!==2
  ||!before.includes(renderOwnedBuyerLocations())||!before.includes('server_name command.blackspirehelix.com;')
  ||!before.includes('ssl_certificate     /etc/letsencrypt/live/command.blackspirehelix.com/fullchain.pem;')
  ||!before.includes('location = /api/internal/capability-authority/consume {'))fail();
 const at=before.indexOf(PUBLIC_COMMAND_MAINTENANCE),brace=at+PUBLIC_COMMAND_MAINTENANCE.indexOf('{'),all=blocks(before);
 if(at>0&&before[at-1]!=='\n'||!all.some(v=>v.start===brace&&v.end===at+PUBLIC_COMMAND_MAINTENANCE.length-1))fail();
 const parents=all.filter(v=>v.start<brace&&v.end>brace&&/\bserver\s*$/.test(before.slice(Math.max(0,v.start-32),v.start)));if(parents.length!==1)fail();
 const server=before.slice(parents[0].start,parents[0].end);if(!/^\s*server_name\s+command\.blackspirehelix\.com\s*;/m.test(server)||!/^\s*listen\s+(?:\[::\]:)?443\s+[^;]*\bssl\b[^;]*;/m.test(server)||!server.includes(renderOwnedBuyerLocations()))fail();
 return before.replace(PUBLIC_COMMAND_MAINTENANCE,PUBLIC_COMMAND_PROXY);
}
function validate(plan,binding){
 if(!plan||Object.keys(plan).sort().join(',')!=='after,before,binding,version'||plan.version!==1||!same(plan.binding,binding)
  ||preparePublicCommandConfiguration(plan.before)!==plan.after)fail();return plan;
}
// Separate protected records preserve the existing release event grammar. All
// effects occur only with the caller's exclusive admission lease held.
export async function ensurePublicCommandRouting({host}){
 if(host.read('rejected')||host.read('restored'))fail();const binding=await host.authorize(),retained=host.read('plan');
 let plan=retained;
 if(!plan){await host.requireHeld();await host.validate();const before=host.current();plan={version:1,binding,before,after:preparePublicCommandConfiguration(before)};host.publish('plan',plan);}
 validate(plan,binding);host.publish('plan',plan);
 const receipt={version:1,planDigest:hash(plan)},result=host.read('result');
 if(result&&!same(result,receipt)||host.read('restored'))fail();
 const current=host.current();if(current!==plan.before&&current!==plan.after)fail();
 if(result){if(current!==plan.after)fail();await host.verify();return{status:'PUBLIC_COMMAND_ROUTING_VERIFIED',planDigest:hash(plan),intakeOpened:false};}
 await host.requireHeld();host.publish('intent',receipt);host.replace(plan.before,plan.after);
 try{await host.validate();}catch{host.replace(plan.after,plan.before);await host.validate();host.publish('rejected',receipt);fail();}
 if(host.read('rejected'))fail();await host.requireHeld();await host.reload();await host.verify();
 if(host.current()!==plan.after||!same(await host.authorize(),binding))fail();host.publish('result',receipt);
 return{status:'PUBLIC_COMMAND_ROUTING_VERIFIED',planDigest:hash(plan),intakeOpened:false};
}
export async function restorePublicCommandRouting({host}){
 const restoreBinding=await host.requireStoppedHeld();const plan=host.read('plan');if(!plan||plan.binding.releaseSha!==restoreBinding.releaseSha||plan.binding.newMainSha!==restoreBinding.newMainSha)fail();validate(plan,plan.binding);
 const receipt={version:1,planDigest:hash(plan)};if(!same(host.read('intent'),receipt))fail();
 if(![plan.before,plan.after].includes(host.current()))fail();host.publish('restore-intent',receipt);
 host.replace(plan.after,plan.before);await host.validate();await host.requireStoppedHeld();await host.reload();
 if(host.current()!==plan.before)fail();await host.verifyRestored();host.publish('restored',receipt);
 return{status:'PUBLIC_COMMAND_MAINTENANCE_RESTORED',planDigest:hash(plan),intakeOpened:false};
}
