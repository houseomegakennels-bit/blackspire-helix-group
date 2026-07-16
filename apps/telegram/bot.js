import { TELEGRAM_ALLOWED_USERS, ADMIN_TOKEN, PUBLIC_BASE_URL } from '../../packages/shared/config.js';
import { escapeMarkdown, redact } from '../../packages/shared/util.js';

const sessions = new Map();
const seen = new Set();

export async function handleTelegramUpdate(update, apiBase = PUBLIC_BASE_URL) {
  if (seen.has(update.update_id)) return { ignored: true, reason: 'duplicate' };
  seen.add(update.update_id);
  const msg = update.message || update.callback_query?.message;
  const from = update.message?.from || update.callback_query?.from || {};
  if (!TELEGRAM_ALLOWED_USERS.includes(Number(from.id))) return { ignored: true };
  const text = update.message?.text || update.callback_query?.data || '';
  const chatId = msg?.chat?.id;
  const send = (message, extra = {}) => ({ chatId, text: chunk(escapeMarkdown(message)), ...extra });

  if (text.startsWith('/start') || text.startsWith('/help')) return send('Blackspire Command online. Use /task <request>, /tasks, /workspaces, /status, /stop.');
  if (text.startsWith('/status') || text.startsWith('/health')) return send(JSON.stringify(await get('/health', apiBase)));
  if (text.startsWith('/workspaces')) return send((await get('/api/workspaces', apiBase)).workspaces.map((w) => `${w.id}: ${w.name}`).join('\n'));
  if (text.startsWith('/use ')) {
    sessions.set(from.id, text.slice(5).trim());
    return send(`Workspace set to ${sessions.get(from.id)}`);
  }
  if (text.startsWith('/task ')) {
    const body = { request: text.slice(6), workspaceId: sessions.get(from.id) || 'blackspire-command' };
    const result = await post('/api/tasks', body, apiBase);
    return send(result.task ? `Queued ${result.task.id}: ${result.task.request}` : `Task rejected: ${result.error || 'unknown error'}`);
  }
  if (text.startsWith('/tasks')) return send((await get('/api/tasks', apiBase)).tasks.map((t) => `${t.id} ${t.status} ${t.request}`).join('\n') || 'No tasks');
  const one = text.match(/^\/(task_status|logs|approve|reject|pause|resume|cancel)\s+(\S+)/);
  if (one) {
    const route = one[1] === 'task_status' ? `/api/tasks/${one[2]}` : `/api/tasks/${one[2]}/${one[1] === 'logs' ? 'logs' : one[1]}`;
    const result = one[1] === 'task_status' || one[1] === 'logs' ? await get(route, apiBase) : await post(route, {}, apiBase);
    return send(JSON.stringify(result).slice(0, 3500));
  }
  if (text.startsWith('/stop')) return send(JSON.stringify(await post('/api/stop', {}, apiBase)));
  return send('Unknown command. Use /help.');
}

export async function sendTelegramMessage(token, chatId, text, extra = {}) {
  const chunks = chunk(text);
  const sent = [];
  for (const part of chunks) {
    const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text: part, parse_mode: 'MarkdownV2', ...extra }),
    });
    sent.push(await response.json());
  }
  return sent;
}

export async function runPolling({ token = process.env.TELEGRAM_BOT_TOKEN, apiBase = PUBLIC_BASE_URL, pollMs = 1500 } = {}) {
  if (!token) {
    console.log(JSON.stringify({ service: 'telegram', mode: 'dry-run', reason: 'TELEGRAM_BOT_TOKEN not configured' }));
    return { stop: () => undefined, mode: 'dry-run' };
  }
  let offset = 0;
  let stopped = false;
  async function poll() {
    if (stopped) return;
    try {
      const response = await fetch(`https://api.telegram.org/bot${token}/getUpdates?timeout=10&offset=${offset}`);
      const payload = await response.json();
      for (const update of payload.result || []) {
        offset = Math.max(offset, update.update_id + 1);
        const reply = await handleTelegramUpdate(update, apiBase);
        if (!reply.ignored && reply.chatId) {
          for (const text of reply.text) await sendTelegramMessage(token, reply.chatId, text, reply.extra || {});
        }
      }
    } catch (error) {
      console.error(JSON.stringify({ service: 'telegram', error: redact(error.message) }));
    } finally {
      if (!stopped) setTimeout(poll, pollMs).unref();
    }
  }
  poll();
  console.log(JSON.stringify({ service: 'telegram', mode: 'polling' }));
  return { stop: () => { stopped = true; }, mode: 'polling' };
}

function chunk(value) {
  const source = String(value || '');
  const output = [];
  for (let i = 0; i < source.length || i === 0; i += 3900) output.push(source.slice(i, i + 3900));
  return output;
}

async function get(path, base) {
  const response = await fetch(base + path, { headers: { authorization: `Bearer ${ADMIN_TOKEN}` } });
  return response.json();
}

async function post(path, body, base) {
  const response = await fetch(base + path, { method: 'POST', headers: { authorization: `Bearer ${ADMIN_TOKEN}`, 'content-type': 'application/json' }, body: JSON.stringify(body) });
  return response.json();
}

if (import.meta.url === `file://${process.argv[1]}`) runPolling();
