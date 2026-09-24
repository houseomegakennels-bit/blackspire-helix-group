import test from 'node:test';
import assert from 'node:assert/strict';
import {resolveBuyerStoreApiGroup} from '../packages/buyer-store/identity.js';
test('API client credential lookup uses fixed private supplementary group, not shared primary group',()=>{
 const run=(_file,args)=>args[0]==='passwd'?'blackspire-api:x:1001:1000::/nonexistent:/usr/sbin/nologin':'blackspire-api:x:1002:';
 assert.equal(resolveBuyerStoreApiGroup({run,uid:1001,groups:[1000,1002]}),1002);
 assert.throws(()=>resolveBuyerStoreApiGroup({run,uid:1003,groups:[1000,1002]}));
 assert.throws(()=>resolveBuyerStoreApiGroup({run,uid:1001,groups:[1000]}));
});
