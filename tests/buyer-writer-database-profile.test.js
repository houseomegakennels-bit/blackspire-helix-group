import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {OWNED_POSTGRES_TARGET,ownedPostgresProfileDigest} from '../packages/buyer-writer/owned-postgres.js';
import {validateManagementCredential,validateDatabaseTarget,verifyOwnedDatabaseIdentity,readOwnedDatabaseProfile} from '../packages/buyer-writer/database-profile.js';
const ca='-----BEGIN CERTIFICATE-----\nfixture\n-----END CERTIFICATE-----';
const profile={version:1,...OWNED_POSTGRES_TARGET,creatorOid:16401,systemIdentifier:'123456789',caSha256:createHash('sha256').update(ca).digest('hex')};
const credential={backendProfile:'owned-postgres-v1',profileDigest:ownedPostgresProfileDigest(profile),host:'127.0.0.1',password:'isolated-password',ca};
test('management target requires explicit descriptor-bound fixed owned endpoint',()=>{
 assert.deepEqual(validateManagementCredential(credential,{ownedProfile:profile}),{host:'127.0.0.1',port:55432,database:'postgres',user:'postgres',password:credential.password,ca});
 for(const patch of [{backendProfile:undefined},{profileDigest:'a'.repeat(64)},{host:'localhost'},{ca:ca+'x'},{port:5432}])assert.throws(()=>validateManagementCredential({...credential,...patch},{ownedProfile:profile}),/rejected/);
 assert.throws(()=>validateManagementCredential(credential),/rejected/);
 assert.throws(()=>validateDatabaseTarget({...credential,port:5432,database:'postgres'},{ownedProfile:profile}),/rejected/);
 assert.throws(()=>validateManagementCredential({host:'127.0.0.1',password:'x',ca}),/rejected/);
});
test('fresh server identity must match owned descriptor, including creator and system identifier',async()=>{
 const row={systemIdentifier:profile.systemIdentifier,database:'postgres',actor:'postgres',creatorOid:profile.creatorOid,version:170005,recovery:false};
 assert.equal(await verifyOwnedDatabaseIdentity({query:async()=>({rows:[row]})},profile),true);
 for(const patch of [{systemIdentifier:'123456788'},{creatorOid:16388},{actor:'blackspire_cluster_admin'},{recovery:true},{version:160000},{extra:true}])await assert.rejects(()=>verifyOwnedDatabaseIdentity({query:async()=>({rows:[{...row,...patch}]})},profile),/rejected/);
});
test('protected profile snapshot rejects replacement and non-root ownership',()=>{
 const snapshot={value:profile,identity:{uid:0,gid:0,mode:0o600}};
 assert.deepEqual(readOwnedDatabaseProfile({readSnapshot:()=>snapshot}),profile);
 let calls=0;assert.throws(()=>readOwnedDatabaseProfile({readSnapshot:()=>++calls===1?snapshot:{...snapshot,value:{...profile,creatorOid:16402}}}),/rejected/);
 assert.throws(()=>readOwnedDatabaseProfile({readSnapshot:()=>({...snapshot,identity:{uid:0,gid:1,mode:0o600}})}),/rejected/);
});

test('owned TLS verifies the configured IP despite pg omitting IP SNI',async()=>{
 const {databaseTlsOptions}=await import('../packages/buyer-writer/database-profile.js');
 const tls=databaseTlsOptions(validateManagementCredential(credential,{ownedProfile:profile}));
 assert.equal(tls.rejectUnauthorized,true);assert.equal(tls.ca,ca);
 assert.equal(tls.checkServerIdentity('localhost',{subjectaltname:'IP Address:127.0.0.1'}),undefined);
 assert.ok(tls.checkServerIdentity('localhost',{subjectaltname:'DNS:localhost'}) instanceof Error);
 assert.ok(tls.checkServerIdentity('127.0.0.1',{subjectaltname:'IP Address:127.0.0.2'}) instanceof Error);
});
