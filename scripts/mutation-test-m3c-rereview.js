#!/usr/bin/env node
// Mutation / fault-injection harness for the Milestone 3C re-review successor chain.
//
// Run:  node scripts/mutation-test-m3c-rereview.js
//
// Each mutant below disables exactly one guard, then runs the focused suite. A mutant is KILLED when
// the suite fails and SURVIVES when it still passes. A surviving mutant means the suite asserts that
// guard only indirectly - the guard could be deleted and nothing would notice.
//
// Two rules make the result trustworthy rather than decorative:
//
//   1. Every `find` string must occur EXACTLY ONCE in its target file. `String.replace` silently
//      mutates the first match, and several of these patterns have near-identical neighbours in the
//      review path versus the re-review path - so a pattern matching zero or many places is a harness
//      defect that would score an unapplied mutant as surviving. That is treated as a hard error.
//   2. The unmutated tree is run first as a baseline. If the suite does not pass clean, every later
//      "killed" verdict would be meaningless.
//
// The working tree is restored from the in-memory original after every mutant, including on crash.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TEST_FILE = 'tests/hermes-m3c-rereview-successor.test.js';
const REVIEW = 'packages/hermes-orchestrator/memory-review.js';

const MUTANTS = [
  {
    name: 'read path: drop positive inherited-context validation entirely',
    file: REVIEW,
    find: 'if (!inheritedContextIntact(identity.inherited, rereview, chainVersion)) return false;',
    replace: '',
  },
  {
    name: 'read path: allow non-allowlisted keys in the carried values',
    file: REVIEW,
    find: '  if (!sameKeys(Object.keys(values).sort(), [...INHERITED_CONTEXT_KEYS].sort())) return false;',
    replace: '',
  },
  {
    name: 'read path: stop requiring carried values to equal the row identity columns',
    file: REVIEW,
    find: '    if (values[key] !== (rereview[INHERITED_CONTEXT_COLUMNS[key]] ?? null)) return false;',
    replace: '',
  },
  {
    name: 'read path: stop verifying inherited provenance against the row predecessor pin',
    file: REVIEW,
    find: '  return provenance.predecessorId === predecessorIdOf(rereview) &&',
    replace: '  return true || provenance.predecessorId === predecessorIdOf(rereview) &&',
  },
  {
    name: 'read path: accept a forged top-level inherited-context shape',
    file: REVIEW,
    find: '  if (!sameKeys(Object.keys(inherited).sort(), [...INHERITED_TOP_LEVEL_KEYS].sort())) return false;',
    replace: '',
  },
  {
    name: 'replay path: return the stored row without the full intactness check',
    file: REVIEW,
    find: "      if (!storedRereviewIntact(replayed, root)) throw new Error('memory candidate re-review refuses a non-intact stored decision');",
    replace: '',
  },
  {
    name: 'write path: defer the depth bound until after the ancestry walk',
    file: REVIEW,
    find: '    if (!Number.isSafeInteger(headChainVersion) || headChainVersion < 0 ||\n      headChainVersion + 1 > MAX_REREVIEW_CHAIN_DEPTH) throw new Error',
    replace: '    if (false) throw new Error',
  },
  {
    name: 'module load: stop refusing an allowlist that overlaps the denied set',
    file: REVIEW,
    find: '  if (allowlist.some((key) => denied.includes(key))) return false;',
    replace: '',
  },
  {
    name: 'module load: stop requiring the allowlist to match the column map',
    file: REVIEW,
    find: '  return sameKeys([...allowlist], Object.keys(columns));',
    replace: '  return true;',
  },
  {
    name: 'read path: widen the chain-version depth bound',
    file: REVIEW,
    find: 'if (!Number.isSafeInteger(chainVersion) || chainVersion < 1 || chainVersion > MAX_REREVIEW_CHAIN_DEPTH) return false;',
    replace: 'if (!Number.isSafeInteger(chainVersion) || chainVersion < 1) return false;',
  },
];

function runSuite() {
  try {
    execFileSync(process.execPath, ['--test', '--test-concurrency=1', TEST_FILE],
      { cwd: repoRoot, stdio: 'pipe', env: { ...process.env } });
    return true;
  } catch {
    return false;
  }
}

const originals = new Map();
const readOriginal = (file) => {
  if (!originals.has(file)) originals.set(file, fs.readFileSync(path.join(repoRoot, file), 'utf8'));
  return originals.get(file);
};
const restoreAll = () => { for (const [file, source] of originals) fs.writeFileSync(path.join(repoRoot, file), source); };
process.on('exit', restoreAll);
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { restoreAll(); process.exit(1); });

console.log(`baseline: running ${TEST_FILE} unmutated`);
if (!runSuite()) {
  console.error('FAIL: the unmutated suite does not pass, so no mutation verdict would be meaningful');
  process.exit(1);
}
console.log('baseline: PASS\n');

let survivors = 0;
for (const mutant of MUTANTS) {
  const source = readOriginal(mutant.file);
  const occurrences = source.split(mutant.find).length - 1;
  if (occurrences !== 1) {
    console.error(`HARNESS ERROR: pattern for "${mutant.name}" occurs ${occurrences} times in ${mutant.file}, expected exactly 1`);
    process.exit(1);
  }
  fs.writeFileSync(path.join(repoRoot, mutant.file), source.replace(mutant.find, mutant.replace));
  const passed = runSuite();
  fs.writeFileSync(path.join(repoRoot, mutant.file), source);
  if (passed) { survivors += 1; console.log(`SURVIVED  ${mutant.name}`); }
  else console.log(`killed    ${mutant.name}`);
}

console.log(`\n${MUTANTS.length - survivors}/${MUTANTS.length} mutants killed, ${survivors} survived`);
process.exit(survivors === 0 ? 0 : 1);
