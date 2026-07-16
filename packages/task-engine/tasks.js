import {id, now} from '../shared/util.js'; import {query,execSql,esc,migrate} from './db.js';
migrate();
export function audit(taskId,actor,action,details={}){execSql(`INSERT INTO audit_events VALUES (${esc(id('aud'))},${esc(taskId)},${esc(actor)},${esc(action)},${esc(JSON.stringify(details))},${esc(now())});`)}
export function createTask({workspaceId,request,idempotencyKey,budgetCents=500}){const existing=idempotencyKey&&query(`SELECT * FROM tasks WHERE idempotency_key=${esc(idempotencyKey)};`)[0]; if(existing) return existing; const task={id:id('task'),workspace_id:workspaceId,request,status:'queued',idempotency_key:idempotencyKey||id('idem'),provider:null,plan:null,summary:null,error:null,budget_cents:budgetCents,retry_count:0,created_at:now(),updated_at:now()}; execSql(`INSERT INTO tasks VALUES (${Object.values(task).map(esc).join(',')});`); audit(task.id,'system','task.created',{request}); return getTask(task.id);}
export function getTask(taskId){return query(`SELECT * FROM tasks WHERE id=${esc(taskId)};`)[0]||null}
export function listTasks(){return query(`SELECT * FROM tasks ORDER BY created_at DESC LIMIT 50;`)}
export function transition(taskId,status,patch={}){const sets=[`status=${esc(status)}`,`updated_at=${esc(now())}`,...Object.entries(patch).map(([k,v])=>`${k}=${esc(typeof v==='string'?v:JSON.stringify(v))}`)]; execSql(`UPDATE tasks SET ${sets.join(',')} WHERE id=${esc(taskId)};`); audit(taskId,'system','task.transition',{status,...patch}); return getTask(taskId)}
export function claimNext(){const row=query(`SELECT * FROM tasks WHERE status='queued' ORDER BY created_at LIMIT 1;`)[0]; if(!row)return null; return transition(row.id,'planning');}
export function logs(taskId){return query(`SELECT * FROM audit_events WHERE task_id=${esc(taskId)} ORDER BY created_at;`)}
export function setFlag(key,value){execSql(`INSERT OR REPLACE INTO system_flags VALUES (${esc(key)},${esc(value)},${esc(now())});`)}
export function getFlag(key){return query(`SELECT value FROM system_flags WHERE key=${esc(key)};`)[0]?.value}
