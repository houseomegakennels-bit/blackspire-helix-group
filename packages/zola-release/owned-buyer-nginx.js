import {createHash} from 'node:crypto';
export const OWNED_BUYER_HTTP_OPERATIONS=Object.freeze(['jobs-list','job-get','job-create','reports-list','exports-list','export-create','counts','profiles-list']);
const hash=v=>createHash('sha256').update(v).digest('hex');
const fail=()=>{throw new Error('Owned Buyer Nginx preparation refused');};
export function renderOwnedBuyerLocations(){return '# BEGIN ZOLA OWNED BUYER STORE\n'+OWNED_BUYER_HTTP_OPERATIONS.map(operation=>{
 const uri='/api/internal/buyer-store/v1/'+operation;
 return `    location = ${uri} {
        if ($request_method != POST) { return 404; }
        if ($request_uri != "${uri}") { return 404; }
        client_max_body_size 32k;
        proxy_request_buffering on;
        proxy_next_upstream off;
        proxy_connect_timeout 2s;
        proxy_read_timeout 20s;
        proxy_send_timeout 20s;
        proxy_set_header Host $host;
        proxy_set_header Connection "";
        proxy_pass http://127.0.0.1:8789;
    }
`;}).join('')+'    # END ZOLA OWNED BUYER STORE\n\n';}
function blocks(source){const stack=[],result=[];let quote=null,comment=false;for(let i=0;i<source.length;i++){const c=source[i];if(comment){if(c==='\n')comment=false;continue;}if(c==='\\'){i++;continue;}if(quote){if(c===quote)quote=null;continue;}if(c==='"'||c==="'"){quote=c;continue;}if(c==='#'){comment=true;continue;}if(c==='{')stack.push(i);if(c==='}'){const start=stack.pop();if(start===undefined)fail();result.push({start,end:i});}}if(stack.length||quote)fail();return result;}
export function addOwnedBuyerNginxLocations(before){
 if(typeof before!=='string'||Buffer.byteLength(before)>65536||before.includes('/api/internal/buyer-store/v1/')||before.includes('BEGIN ZOLA OWNED BUYER STORE'))fail();
 const anchors=[...before.matchAll(/location\s+=\s+\/api\/internal\/capability-authority\/consume\s*\{/g)];if(anchors.length!==1)fail();const anchor=anchors[0].index;
 const parents=blocks(before).filter(b=>b.start<anchor&&anchor<b.end&&/\bserver\s*$/.test(before.slice(Math.max(0,b.start-32),b.start)));if(parents.length!==1)fail();
 const server=before.slice(parents[0].start,parents[0].end);
 if(!/^\s*server_name\s+command\.blackspirehelix\.com\s*;/m.test(server)||!/^\s*listen\s+(?:\[::\]:)?443\s+[^;]*\bssl\b[^;]*;/m.test(server))fail();
 return before.slice(0,anchor)+renderOwnedBuyerLocations()+before.slice(anchor);
}
export async function prepareOwnedBuyerNginx({releaseSha},{host}={}){
 await host.assertStopped();if(!/^[a-f0-9]{40}$/.test(releaseSha??'')||host.read('nginx.rejected.json'))fail();
 let plan=host.read('nginx-plan.json');
 if(!plan){await host.validate();const before=host.current();plan={version:1,releaseSha,before,after:addOwnedBuyerNginxLocations(before)};host.publish('nginx-plan.json',plan);}
 if(!plan||Object.keys(plan).sort().join(',')!=='after,before,releaseSha,version'||plan.version!==1||plan.releaseSha!==releaseSha||addOwnedBuyerNginxLocations(plan.before)!==plan.after)fail();host.publish('nginx-plan.json',plan);
 const current=host.current();if(current!==plan.before&&current!==plan.after)fail();
 const intent={version:1,releaseSha,beforeDigest:hash(plan.before),afterDigest:hash(plan.after)};host.publish('nginx.intent.json',intent);
 await host.assertStopped();host.replace(plan.before,plan.after);
 try{await host.validate();}catch{host.replace(plan.after,plan.before);await host.validate();host.publish('nginx.rejected.json',intent);fail();}
 const result=host.read('nginx.result.json');if(result&&JSON.stringify(result)!==JSON.stringify(intent))fail();
 if(!result)await host.reload();await host.verify();if(host.current()!==plan.after)fail();host.publish('nginx.result.json',intent);
 return{status:'OWNED_BUYER_NGINX_PREPARED',releaseSha,exactOperations:8};
}
