// Shared session subsystem adapter. The production CLI supplies the authenticated
// root host boundary; this core accepts no passwords, principal creation or grants.
import { createHash, randomBytes } from 'node:crypto';
const hash=v=>createHash('sha256').update(v).digest('hex');
const fail=()=>{throw new Error('DELEGATED_DENIAL_SESSION_REJECTED');};
const identifier=v=>typeof v==='string'&&/^[A-Za-z0-9._:-]{1,128}$/.test(v);
export async function openDelegatedSessionService(expectedDatabasePath) {
 const db=await import('../task-engine/db.js');
 const {DB_PATH}=await import('../shared/config.js');
 if(DB_PATH!==expectedDatabasePath)fail();
 const sessions=await import('../shared/sessions.js');
 const {resolveAdminBearer}=await import('../shared/authorization.js');
 const check=input=>{
  if(!input||Object.keys(input).sort().join(',')!=='deniedPrincipal,operatorPrincipal,releaseSha,runId,workspace'||!['operatorPrincipal','deniedPrincipal','workspace','runId'].every(k=>identifier(input[k]))||!(/^[a-f0-9]{40}$/).test(input.releaseSha??'')||input.operatorPrincipal===input.deniedPrincipal)fail();
  const operator=resolveAdminBearer(input.operatorPrincipal),denied=resolveAdminBearer(input.deniedPrincipal);
  if(!operator||!denied||operator.principalType!=='admin'||denied.principalType!=='admin')fail();
  // Reject every active row, even malformed or expired-active records, across
  // every workspace. No grant rows are created, repaired or revoked here.
  if(db.get("SELECT count(*) AS n FROM auth_workspace_grants WHERE principal_id=? AND status='active'",[input.deniedPrincipal]).n!==0)fail();
  return denied;
 };
 const audit=(input,action,details)=>db.run('INSERT INTO audit_events(id,task_id,actor,action,details,created_at) VALUES(?,NULL,?,?,?,?)',[
  `aud-${randomBytes(16).toString('hex')}`,input.operatorPrincipal,action,JSON.stringify({runId:input.runId,releaseSha:input.releaseSha,deniedPrincipal:input.deniedPrincipal,workspace:input.workspace,...details}),new Date().toISOString()]);
 return {
  issue(input,publish){
   return db.transaction(()=>{
    check(input);
    if(db.get("SELECT count(*) AS n FROM audit_events WHERE action='auth.delegated-denial.issued' AND json_extract(details,'$.runId')=?",[input.runId]).n!==0)fail();
    const marker=`zola-denial:${input.runId}:${randomBytes(16).toString('hex')}`;
    const session=sessions.createSession({principalId:input.deniedPrincipal,userAgent:marker,ip:'root-local-delegation',maxExpiresAt:Date.now()+15*60*1000});
    if(!session||!sessions.getSession(session.sessionId)||session.principalId!==input.deniedPrincipal||session.expiresAt-session.createdAt>15*60*1000||session.expiresAt<=session.createdAt)fail();
    const receipt={version:1,authentication:'root-delegated-existing-principal',...input,sessionId:session.sessionId,deniedCookie:`bc_session=${session.sessionId}`,createdAt:session.createdAt,expiresAt:session.expiresAt,marker};
    audit(input,'auth.delegated-denial.issued',{sessionDigest:hash(session.sessionId),expiresAt:session.expiresAt});
    // The exclusive protected file is durable before COMMIT. A publication or
    // commit failure retains the file and never authorizes automatic reissue.
    publish(receipt);
    return {status:'DELEGATED_DENIAL_ISSUED',expiresAt:session.expiresAt,authentication:receipt.authentication,livePass:false};
   });
  },
  revoke(receipt){
   return db.transaction(()=>{
    if(!receipt||receipt.version!==1||receipt.authentication!=='root-delegated-existing-principal'||!(/^[a-f0-9]{48}$/).test(receipt.sessionId??'')||receipt.deniedCookie!==`bc_session=${receipt.sessionId}`)fail();
    const original=db.get('SELECT * FROM sessions WHERE id=?',[receipt.sessionId]);
    if(!original||original.principal_id!==receipt.deniedPrincipal||original.user_agent!==receipt.marker||original.ip!=='root-local-delegation'||original.created_at!==receipt.createdAt||original.expires_at!==receipt.expiresAt)fail();
    const issued=db.all("SELECT details FROM audit_events WHERE action='auth.delegated-denial.issued' AND actor=? AND json_extract(details,'$.runId')=?",[receipt.operatorPrincipal,receipt.runId]);
    if(issued.length!==1)fail();const details=JSON.parse(issued[0].details);
    if(details.sessionDigest!==hash(receipt.sessionId)||details.deniedPrincipal!==receipt.deniedPrincipal||details.releaseSha!==receipt.releaseSha||details.workspace!==receipt.workspace||details.expiresAt!==receipt.expiresAt)fail();
    // Shared rotateSession preserves marker, principal and original expiry.
    // Revoke the original and every bounded rotation without extending lifetime.
    const family=db.all('SELECT * FROM sessions WHERE user_agent=?',[receipt.marker]);
    if(family.some(s=>s.principal_id!==original.principal_id||s.ip!==original.ip||s.created_at<original.created_at||s.expires_at>original.expires_at))fail();
    for(const s of family)sessions.destroySession(s.id);
    audit(receipt,'auth.delegated-denial.revoked',{sessionDigest:hash(receipt.sessionId),revokedCount:family.length});
    return {status:'DELEGATED_DENIAL_REVOKED',revokedCount:family.length,livePass:false};
   });
  },
  close:()=>db.closeDb(),
 };
}
