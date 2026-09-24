export const LEGACY_WRITER_ACCEPTANCE_TARGET='/var/lib/blackspire-operator/writer-acceptance.json';
export const OWNED_WRITER_ACCEPTANCE_TARGET='/var/lib/blackspire-operator/owned-writer-acceptance.json';
const fail=()=>{throw new Error('Writer acceptance backend rejected');};
export function acceptanceTargetSelection(connection){
 if(connection?.backendProfile==='owned-postgres-v1'){
  if(connection.host!=='127.0.0.1'||connection.port!==55432||connection.database!=='postgres'||!/^[a-f0-9]{64}$/.test(connection.profileDigest??''))fail();
  return Object.freeze({file:OWNED_WRITER_ACCEPTANCE_TARGET,kind:'zola_owned_bounded_writer_acceptance_target',backendProfile:'owned-postgres-v1',profileDigest:connection.profileDigest});
 }
 if(connection?.backendProfile!==undefined||connection?.profileDigest!==undefined||connection?.host!=='db.kchtrvfcixnimvxxctkj.supabase.co'||connection?.port!==5432||connection?.database!=='postgres')fail();
 return Object.freeze({file:LEGACY_WRITER_ACCEPTANCE_TARGET,kind:'zola_bounded_writer_acceptance_target'});
}
export function matchesAcceptanceTargetBackend(value,selection){
 return value?.kind===selection.kind&&(selection.backendProfile==='owned-postgres-v1'
  ?value.backendProfile===selection.backendProfile&&value.profileDigest===selection.profileDigest
  :value.backendProfile===undefined&&value.profileDigest===undefined);
}
export async function verifyAcceptanceTargetProfile(connection){
 const selection=acceptanceTargetSelection(connection);
 if(selection.backendProfile){const database=await import('./database-profile.js');database.validateDatabaseTarget(connection,{ownedProfile:database.readOwnedDatabaseProfile()});}
 return selection;
}
