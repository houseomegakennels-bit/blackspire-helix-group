import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const serverPath = path.join(repositoryRoot, 'apps/api/server.js');

const INVENTORY = Object.freeze([
  { surface: 'workspace-list', permission: 'runtime.read', marker: "if (u.pathname === '/api/workspaces') return json(res, 200, { workspaces:" },
  { surface: 'task-list', permission: 'task.read', marker: "if (u.pathname === '/api/tasks' && req.method === 'GET') return json(res, 200, { tasks:" },
  { surface: 'task-create', permission: 'task.create', marker: "if (u.pathname === '/api/tasks' && req.method === 'POST') return createTaskRoute(req, res);" },
  { surface: 'unified-input-create', permission: 'task.create', marker: "if (u.pathname === '/api/unified-input' && req.method === 'POST') return unifiedInputRoute(req, res, auth);" },
  { surface: 'conversation-read', permission: 'task.read', marker: 'const conversation = getConversation(conversationMatch[1]);' },
  { surface: 'task-read-and-mutate', permission: 'task.read/task.execute/approval.grant', marker: 'if (match) return taskRoute(req, res, match);' },
  { surface: 'task-evidence-export', permission: 'task.read', marker: 'if (exportMatch) return exportTask(res, exportMatch[1], exportMatch[2]);' },
]);

export function auditLegacyAdminAuthorization(source = fs.readFileSync(serverPath, 'utf8')) {
  const surfaces = INVENTORY.map((entry) => ({
    ...entry,
    inventoryMarkerPresent: source.includes(entry.marker),
    workspaceAuthorization: 'missing',
  }));
  const inventoryComplete = surfaces.every((surface) => surface.inventoryMarkerPresent);
  return {
    auditVersion: 'legacy-admin-authz-v1',
    inventoryComplete,
    readyForControlledStaging: false,
    readyForSafeProduction: false,
    automaticFixApplied: false,
    finding: 'Authenticated legacy admin routes do not enforce canonical per-workspace grants.',
    boundary: 'This audit changes no runtime route, schema, credential, provider, Telegram, deployment, or production state.',
    surfaces,
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const report = auditLegacyAdminAuthorization();
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (!report.inventoryComplete) process.exitCode = 1;
}
