import fs from 'node:fs';
import {OWNED_BUYER_HTTP_OPERATIONS} from './owned-buyer-nginx.js';
import {execFileSync} from 'node:child_process';
import {readOwnedConfigurationBytes,publishOwnedConfigurationBytes} from './owned-buyer-configuration-host.js';
const file='/etc/nginx/sites-available/command.conf',enabled='/etc/nginx/sites-enabled/command.conf';
const fail=()=>{throw new Error('Owned Buyer Nginx host refused');};
const run=(cmd,args)=>execFileSync(cmd,args,{encoding:'utf8',timeout:15000,maxBuffer:65536,stdio:['ignore','pipe','pipe'],env:{PATH:'/usr/bin:/bin',LC_ALL:'C'}}).trim();
export function createOwnedBuyerNginxHost(configurationHost){
 const current=()=>{const s=fs.lstatSync(enabled);if(!s.isSymbolicLink()||s.uid!==0||fs.realpathSync(enabled)!==file)fail();return readOwnedConfigurationBytes(file,{mode:0o644});};
 return{
  read:configurationHost.read,publish:configurationHost.publish,
  async assertStopped(){await configurationHost.assertStopped();current();},
  current,replace:(before,after)=>publishOwnedConfigurationBytes(file,before,after,{mode:0o644}),
  validate:()=>run('/usr/sbin/nginx',['-t']),reload:()=>run('/usr/bin/systemctl',['reload','nginx.service']),
  verify(){for(const operation of OWNED_BUYER_HTTP_OPERATIONS){const status=run('/usr/bin/curl',['--silent','--show-error','--resolve','command.blackspirehelix.com:443:127.0.0.1','--connect-timeout','2','--max-time','5','--output','/dev/null','--write-out','%{http_code}','--request','POST','https://command.blackspirehelix.com/api/internal/buyer-store/v1/'+operation]);if(status!=='502')fail();}
   for(const [method,suffix] of [['GET','jobs-list'],['POST','jobs-list?unexpected=1'],['POST','%6aobs-list'],['DELETE','job-create']]){
   const status=run('/usr/bin/curl',['--silent','--show-error','--path-as-is','--resolve','command.blackspirehelix.com:443:127.0.0.1','--connect-timeout','2','--max-time','5','--output','/dev/null','--write-out','%{http_code}','--request',method,'https://command.blackspirehelix.com/api/internal/buyer-store/v1/'+suffix]);if(status!=='404')fail();}
  },
 };
}
