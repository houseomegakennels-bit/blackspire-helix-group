// Dedicated negative-authorization fixture. Never grants authority, issues a
// credential/session, repairs a principal, or imports runtime database config.
export const DENIAL_PRINCIPAL='zola-denied-principal';
const fail=()=>{throw new Error('DENIAL_PRINCIPAL_PREPARATION_REJECTED');};
export function prepareDenialPrincipal(database,{issuedAt},{assertHost,now=Date.now()}={}){
 if(!Number.isSafeInteger(issuedAt)||issuedAt<1||issuedAt>now||typeof assertHost!=='function')fail();
 const expected={id:DENIAL_PRINCIPAL,type:'admin',actor_id:DENIAL_PRINCIPAL,authentication_method:'bearer',
  credential_reference:null,status:'active',issued_at:issuedAt,expires_at:null,revoked_at:null,disabled_at:null,security_version:1,created_at:issuedAt};
 let begun=false;
 try{
  assertHost();database.exec('BEGIN IMMEDIATE');begun=true;
  if(database.prepare("SELECT count(*) AS n FROM sqlite_master WHERE type='trigger' AND tbl_name='auth_principals'").get().n!==0)fail();
  const validate=()=>{
   if(database.prepare('SELECT count(*) AS n FROM auth_workspace_grants WHERE principal_id=?').get(DENIAL_PRINCIPAL).n!==0
    ||database.prepare('SELECT count(*) AS n FROM sessions WHERE principal_id=?').get(DENIAL_PRINCIPAL).n!==0)fail();
   const rows=database.prepare('SELECT * FROM auth_principals WHERE id=? OR actor_id=?').all(DENIAL_PRINCIPAL,DENIAL_PRINCIPAL);
   if(rows.length>1||rows.length===1&&(Object.keys(rows[0]).sort().join(',')!==Object.keys(expected).sort().join(',')
    ||Object.entries(expected).some(([key,value])=>rows[0][key]!==value)))fail();
   return rows.length===1;
  };
  const exists=validate();
  if(!exists)database.prepare('INSERT INTO auth_principals(id,type,actor_id,authentication_method,credential_reference,status,issued_at,expires_at,revoked_at,disabled_at,security_version,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)').run(...Object.values(expected));
  if(!validate())fail();assertHost();
  database.exec('COMMIT');begun=false;
  return{status:exists?'DENIAL_PRINCIPAL_VERIFIED':'DENIAL_PRINCIPAL_CREATED',principal:DENIAL_PRINCIPAL,grants:0,sessions:0,livePass:false};
 }catch{
  if(begun)try{database.exec('ROLLBACK');}catch{}
  fail();
 }
}
