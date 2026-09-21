import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {stripTypeScriptTypes} from 'node:module';

const read=relative=>fs.readFileSync(new URL(`../frontend/src/${relative}`,import.meta.url),'utf8');
const executable=source=>stripTypeScriptTypes(source.replace(/^import[^;]+;\s*/gm,'').replace(/^export /gm,''));
function fixture(role,expiresAt) {
  const operator=role===null?null:{id:'operator',app_metadata:{blackspire_role:role,demo_expires_at:expiresAt}};
  const response={json:(body,options={})=>({body,status:options.status??200})};
  const guards=vm.runInNewContext(`${executable(read('lib/operator-access.ts'))}\n({guardSignedInApi,guardWorkspaceApi,requireSignedInPage,requireWorkspacePage,requireDemoViewerPage})`,{
    getAuthenticatedOperator:async()=>operator,listAuthUsers:async()=>[{id:'original-admin'},{id:'operator'}],
    NextResponse:response,redirect:location=>{throw new Error(`redirect:${location}`);},
  });
  let effects=0;
  const effect=async()=>{effects++;return{id:'book'};};
  const routes=['app/api/books/import/route.ts','app/api/chapters/[chapterId]/render-video/route.ts'].map(file=>
    vm.runInNewContext(`${executable(read(file))}\nPOST`,{
      guardSignedInApi:guards.guardSignedInApi,NextResponse:response,
      importBookFromStorageRef:effect,importBookFromUpload:effect,renderChapterVideo:effect,hydrateBookForClient:value=>value,
    }));
  return{guards,routes,effects:()=>effects};
}

test('demo/client/anonymous roles cannot reach Studio imports, video providers or signed-in pages',async()=>{
  for(const [role,expiry,status,destination] of [
    ['demo_viewer','2999-01-01T00:00:00Z',403,'/demo'],
    ['demo_viewer','2000-01-01T00:00:00Z',403,'/demo'],
    ['client_only',undefined,403,'/'],[undefined,undefined,403,'/'],
    [null,undefined,401,'/auth'],
  ]) {
    const f=fixture(role,expiry);
    const request={headers:{get:()=>{throw new Error('unauthorized request body reached');}},json:async()=>({})};
    for(const route of f.routes)assert.equal((await route(request,{params:Promise.resolve({chapterId:'chapter'})})).status,status);
    assert.equal(f.effects(),0);
    let pageReads=0;
    await assert.rejects(async()=>{await f.guards.requireSignedInPage();pageReads++;},error=>error.message===`redirect:${destination}`);
    assert.equal(pageReads,0);
  }
});

test('explicit admin and beta operators retain Studio and signed-in page access',async()=>{
  for(const role of ['admin','beta_tester']) {
    const f=fixture(role);
    const request={headers:{get:()=> 'application/json'},json:async()=>({})};
    for(const route of f.routes)assert.equal((await route(request,{params:Promise.resolve({chapterId:'chapter'})})).status,200);
    assert.equal(f.effects(),2);
    assert.equal((await f.guards.requireSignedInPage()).role,role);
  }
});

test('demo operators remain isolated from production and fail closed on invalid expiry',async()=>{
  for(const expiry of ['2999-01-01T00:00:00Z','2000-01-01T00:00:00Z',undefined,'invalid']) {
    const f=fixture('demo_operator',expiry);
    assert.equal((await f.guards.guardWorkspaceApi()).status,403);
    assert.equal((await f.guards.guardSignedInApi()).status,403);
    await assert.rejects(()=>f.guards.requireWorkspacePage());
    if(expiry==='2999-01-01T00:00:00Z')assert.equal((await f.guards.requireDemoViewerPage()).role,'demo_operator');
    else await assert.rejects(()=>f.guards.requireDemoViewerPage(),/demo-expired/);
  }
});


test('first-user compatibility never promotes explicit demo accounts in legacy admin checks',async()=>{
 const authSource=read('lib/buyer-engine-auth.ts');
 const adminFunction=authSource.slice(authSource.indexOf('export async function isAuthenticatedOperatorAdmin'));
 for(const role of ['demo_operator','demo_viewer','client_only','beta_tester','admin',undefined]) {
  const operator={id:'first-user',app_metadata:{blackspire_role:role}};
  const check=vm.runInNewContext(executable(adminFunction)+'\nisAuthenticatedOperatorAdmin',{getAuthenticatedOperator:async()=>operator,listAuthUsers:async()=>[operator]});
  assert.equal(await check(),role==='admin'||role===undefined);
 }
 const social=read('lib/social-os-server.ts');
 const start=social.indexOf('async function buildViewerFromAuthUser(');
 const end=social.indexOf('  const userMeta',start);
 const blocked=executable(social.slice(start,end)+' return "reached social authority";\n}');
 const viewer=vm.runInNewContext(blocked+'\nbuildViewerFromAuthUser',{});
 for(const role of ['demo_operator','demo_viewer'])assert.equal(await viewer({app_metadata:{blackspire_role:role}},{},[]),null);
});
