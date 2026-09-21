import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {renderOwnedBuyerLocations,OWNED_BUYER_HTTP_OPERATIONS} from '../packages/zola-release/owned-buyer-nginx.js';
const root=fs.mkdtempSync(path.join(os.tmpdir(),'zola-nginx-owned-'));let child,hits=0;
const upstream=http.createServer((req,res)=>{hits++;req.resume();res.end('isolated');});upstream.listen(0,'127.0.0.1');await once(upstream,'listening');
const reserve=net.createServer();reserve.listen(0,'127.0.0.1');await once(reserve,'listening');const port=reserve.address().port;await new Promise(r=>reserve.close(r));
const request=(method,pathname,body='')=>new Promise((resolve,reject)=>{const q=http.request({hostname:'127.0.0.1',port,path:pathname,method,headers:{'content-length':Buffer.byteLength(body)}},r=>{r.resume();r.once('end',()=>resolve(r.statusCode));});q.setTimeout(3000,()=>q.destroy(Error('timeout')));q.once('error',reject);q.end(body);});
try{
 const locations=renderOwnedBuyerLocations().replaceAll('127.0.0.1:8789','127.0.0.1:'+upstream.address().port);
 fs.writeFileSync(root+'/nginx.conf',`pid ${root}/nginx.pid;error_log ${root}/error.log;events {}http {access_log off;client_body_temp_path ${root}/body;server {listen 127.0.0.1:${port};${locations}location / {return 503;}}}`);
 child=spawn('/usr/sbin/nginx',['-p',root,'-c',root+'/nginx.conf','-g','daemon off;'],{stdio:['ignore','ignore','ignore']});const exited=once(child,'exit');
 let ready=false;for(let i=0;i<60;i++){try{if(await request('GET','/')===503){ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,50));}assert.ok(ready);
 for(const op of OWNED_BUYER_HTTP_OPERATIONS)assert.equal(await request('POST','/api/internal/buyer-store/v1/'+op,'{}'),200);
 assert.equal(hits,8);
 for(const [method,uri] of [['GET','jobs-list'],['POST','jobs-list?x=1'],['POST','%6aobs-list'],['POST','jobs-list/'],['POST','unknown'],['DELETE','job-create']])assert.notEqual(await request(method,'/api/internal/buyer-store/v1/'+uri),200);
 assert.equal(await request('POST','/api/internal/buyer-store/v1/job-create','x'.repeat(32769)),413);assert.equal(hits,8);
 child.kill('SIGTERM');await exited;child=null;
 console.log(JSON.stringify({ok:true,actualNginx:true,exactOperations:8,rawUriMethodAndSizeDenials:true,productionTouched:false}));
}finally{if(child){child.kill('SIGTERM');await once(child,'exit');}await new Promise(r=>upstream.close(r));fs.rmSync(root,{recursive:true,force:true});}
