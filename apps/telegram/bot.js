import {TELEGRAM_ALLOWED_USERS,ADMIN_TOKEN,PUBLIC_BASE_URL} from '../../packages/shared/config.js'; import {escapeMarkdown} from '../../packages/shared/util.js';
const sessions=new Map(); const seen=new Set();
export async function handleTelegramUpdate(update, apiBase=PUBLIC_BASE_URL){ if(seen.has(update.update_id)) return {ignored:true,reason:'duplicate'}; seen.add(update.update_id); const msg=update.message||update.callback_query?.message; const from=update.message?.from||update.callback_query?.from||{}; if(!TELEGRAM_ALLOWED_USERS.includes(Number(from.id))) return {ignored:true}; const text=update.message?.text||update.callback_query?.data||''; const chatId=msg?.chat?.id; const send=(text,extra={})=>({chatId,text:chunk(escapeMarkdown(text)),...extra});
 if(text.startsWith('/start')||text.startsWith('/help')) return send('Blackspire Command online. Use /task <request>, /tasks, /workspaces, /status, /stop.');
 if(text.startsWith('/status')||text.startsWith('/health')) return send(JSON.stringify(await get('/health',apiBase)));
 if(text.startsWith('/workspaces')) return send((await get('/api/workspaces',apiBase)).workspaces.map(w=>`${w.id}: ${w.name}`).join('\n'));
 if(text.startsWith('/use ')){sessions.set(from.id,text.slice(5).trim()); return send(`Workspace set to ${sessions.get(from.id)}`)}
 if(text.startsWith('/task ')){const body={request:text.slice(6),workspaceId:sessions.get(from.id)||'blackspire-command'}; const r=await post('/api/tasks',body,apiBase); return send(`Queued ${r.task.id}: ${r.task.request}`)}
 if(text.startsWith('/tasks')) return send((await get('/api/tasks',apiBase)).tasks.map(t=>`${t.id} ${t.status} ${t.request}`).join('\n')||'No tasks');
 const one=text.match(/^\/(task_status|logs|approve|reject|pause|resume|cancel)\s+(\S+)/); if(one){const path=one[1]==='task_status'?`/api/tasks/${one[2]}`:`/api/tasks/${one[2]}/${one[1]==='logs'?'logs':one[1]}`; const r=one[1]==='task_status'||one[1]==='logs'?await get(path,apiBase):await post(path,{},apiBase); return send(JSON.stringify(r).slice(0,3500));}
 if(text.startsWith('/stop')) return send(JSON.stringify(await post('/api/stop',{},apiBase)));
 return send('Unknown command. Use /help.');}
function chunk(s){const out=[]; for(let i=0;i<s.length;i+=3900) out.push(s.slice(i,i+3900)); return out;}
async function get(p,b){const r=await fetch(b+p,{headers:{authorization:`Bearer ${ADMIN_TOKEN}`}}); return r.json()} async function post(p,body,b){const r=await fetch(b+p,{method:'POST',headers:{authorization:`Bearer ${ADMIN_TOKEN}`,'content-type':'application/json'},body:JSON.stringify(body)}); return r.json()}
if(import.meta.url===`file://${process.argv[1]}`) console.log('Telegram bridge exports handleTelegramUpdate; configure webhook or polling runner with TELEGRAM_BOT_TOKEN.');
