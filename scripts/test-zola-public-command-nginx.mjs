import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {renderOwnedBuyerLocations} from '../packages/zola-release/owned-buyer-nginx.js';
import {preparePublicCommandConfiguration,PUBLIC_COMMAND_MAINTENANCE} from '../packages/zola-release/public-command-routing.js';
const root=fs.mkdtempSync(path.join(os.tmpdir(),'zola-public-nginx-'));let child,hits=0;
const upstream=http.createServer((req,res)=>{hits++;assert.equal(req.headers['x-forwarded-for'],'127.0.0.1');assert.equal(req.headers['x-forwarded-proto'],'https');assert.equal(req.headers['x-forwarded-host'],'command.blackspirehelix.com');req.resume();res.setHeader('content-type','application/json');res.end(JSON.stringify({path:req.url}));});upstream.listen(0,'127.0.0.1');await once(upstream,'listening');
const reserve=net.createServer();reserve.listen(0,'127.0.0.1');await once(reserve,'listening');const port=reserve.address().port;await new Promise(r=>reserve.close(r));
const request=(method,pathname)=>new Promise((resolve,reject)=>{const q=http.request({hostname:'127.0.0.1',port,path:pathname,method,headers:{host:'command.blackspirehelix.com','x-forwarded-for':'198.51.100.99','x-forwarded-proto':'http','x-forwarded-host':'foreign.invalid'}},r=>{r.resume();r.once('end',()=>resolve(r.statusCode));});q.setTimeout(3000,()=>q.destroy(Error('timeout')));q.once('error',reject);q.end();});
try{
 const before=`server {\n    listen 443 ssl;\n    server_name command.blackspirehelix.com;\n    ssl_certificate     /etc/letsencrypt/live/command.blackspirehelix.com/fullchain.pem;\n${renderOwnedBuyerLocations()}    location = /api/internal/capability-authority/consume { if ($request_method != POST) { return 404; } return 502; }\n${PUBLIC_COMMAND_MAINTENANCE}\n}\n`;
 const server=preparePublicCommandConfiguration(before).replace('listen 443 ssl;','listen 127.0.0.1:'+port+';').replace('    ssl_certificate     /etc/letsencrypt/live/command.blackspirehelix.com/fullchain.pem;\n','').replaceAll('127.0.0.1:8789','127.0.0.1:'+upstream.address().port);
 fs.writeFileSync(root+'/nginx.conf',`pid ${root}/nginx.pid;error_log ${root}/error.log;events {}http {access_log off;client_body_temp_path ${root}/body;${server}}`);
 child=spawn('/usr/sbin/nginx',['-p',root,'-c',root+'/nginx.conf','-g','daemon off;'],{stdio:'ignore'});const exited=once(child,'exit');
 let ready=false;for(let i=0;i<60;i++){try{if(await request('GET','/')===200){ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,50));}assert(ready);
 for(const uri of ['/jarvis','/jarvis.js','/api/auth/session','/api/tasks'])assert.equal(await request('GET',uri),200);
 assert.equal(await request('POST','/api/unified-input'),200);const count=hits;
 for(const [method,uri] of [['GET','/api/internal/buyer-store/v1/jobs-list'],['POST','/api/internal/buyer-store/v1/jobs-list?x=1'],['POST','/api/internal/buyer-store/v1/%6aobs-list'],['GET','/api/internal/capability-authority/consume']])assert.equal(await request(method,uri),404);
 assert.equal(hits,count);assert.equal(await request('POST','/api/internal/capability-authority/consume'),502);
 child.kill('SIGTERM');await exited;child=null;console.log(JSON.stringify({ok:true,actualNginx:true,publicUiApiRoutes:true,forwardedIdentityOverwritten:true,scopedDenialsPreserved:true,productionTouched:false}));
}finally{if(child){child.kill('SIGTERM');await once(child,'exit');}await new Promise(r=>upstream.close(r));fs.rmSync(root,{recursive:true,force:true});}
