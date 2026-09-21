import test from 'node:test';
import assert from 'node:assert/strict';
import {OWNED_POSTGRES_TARGET,validateOwnedPostgresProfile,ownedPostgresProfileDigest,ownedPostgresContainerArguments,OWNED_POSTGRES_HBA} from '../packages/buyer-writer/owned-postgres.js';
const profile={version:1,...OWNED_POSTGRES_TARGET,creatorOid:16384,systemIdentifier:'7544366000000000000',caSha256:'a'.repeat(64)};
test('owned target is exact and cluster-bound without ambient fallbacks',()=>{
 assert.deepEqual(validateOwnedPostgresProfile(profile),profile);
 assert.equal(ownedPostgresProfileDigest(profile),ownedPostgresProfileDigest(Object.fromEntries(Object.entries(profile).reverse())));
 for(const mutation of [{host:'provider.invalid'},{port:5432},{creatorOid:10},{systemIdentifier:'18446744073709551616'},{caSha256:'A'.repeat(64)},{kind:'supabase'},{password:'forbidden'}]) assert.throws(()=>validateOwnedPostgresProfile({...profile,...mutation}));
 assert.notEqual(ownedPostgresProfileDigest(profile),ownedPostgresProfileDigest({...profile,systemIdentifier:'7544366000000000001'}));
});
test('fixed container plan uses pinned image, loopback, resource limits and dedicated data volume',()=>{
 const args=ownedPostgresContainerArguments();
 assert.ok(args.includes('127.0.0.1:55432:5432'));assert.ok(args.includes(OWNED_POSTGRES_TARGET.image));
 assert.equal(args[args.indexOf('--pull')+1],'never');assert.equal(args[args.indexOf('--memory')+1],'768m');
 assert.ok(args.some(v=>v.includes('src=/mnt/blackspire-builds/zola-owned-postgres/data')));
 assert.ok(!args.some(v=>v.includes('password')||v.includes('supabase')));
 assert.match(OWNED_POSTGRES_HBA,/local all blackspire_cluster_admin peer map=bootstrap/);
 assert.doesNotMatch(OWNED_POSTGRES_HBA,/hostssl.*blackspire_cluster_admin/);
});
