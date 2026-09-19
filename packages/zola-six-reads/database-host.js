import pg from 'pg';
import { createHash } from 'node:crypto';
import { readRootOwnedJson } from '../buyer-writer/protected-json.js';
import { refuse } from './collector.js';
import { divisionSnapshotSQL, ownerWitnessSQL, queryObservation, validateDivisionSnapshot, validateOwnerWitness } from './database-observer.js';

// No ambient PG* environment or caller-defined SQL. This explicit production
// path uses the same pinned direct database/TLS credential contract as migrations.
export function createProductionDatabaseObserver(config) {
  return async phase => {
    const credential = readRootOwnedJson(config.observerDatabaseConfigPath, { groupId: 0, maxBytes: 65536 });
    if (Object.keys(credential).sort().join(',') !== 'ca,host,password' || credential.host !== 'db.kchtrvfcixnimvxxctkj.supabase.co' ||
      typeof credential.password !== 'string' || credential.password.length < 16 || credential.password.length > 4096 ||
      typeof credential.ca !== 'string' || !credential.ca.startsWith('-----BEGIN CERTIFICATE-----') || createHash('sha256').update(credential.ca).digest('hex') !== '700723581420dd1ac98fd7e9ac529f0ef210eadcaf87fc868a3ad7d114c2f3b7') refuse('OBSERVER_CREDENTIAL_REJECTED');
    const client = new pg.Client({ host: credential.host, port: 5432, user: 'postgres', database: 'postgres', password: credential.password,
      ssl: { rejectUnauthorized: true, ca: credential.ca }, connectionTimeoutMillis: 5000, query_timeout: 20000,
      application_name: 'zola-six-read-observer', options: '-c default_transaction_read_only=on' });
    client.on('error',()=>{});
    try {
      await client.connect();
      const snapshotStarted = Date.now();
      const snapshot = validateDivisionSnapshot(await queryObservation(client, divisionSnapshotSQL(config,phase)), config,phase);
      if (Date.parse(snapshot.capturedAt) < snapshotStarted - 1000 || Date.parse(snapshot.capturedAt) > Date.now() + 1000) refuse('OBSERVER_DATABASE_CLOCK_MISMATCH');
      const ownerStarted = Date.now();
      const owner = validateOwnerWitness(await queryObservation(client, ownerWitnessSQL(config,phase)), config,phase);
      if (Date.parse(owner.capturedAt) < ownerStarted - 1000 || Date.parse(owner.capturedAt) > Date.now() + 1000) refuse('OBSERVER_DATABASE_CLOCK_MISMATCH');
      return { snapshot, owner };
    } catch { refuse('PRODUCTION_DATABASE_OBSERVATION_FAILED'); }
    finally { await client.end().catch(()=>{}); }
  };
}
