import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { stripTypeScriptTypes } from 'node:module';

// Execute the editor's actual handlers with controlled promises and render-independent refs.
const source = fs.readFileSync('frontend/src/components/property-research-workbench.tsx', 'utf8');
const handlers = source.slice(source.indexOf('  function setResearch('), source.indexOf('  let preview;'));
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function editor({ dirty = false, confirm = true } = {}) {
  const currentDraftRef = { current: { privateNotes: 'initial' } };
  const revisionRef = { current: 3 };
  const operationRef = { current: null };
  let draft = currentDraftRef.current, baseline = JSON.stringify(draft), revision = 3, message, reloading = false;
  let loads = 0, writes = 0, confirms = 0;
  const read = deferred(), write = deferred();
  const saveState = {
    pending: false, dirty,
    begin() { return JSON.stringify(currentDraftRef.current); },
    succeed(snapshot) { baseline = snapshot; },
    fail() {},
    load(value) { baseline = JSON.stringify(value); }
  };
  const transport = {
    load() { loads++; return read.promise; },
    save() { writes++; return write.promise; }
  };
  const context = {
    currentDraftRef, revisionRef, operationRef, saveState, transport, JSON, Error,
    window: { confirm() { confirms++; return confirm; } },
    setResearchState(value) { draft = value; },
    setRevision(value) { revision = value; },
    setMessage(value) { message = value; },
    setReloading(value) { reloading = value; },
    validatePropertyResearch(value) { return value; }
  };
  const actions = vm.runInNewContext(stripTypeScriptTypes(handlers) + '\n({setResearch, save, reload})', context);
  return { ...actions, read, write, operationRef, revisionRef,
    state: () => ({ draft, revision, baseline, message, reloading, loads, writes, confirms, dirty: JSON.stringify(draft) !== baseline }) };
}
const saved = { revision: 4, research: { privateNotes: 'saved on server' } };

test('reload preserves newer draft and revision when edited during the awaited read', async () => {
  const e = editor();
  const loading = e.reload();
  assert.equal(e.state().reloading, true);
  e.setResearch(current => ({ ...current, privateNotes: 'newer local text' }));
  e.read.resolve(saved);
  await loading;
  assert.equal(e.state().draft.privateNotes, 'newer local text');
  assert.equal(e.state().revision, 3);
  assert.equal(e.revisionRef.current, 3);
  assert.equal(e.state().dirty, true);
  assert.match(e.state().message, /newer draft is preserved/);
  assert.equal(e.operationRef.current, null);
  assert.equal(e.state().reloading, false);
});

test('reload synchronously blocks duplicate reload and save before a React rerender', async () => {
  const e = editor();
  const loading = e.reload();
  await e.reload();
  await e.save();
  assert.equal(e.state().loads, 1);
  assert.equal(e.state().writes, 0);
  e.read.resolve(saved);
  await loading;
  assert.equal(e.state().draft.privateNotes, 'saved on server');
  assert.equal(e.state().revision, 4);
  assert.equal(e.state().dirty, false);
});

test('save synchronously blocks reload and duplicate save and preserves edits in flight', async () => {
  const e = editor({ dirty: true });
  const saving = e.save();
  await e.reload();
  await e.save();
  assert.equal(e.state().loads, 0);
  assert.equal(e.state().writes, 1);
  e.setResearch(current => ({ ...current, privateNotes: 'edited while saving' }));
  e.write.resolve({ revision: 4, research: { privateNotes: 'initial' } });
  await saving;
  assert.equal(e.state().draft.privateNotes, 'edited while saving');
  assert.equal(e.state().revision, 4);
  assert.equal(e.state().dirty, true);
  assert.equal(e.operationRef.current, null);
});

test('failed reload preserves the draft and releases the operation lock', async () => {
  const e = editor();
  const loading = e.reload();
  e.read.reject(new Error('synthetic offline'));
  await loading;
  assert.equal(e.state().draft.privateNotes, 'initial');
  assert.equal(e.state().revision, 3);
  assert.match(e.state().message, /synthetic offline/);
  assert.equal(e.operationRef.current, null);
  assert.equal(e.state().reloading, false);
  await e.reload();
  assert.equal(e.state().loads, 2);
});

test('declined replacement of dirty research does not request or lock', async () => {
  const e = editor({ dirty: true, confirm: false });
  await e.reload();
  assert.equal(e.state().confirms, 1);
  assert.equal(e.state().loads, 0);
  assert.equal(e.operationRef.current, null);
});
