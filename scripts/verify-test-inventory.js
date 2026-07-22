import fs from 'node:fs';
import { expectedTestFiles, inventoryRecordFromLog, verifyTestInventory } from './test-inventory.js';

const logPath = process.argv[2];
if (!logPath) throw new Error('Usage: node scripts/verify-test-inventory.js <npm-test-output.log>');

const record = inventoryRecordFromLog(fs.readFileSync(logPath, 'utf8'));
verifyTestInventory(expectedTestFiles(), record.executed);
console.log(`Verified ${record.executed.length} executed test files against the current inventory.`);
