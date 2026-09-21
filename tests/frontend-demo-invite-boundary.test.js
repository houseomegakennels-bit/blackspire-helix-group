import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createHash} from 'node:crypto';
import {stripTypeScriptTypes} from 'node:module';
const executable=file=>stripTypeScriptTypes(fs.readFileSync(new URL(`../frontend/src/${file}`,import.meta.url),'utf8')
 .replace(/^import[^;]+;\s*/gm,'').replace(/^export /gm,''));
const response={json:(body,options={})=>({body,status:options.status??200,cookies:{set(){}}})};
function fixture({lost=false,expiredDuringCreate=false,activationError=false,signInThrows=false,accessLevel='read_only'}={}){
 const events=[],users=new Map();let clock=Date.parse('2026-09-21T00:00:00Z');
 const invite={id:'invite',access_level:accessLevel,access_days:7,expires_at:new Date(clock+1000).toISOString(),claimed_at:null};
 const auth={async createUser(input){events.push('create');users.set('new',{...input});if(expiredDuringCreate)clock+=2000;
  return {data:{user:{id:'new'}},error:null};},
  async deleteUser(){events.push('delete');return {error:new Error('deletion unavailable')};},
  async updateUserById(id,patch){events.push('promote');assert.equal(invite.claimed_by,id);
   if(activationError)return {error:new Error('unavailable')};users.set(id,{...users.get(id),...patch});return {error:null};}};
 const admin={auth:{admin:auth},from(){let update=null,expiry=null;return {
  select(){return this;},eq(){return this;},is(){return this;},gt(column,value){assert.equal(column,'expires_at');expiry=value;return this;},
  update(value){update=value;return this;},async maybeSingle(){if(!update)return {data:{...invite},error:null};
   events.push('claim');assert.equal(users.get('new').app_metadata.blackspire_role,'client_only');assert.equal(users.get('new').email_confirm,false);
   if(lost||!expiry||Date.parse(invite.expires_at)<=Date.parse(expiry))return {data:null,error:null};
   Object.assign(invite,update);return {data:{id:invite.id},error:null};}};}};
 class Clock extends Date{static now(){return clock;}constructor(...args){super(...(args.length?args:[clock]));}}
 const POST=vm.runInNewContext(`${executable('app/api/demo/claim/route.ts')}\nPOST`,{
  createHash,Date:Clock,NextResponse:response,process:{env:{NODE_ENV:'test'}},
  ACCESS_TOKEN_COOKIE:'access',REFRESH_TOKEN_COOKIE:'refresh',createAdminSupabaseAuthClient:()=>admin,
  createPublicSupabaseAuthClient:()=>({auth:{async signInWithPassword(){events.push('signin');if(signInThrows)throw new Error('offline');return {data:{session:{access_token:'test',refresh_token:'test'}},error:null};}}}),
 });
 return {events,users,invite,run:()=>POST({json:async()=>({token:'x'.repeat(43),email:'demo@example.invalid',password:'test-password'})})};
}
test('losing or newly expired invite cannot create demo authority even when deletion fails',async()=>{
 for(const options of [{lost:true},{expiredDuringCreate:true}]){
  const f=fixture(options),result=await f.run();assert.equal(result.status,409);
  assert.equal(f.users.get('new').email_confirm,false);assert.equal(f.users.get('new').app_metadata.blackspire_role,'client_only');
  assert.equal(f.events.includes('promote'),false);assert.equal(f.events.includes('signin'),false);
 }
});
test('valid invite promotes only after exclusive claim and retains account on sign-in outage',async()=>{
 for(const options of [{},{signInThrows:true}]){
  const f=fixture(options),result=await f.run();assert.equal(result.status,options.signInThrows?500:200);
  assert.equal(f.users.get('new').app_metadata.blackspire_role,'demo_viewer');assert.equal(f.users.get('new').email_confirm,true);
  assert.deepEqual(f.events,['create','claim','promote','signin']);
 }
});
test('failed promotion never reaches sign-in or leaves demo authority',async()=>{
 const f=fixture({activationError:true});assert.equal((await f.run()).status,500);
 assert.equal(f.users.get('new').app_metadata.blackspire_role,'client_only');assert.equal(f.events.includes('signin'),false);
});
test('demo expiry missing, malformed, or past fails closed; valid future expiry permits demo',async()=>{
 for(const expiry of [undefined,null,'','not-a-date','2000-01-01T00:00:00Z','2999-01-01T00:00:00Z']){
  const guard=vm.runInNewContext(`${executable('lib/operator-access.ts')}\nrequireDemoViewerPage`,{
   getAuthenticatedOperator:async()=>({id:'demo',app_metadata:{blackspire_role:'demo_viewer',demo_expires_at:expiry}}),
   listAuthUsers:async()=>[],NextResponse:response,redirect:where=>{throw new Error(where);},
  });
  if(expiry?.startsWith('2999'))assert.equal((await guard()).expired,false);
  else await assert.rejects(guard,/demo-expired/);
 }
});

test('isolated operator invitation grants its selected role only after the exclusive claim',async()=>{
 const valid=fixture({accessLevel:'real_estate_operator'});assert.equal((await valid.run()).status,200);assert.equal(valid.users.get('new').app_metadata.blackspire_role,'demo_operator');assert.deepEqual(valid.events,['create','claim','promote','signin']);
 for(const options of [{lost:true},{expiredDuringCreate:true},{activationError:true}]){const f=fixture({...options,accessLevel:'real_estate_operator'});await f.run();assert.equal(f.users.get('new').app_metadata.blackspire_role,'client_only');assert.equal(f.events.includes('signin'),false);}
});
