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
    // Renamed: this mutant REMOVES the bound. It proves the bound exists, not that it is ordered
    // before the ancestry walk. The ordering claim is carried by the reordering mutant below.
    name: 'write path: remove the write-side depth bound entirely',
    file: REVIEW,
    find: '    if (!Number.isSafeInteger(headChainVersion) || headChainVersion < 0 ||\n      headChainVersion + 1 > MAX_REREVIEW_CHAIN_DEPTH) throw new Error',
    replace: '    if (false) throw new Error',
  },
  {
    // The actual ordering mutant: the bound still runs, but only AFTER `rereviewPredecessor` has
    // walked the whole ancestry to the root. This is the pre-fix behaviour.
    name: 'write path: reorder the depth bound to run after the ancestry walk',
    file: REVIEW,
    find: `    const headChainVersion = head ? Number(head.chain_version) : 0;
    if (!Number.isSafeInteger(headChainVersion) || headChainVersion < 0 ||
      headChainVersion + 1 > MAX_REREVIEW_CHAIN_DEPTH) throw new Error('memory candidate re-review refuses a chain beyond the maximum depth');
    const predecessor = head ? rereviewPredecessor(head, workspaceId, root) : rootPredecessor(root);`,
    replace: `    const headChainVersion = head ? Number(head.chain_version) : 0;
    const predecessor = head ? rereviewPredecessor(head, workspaceId, root) : rootPredecessor(root);
    if (!Number.isSafeInteger(headChainVersion) || headChainVersion < 0 ||
      headChainVersion + 1 > MAX_REREVIEW_CHAIN_DEPTH) throw new Error('memory candidate re-review refuses a chain beyond the maximum depth');`,
  },
  {
    name: 'read path: stop comparing the predecessor content digest pin',
    file: REVIEW,
    find: `  if (predecessor.content_digest !== rereview.predecessor_content_digest ||
    predecessor.lineage_digest !== rereview.predecessor_lineage_digest) return false;`,
    replace: '',
  },
  {
    name: 'read path: compare only the content half of the predecessor pin',
    file: REVIEW,
    find: '    predecessor.lineage_digest !== rereview.predecessor_lineage_digest) return false;',
    replace: '    false) return false;',
  },
  {
    // The predecessor/child DEPTH relationship, distinct from both halves of the digest pin above.
    // A forged row can name a real, intact ancestor and pin that ancestor's genuine digests while
    // sitting at the wrong depth relative to it. Every row is present, no UNIQUE index is violated,
    // and no immutability trigger fires, so this conjunct is the only thing that refuses it.
    name: 'read path: stop requiring the predecessor to sit exactly one chain version below the child',
    file: REVIEW,
    find: '  if (chainVersion > 1 && (Number(predecessor.chain_version) !== chainVersion - 1 ||',
    replace: '  if (chainVersion > 1 && (false ||',
  },
  {
    // The row's OWN digest comparison - the guard covering `decision`, `rationale`,
    // `candidate_digest`, `candidate_status_at_review` and the evaluation fields. Nothing else in
    // `storedRereviewIntact` reads any of them. Until the fifth pass this was absent from the list
    // and unpinned by the suite, because every forgery helper in the test file RESEALS, so the
    // simplest attack of all - change a column and leave the digests alone - was never performed.
    name: 'read path: drop the stored row content/lineage digest comparison entirely',
    file: REVIEW,
    find: '  return packets.contentDigest === rereview.content_digest && packets.lineageDigest === rereview.lineage_digest;',
    replace: '  return true;',
  },
  {
    // Each half separately, mirroring the treatment of the predecessor pin. A single tampered field
    // moves BOTH digests at once and so cannot distinguish these; the two isolating tests corrupt
    // one digest column each, leaving the other matching exactly.
    name: 'read path: compare only the content half of the stored row digests',
    file: REVIEW,
    find: '  return packets.contentDigest === rereview.content_digest && packets.lineageDigest === rereview.lineage_digest;',
    replace: '  return packets.contentDigest === rereview.content_digest;',
  },
  {
    name: 'read path: compare only the lineage half of the stored row digests',
    file: REVIEW,
    find: '  return packets.contentDigest === rereview.content_digest && packets.lineageDigest === rereview.lineage_digest;',
    replace: '  return packets.lineageDigest === rereview.lineage_digest;',
  },
  {
    // `created_at` is hashed into NEITHER packet, so no digest stands behind it and this format
    // check is the only guard on that column. It grants `created_at` no ordering authority -
    // `chain_version` remains the sole ordering authority; this is purely canonicality.
    name: 'read path: stop requiring created_at to be a canonical timestamp',
    file: REVIEW,
    find: '  if (!canonicalTimestamp(rereview.created_at)) return false;',
    replace: '',
  },
  {
    // Replay classification: without this, one key replayed against a DIFFERENT predecessor returns
    // the stored row as a successful replay instead of an identity conflict.
    name: 'replay path: stop comparing the replayed predecessor against the supplied supersedes',
    file: REVIEW,
    find: '        replayed.rationale !== redactString(rationale) || predecessorIdOf(replayed) !== supersedes) {',
    replace: '        replayed.rationale !== redactString(rationale)) {',
  },
  {
    name: 'write path: drop the head rule (allow a stale or conflicting predecessor)',
    file: REVIEW,
    find: "    if (predecessor.id !== supersedes) throw new Error('memory candidate re-review refuses a stale or conflicting predecessor');",
    replace: '',
  },
  {
    name: 'read path: verify ancestry only one hop instead of to the root',
    file: REVIEW,
    find: '  if (chainVersion > 1 && !storedRereviewIntact(predecessor, root)) return false;',
    replace: '',
  },
  {
    name: 'replay path: stop classifying a cross-root idempotency key collision',
    file: REVIEW,
    find: "      if (replayed.root_review_id !== rootReviewId) throw new Error('memory candidate re-review identity conflicts with stored decision');",
    replace: '',
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

// DECLARED EQUIVALENT MUTANTS.
//
// These are guards whose deletion does NOT change observable behaviour, because a second check
// already rejects exactly the same states. They are listed here, run, and reported separately -
// never folded into the killed count and never quietly omitted. The harness asserts each one
// SURVIVES: if a "declared equivalent" mutant is killed, the declaration was wrong and that is a
// hard error, because it would mean the guard was load-bearing after all.
//
// Each entry must name the tests that prove the same bad states are independently rejected.
const EQUIVALENT_MUTANTS = [
  {
    name: 'read path: drop the denylist behind the positive allowlist',
    file: REVIEW,
    find: '  if (!deniedInheritanceAbsent(identity.inherited)) return false;',
    replace: '',
    why: 'inheritedContextIntact runs first and pins every key name and leaf: the top-level key set, '
      + 'the `keys` array, the `values` key set and the provenance key set are all fixed frozen lists, '
      + 'and every leaf must strict-equal a scalar column. No blob reaching the denylist can carry a '
      + 'denied key at any depth.',
    provenBy: ['a forged inherited context with smuggled keys and a contradicting candidate identity',
      'a forged inherited context is rejected even when every smuggled key name is undenied',
      'a forged inherited context with an extra or missing top-level key is unreadable'],
  },
  {
    name: 'write path: drop the whole-chain validity check',
    file: REVIEW,
    find: `    if (head && !rereviewChainValid(root, getMemoryCandidateRereviewChain(rootReviewId))) {
      throw new Error('memory candidate re-review refuses an invalid predecessor chain');
    }`,
    replace: '',
    why: 'every remaining conjunct is re-derived by storedRereviewIntact recursing from the head to '
      + 'the root, which rereviewPredecessor already invokes. UNIQUE(root_review_id,chain_version) '
      + 'makes the row set for a root exactly the head ancestry, so a gap or fork cannot hide off the '
      + 'walked path. The created_at monotonicity conjunct - the one thing genuinely unique to this '
      + 'function - was removed rather than kept, because the read path cannot verify it.',
    provenBy: ['a gap in the chain makes the descendant unreadable and refuses further appends',
      'a fork off the same predecessor is refused by the service and independently by the database',
      'a cycle is unreadable even when written directly around the service'],
  },
];

// The harness rewrites its target files IN THE WORKING TREE. `runSuite` blocks the main thread in
// synchronous `execFileSync`, so the signal handlers registered below cannot fire while a mutant is
// applied: an interrupted run leaves the tree mutated. Caching that mutated file as the "original"
// on a later run would silently invalidate every verdict, and has in practice produced both a
// spurious "pattern occurs 0 times" hard error and scattered irreproducible failures when a harness
// raced a concurrent test run.
//
// So: refuse to start unless every target is clean per git, and hold an exclusive lock. This is a
// precondition on the evidence, not a convenience - a verdict from a dirty or raced tree is worth
// nothing.
function assertCleanTargets(files) {
  for (const file of files) {
    try {
      execFileSync('git', ['diff', '--quiet', '--', file], { cwd: repoRoot, stdio: 'pipe' });
    } catch {
      console.error(`FAIL: ${file} has uncommitted changes.`);
      console.error('The harness rewrites this file in place, so it must start from a clean copy.');
      console.error(`If a previous run was interrupted, restore it with:  git checkout -- ${file}`);
      process.exit(1);
    }
  }
}

const LOCK = path.join(repoRoot, '.mutation-test-m3c.lock');
function acquireLock() {
  try {
    fs.writeFileSync(LOCK, `pid ${process.pid}\n`, { flag: 'wx' });
  } catch {
    console.error(`FAIL: ${LOCK} exists - another harness run is in progress, or a previous one was killed.`);
    console.error('Two harnesses sharing one working tree corrupt each other. Remove the file only if no run is active.');
    process.exit(1);
  }
  const release = () => { try { fs.unlinkSync(LOCK); } catch { /* already gone */ } };
  process.on('exit', release);
  return release;
}

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

// Preconditions on the evidence, before anything is mutated.
assertCleanTargets([...new Set([...MUTANTS, ...EQUIVALENT_MUTANTS].map((m) => m.file))]);
acquireLock();

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

console.log('\ndeclared equivalent mutants (expected to survive; reported separately, never counted as killed):');
let misdeclared = 0;
for (const mutant of EQUIVALENT_MUTANTS) {
  const source = readOriginal(mutant.file);
  const occurrences = source.split(mutant.find).length - 1;
  if (occurrences !== 1) {
    console.error(`HARNESS ERROR: pattern for "${mutant.name}" occurs ${occurrences} times in ${mutant.file}, expected exactly 1`);
    process.exit(1);
  }
  fs.writeFileSync(path.join(repoRoot, mutant.file), source.replace(mutant.find, mutant.replace));
  const passed = runSuite();
  fs.writeFileSync(path.join(repoRoot, mutant.file), source);
  if (passed) {
    console.log(`EQUIVALENT  ${mutant.name}`);
    console.log(`            why: ${mutant.why}`);
    console.log(`            same states independently rejected by: ${mutant.provenBy.join('; ')}`);
  } else {
    misdeclared += 1;
    console.error(`MISDECLARED ${mutant.name} - killed, so it is NOT equivalent and must be counted as a real mutant`);
  }
}

console.log(`\nsummary: ${MUTANTS.length - survivors} killed, ${EQUIVALENT_MUTANTS.length - misdeclared} declared equivalent, ${survivors} surviving, ${misdeclared} misdeclared`);
process.exit(survivors === 0 && misdeclared === 0 ? 0 : 1);
