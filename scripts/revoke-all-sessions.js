#!/usr/bin/env node

// The API must be stopped before this offline primitive runs. That prevents the old process from
// issuing a new token-era session after the durable revocation fence is written.
import { execFileSync } from 'node:child_process';
import { revokeAllSessions } from '../packages/shared/sessions.js';

if (process.env.NODE_ENV === 'production' && process.env.BLACKSPIRE_STATE_OWNER !== 'vps-production') {
  throw new Error('offline session revocation requires the vps-production state owner');
}
if (process.env.NODE_ENV === 'production') {
  const systemctl = process.env.BLACKSPIRE_SYSTEMCTL || 'systemctl';
  const apiUnit = process.env.BLACKSPIRE_API_UNIT_NAME || 'blackspire-command.service';
  let state;
  try {
    state = execFileSync(systemctl, ['show', apiUnit, '-p', 'ActiveState', '--value'], {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
  } catch {
    throw new Error('offline session revocation requires a readable API systemd state');
  }
  if (state !== 'inactive') throw new Error('offline session revocation requires the API to be inactive');
}
revokeAllSessions();
process.stdout.write('all durable browser sessions revoked\n');
