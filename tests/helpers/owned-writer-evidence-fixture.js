import {BUYER_WRITER_ROUTINES,BUYER_WRITER_RUNTIME_ROUTINES,BUYER_WRITER_ISSUER_ROUTINES,BUYER_WRITER_ADMISSION_ROUTINES,BUYER_WRITER_PG_NET_FUNCTIONS} from '../../packages/buyer-writer/production-verifier.js';
import {BUYER_WRITER_ROUTINES as ROUTINE_POLICY} from '../../packages/buyer-writer/routine-policy.js';
const creatorOid=16388,ownerOid='16390';
const roleOids={buyer_writer_owner:ownerOid,buyer_writer_runtime:'16391',buyer_writer_issuer:'16392',buyer_writer_admission:'16393',buyer_writer_admission_login:'16394'};
const role=name=>({name,oid:roleOids[name],login:['buyer_writer_runtime','buyer_writer_issuer','buyer_writer_admission_login'].includes(name),inherit:false,superuser:false,createDb:false,
 createRole:false,replication:false,bypassRls:false});
const acl=(grantee,privilege,grantable,grantor='buyer_writer_owner')=>({grantor,grantee,privilege,grantable});
const fixture=()=>({
 roles:['buyer_writer_owner','buyer_writer_runtime','buyer_writer_issuer','buyer_writer_admission','buyer_writer_admission_login'].map(role),
 memberships:[
  {role:'buyer_writer_owner',roleOid:ownerOid,member:'postgres',memberOid:String(creatorOid),grantor:'postgres',grantorOid:String(creatorOid),memberLogin:true,grantorSuperuser:false,admin:false,inherit:false,set:true},
  {role:'buyer_writer_owner',roleOid:ownerOid,member:'postgres',memberOid:String(creatorOid),grantor:'fixture_admin',grantorOid:'10',memberLogin:true,grantorSuperuser:true,admin:true,inherit:false,set:false},
  {role:'buyer_writer_runtime',roleOid:'16391',member:'postgres',memberOid:String(creatorOid),grantor:'fixture_admin',grantorOid:'10',memberLogin:true,grantorSuperuser:true,admin:true,inherit:false,set:false},
  {role:'buyer_writer_issuer',roleOid:'16392',member:'postgres',memberOid:String(creatorOid),grantor:'fixture_admin',grantorOid:'10',memberLogin:true,grantorSuperuser:true,admin:true,inherit:false,set:false},
  {role:'buyer_writer_admission',roleOid:'16393',member:'postgres',memberOid:String(creatorOid),grantor:'fixture_admin',grantorOid:'10',memberLogin:true,grantorSuperuser:true,admin:true,inherit:false,set:false},
  {role:'buyer_writer_admission',roleOid:'16393',member:'buyer_writer_admission_login',memberOid:'16394',grantor:'postgres',grantorOid:String(creatorOid),memberLogin:true,grantorSuperuser:false,admin:false,inherit:false,set:true},
 ],
 schema:{name:'buyer_writer',owner:'buyer_writer_owner',edges:[acl('buyer_writer_owner','CREATE',false),
  acl('buyer_writer_owner','USAGE',false),acl('buyer_writer_runtime','USAGE',false),acl('buyer_writer_issuer','USAGE',false),acl('buyer_writer_admission','USAGE',false)]},
 routines:BUYER_WRITER_ROUTINES.map(signature=>{
  const policy=ROUTINE_POLICY.find(value=>value.signature===signature),creator=policy.owner==='creator';
  const runtime=BUYER_WRITER_RUNTIME_ROUTINES.includes(signature),issuer=BUYER_WRITER_ISSUER_ROUTINES.includes(signature),admission=BUYER_WRITER_ADMISSION_ROUTINES.includes(signature);
  const owner=creator?'postgres':'buyer_writer_owner',grantor=owner;
  return {signature,owner,ownerOid:creator?String(creatorOid):ownerOid,securityDefiner:policy.securityDefiner,
   language:policy.language,digest:policy.digest,config:[...policy.config],volatility:policy.volatility,kind:'f',strict:false,leakproof:false,parallel:'u',
   argumentNames:[...policy.arguments],result:policy.result,argumentDefaults:0,returnsSet:false,variadic:'0',hasAllArgumentTypes:false,hasArgumentModes:false,
   edges:[acl(owner,'EXECUTE',false,grantor),...(signature==='buyer_writer.lock_public_scope()'?[acl('buyer_writer_owner','EXECUTE',false,grantor)]:[]),
    ...(runtime?[acl('buyer_writer_runtime','EXECUTE',false,grantor)]:[]),...(issuer?[acl('buyer_writer_issuer','EXECUTE',false,grantor)]:[]),
    ...(admission?[acl('buyer_writer_admission','EXECUTE',false,grantor)]:[])],
   runtimeExecute:runtime,runtimeGrant:false,issuerExecute:issuer,issuerGrant:false,admissionExecute:admission,admissionGrant:false};
 }),
 targetRelations:['BuyerProfile','BuyerReport','CleanSale','RawSale','SearchJob'],targetPublicRelations:[],targetPublicColumns:[],directRelations:[],directSequences:[],schemaCreate:[],externalRoutines:[],
 bootstrapSuperuser:true,creatorOid:String(creatorOid),relationPolicySafe:true,routinePolicySafe:true,ownerPolicySafe:true,crossDatabaseConnect:[],
 databaseCreate:{buyer_writer_owner:false,buyer_writer_runtime:false,buyer_writer_issuer:false,buyer_writer_admission:false,buyer_writer_admission_login:false},
 databaseTemporary:{buyer_writer_owner:false,buyer_writer_runtime:false,buyer_writer_issuer:false,buyer_writer_admission:false,buyer_writer_admission_login:false},
 pgNet:BUYER_WRITER_PG_NET_FUNCTIONS.map(name=>({name,signature:`net.${name}()`,owner:'supabase_admin',
  publicExecute:true,ownerExecute:true,runtimeExecute:true,issuerExecute:true,admissionExecute:true})),
});
const denied=raw=>assert.throws(()=>verifyBuyerWriterProductionEvidence(raw,creatorOid),
 error=>error.message==='Buyer writer production verification failed');


export {fixture as writerEvidenceFixture};
