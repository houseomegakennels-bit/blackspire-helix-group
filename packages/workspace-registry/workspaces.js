import { execSql, query, esc, migrate } from '../task-engine/db.js';
import { now } from '../shared/util.js';

migrate();

export function seedWorkspace() {
  execSql(`INSERT OR REPLACE INTO workspaces VALUES ('blackspire-command','Blackspire Command','Safe local foundation workspace','local/blackspire-command','work','[".","docs","packages","apps","tests"]','["npm run build","npm test","npm run lint"]','{"preferred":["codex","openai","anthropic","manual"],"fallback":"manual"}','low',500,'["OPENAI_API_KEY","ANTHROPIC_API_KEY","GITHUB_TOKEN","TELEGRAM_BOT_TOKEN"]','["read","write_branch","test","draft_pr"]','unknown','.',${esc(now())});`);
}

export function listWorkspaces() {
  seedWorkspace();
  return query('SELECT * FROM workspaces ORDER BY name;').map(parse);
}

export function getWorkspace(id = 'blackspire-command') {
  seedWorkspace();
  const workspace = query(`SELECT * FROM workspaces WHERE id=${esc(id)};`)[0];
  return workspace && parse(workspace);
}

function parse(workspace) {
  for (const key of ['allowed_paths', 'build_commands', 'secret_references', 'enabled_tools']) workspace[key] = JSON.parse(workspace[key] || '[]');
  workspace.provider_policy = JSON.parse(workspace.provider_policy || '{}');
  return workspace;
}
