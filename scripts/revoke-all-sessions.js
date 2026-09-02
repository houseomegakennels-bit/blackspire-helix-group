#!/usr/bin/env node

// The API must be stopped before this offline primitive runs. That prevents the old process from
// issuing a new token-era session after the durable revocation fence is written.
import { revokeAllSessions } from '../packages/shared/sessions.js';

if (process.env.NODE_ENV === 'production' && process.env.BLACKSPIRE_STATE_OWNER !== 'vps-production') {
  throw new Error('offline session revocation requires the vps-production state owner');
}
revokeAllSessions();
process.stdout.write('all durable browser sessions revoked\n');
