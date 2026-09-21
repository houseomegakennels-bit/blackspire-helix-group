import {resolveBuyerStoreIdentity} from './identity.js';
import {createBuyerStoreAttestation} from './attestation.js';
import {createBuyerStoreHandler,createSupabaseBuyerUserVerifier,validateBuyerStoreInput} from './service.js';
import {createBuyerStoreRepository} from './repository.js';
import {loadBuyerStoreConfiguration,validateBuyerStoreConfiguration} from './configuration.js';
import {createBuyerStoreLocalServer,listenBuyerStore} from './local-server.js';
import {fail} from './local-protocol.js';
export async function startBuyerStoreRuntime({configuration=loadBuyerStoreConfiguration(),Client,listen=listenBuyerStore,resolveIdentity=resolveBuyerStoreIdentity}={}){
 const config=validateBuyerStoreConfiguration(configuration),identity=resolveIdentity();
 if(identity.ipcGroupId!==config.ipcGroupId)fail();
 const Driver=Client??(await import('pg')).Client;
 const connect=user=>async()=>{
  const client=new Driver({host:config.profile.host,port:config.profile.port,database:config.profile.database,user,
   password:user==='buyer_repository_login'?config.repositoryPassword:config.capabilityPassword,
   ssl:{rejectUnauthorized:true,ca:config.ca},connectionTimeoutMillis:3000,query_timeout:8000,statement_timeout:8000,application_name:'blackspire-buyer-store'});
  try{await client.connect();return client;}catch{await client.end().catch(()=>{});fail();}
 };
 const repository=createBuyerStoreRepository({connect:connect('buyer_repository_login'),connectCapability:connect('buyer_capability_login')});
 const verifyUser=createSupabaseBuyerUserVerifier({publicKey:config.publicKey,operatorOwnerId:config.operatorOwnerId});
 const server=createBuyerStoreLocalServer({configuration:config.client,attestation:createBuyerStoreAttestation(config),userHandler:createBuyerStoreHandler({repository,verifyUser}),
  readCapabilityProfiles:input=>repository.readCapabilityProfiles(input),validateInput:validateBuyerStoreInput});
 await listen(server,{ipcGroupId:config.ipcGroupId});return server;
}
