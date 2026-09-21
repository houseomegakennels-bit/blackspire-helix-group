import {validateCollectorConfig} from './collector.js';
import {validateOwnedAcceptanceTargetDocument} from '../buyer-writer/owned-acceptance-target-preparation.js';
import {validateOwnedDatabaseProfile,databaseProfileDigest,OWNED_DATABASE_MANAGEMENT,LEGACY_DATABASE_MANAGEMENT} from '../buyer-writer/database-profile.js';
const fail=()=>{throw new Error('Owned collector configuration preparation rejected');};
// Pure construction: stage configuration must already contain authenticated
// session paths, observed process IDs and the authorized acceptance epoch. This
// does not issue sessions/permits or claim the collector has run successfully.
export function prepareOwnedCollectorConfiguration({configuration,profile,target}){
 const base=validateCollectorConfig(configuration),owned=validateOwnedDatabaseProfile(profile),profileDigest=databaseProfileDigest(owned);
 if(![4,5].includes(base.version)||base.workspace!=='blackspire-command'||base.principal!=='blackspire-operator'
 ||base.observerDatabaseConfigPath!==LEGACY_DATABASE_MANAGEMENT
 ||(base.version===5?base.frontendOrigin!=='https://blackspirehelix.com':!/^https:\/\/[a-z0-9-]+\.vercel\.app$/.test(base.frontendOrigin)))fail();
 const accepted=validateOwnedAcceptanceTargetDocument(target,{releaseSha:base.releaseSha,profileDigest});
 if(accepted.workspace!==base.workspace)fail();
 return validateCollectorConfig({...base,version:base.version+2,backendProfile:'owned-postgres-v1',profileDigest,
 ownedObserverDatabaseConfigPath:OWNED_DATABASE_MANAGEMENT,acceptanceSearchJobId:accepted.jobId});
}
