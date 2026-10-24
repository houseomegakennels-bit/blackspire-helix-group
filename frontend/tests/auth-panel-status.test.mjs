import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import React from 'react';
import * as jsxRuntime from 'react/jsx-runtime';
import { renderToStaticMarkup } from 'react-dom/server';

const testDirectory = path.dirname(fileURLToPath(import.meta.url));

// Execute the actual component and its effect/refresh handlers with controlled
// hook state and transport, then render its returned React tree. No live Auth calls.
const source = fs.readFileSync(path.join(testDirectory, '../src/components/auth-panel.tsx'), 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 },
}).outputText;
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const healthy = { ok: true, authConfigured: true, bootstrapRequired: false, operator: null };
const response = (payload, ok = true) => ({ ok, json: async () => payload });
function mount() {
  const states = [], effects = [], requests = [];
  let index = 0, initial = true;
  const hooks = {
    useState(initialValue) {
      const cell = index++;
      if (!(cell in states)) states[cell] = initialValue;
      return [states[cell], value => { states[cell] = typeof value === 'function' ? value(states[cell]) : value; }];
    },
    useRef(initialValue) {
      const cell = index++;
      if (!(cell in states)) states[cell] = { current: initialValue };
      return states[cell];
    },
    useEffect(effect) { if (initial) effects.push(effect); },
  };
  const exports = {};
  vm.runInNewContext(compiled, {
    exports,
    fetch(url, options) { const request = deferred(); requests.push({ url, options, ...request }); return request.promise; },
    require(name) {
      if (name === 'react') return hooks;
      if (name === 'react/jsx-runtime') return jsxRuntime;
      if (name === 'next/navigation') return { useRouter: () => ({ push() {}, refresh() {} }) };
      if (name === '@/components/buyer-shell') return {
        BuyerShell: ({ children }) => React.createElement('main', null, children),
        Panel: ({ title, children }) => React.createElement('section', null, title, children),
        StatusPill: ({ label }) => React.createElement('span', null, label),
      };
      throw new Error(`Unexpected import ${name}`);
    },
  });
  function render() { index = 0; const tree = exports.AuthPanel(); initial = false; return tree; }
  let tree = render();
  effects.forEach(effect => effect());
  function walk(node, predicate) {
    if (!node || typeof node !== 'object') return null;
    if (predicate(node)) return node;
    for (const child of React.Children.toArray(node.props?.children)) { const found = walk(child, predicate); if (found) return found; }
    return null;
  }
  return {
    requests,
    html() { tree = render(); return renderToStaticMarkup(tree); },
    async settle(value, requestIndex = requests.length - 1) {
      requests[requestIndex].resolve(value);
      await new Promise(resolve => setImmediate(resolve));
    },
    async reject() {
      requests.at(-1).reject(new Error('fetch failed'));
      await new Promise(resolve => setImmediate(resolve));
    },
    refresh() {
      tree = render();
      const button = walk(tree, node => node.type === 'button' && node.props.children === 'Refresh auth status');
      assert.ok(button);
      button.props.onClick();
    },
  };
}
function assertUnknown(html) {
  assert.match(html, /auth configuration unknown/);
  assert.match(html, /session unknown/);
  assert.match(html, /bootstrap status unknown/);
  assert.doesNotMatch(html, /auth env missing|bootstrap complete|No operator session is active yet|Create operator and sign in|Create the first operator|Create beta account/);
}
test('initial loading makes no configuration/session/bootstrap claim', () => {
  const panel = mount();
  assertUnknown(panel.html());
  assert.match(panel.html(), /Checking authentication status/);
});
test('failed status transport remains unknown', async () => {
  const panel = mount(); await panel.reject();
  assertUnknown(panel.html());
  assert.match(panel.html(), /Unable to check authentication/);
});
test('server error response remains unknown even with misleading fields', async () => {
  const panel = mount(); await panel.settle(response({ ...healthy, ok: false, error: 'fetch failed' }, false));
  assertUnknown(panel.html());
});
test('missing required status fields remain unknown', async () => {
  const panel = mount(); await panel.settle(response({ ok: true, authConfigured: true }));
  assertUnknown(panel.html());
  assert.match(panel.html(), /could not be verified/);
});
test('malformed JSON remains unknown', async () => {
  const panel = mount(); await panel.settle({ ok: true, json: async () => { throw new SyntaxError('invalid JSON'); } });
  assertUnknown(panel.html());
});
test('confirmed healthy signed-out status renders known state', async () => {
  const panel = mount(); await panel.settle(response(healthy));
  assert.match(panel.html(), /auth env ready/);
  assert.match(panel.html(), /no active session/);
  assert.match(panel.html(), /bootstrap complete/);
  assert.doesNotMatch(panel.html(), /status unknown|configuration unknown/);
});
test('confirmed missing configuration and required bootstrap remain explicit', async () => {
  const panel = mount(); await panel.settle(response({ ...healthy, authConfigured: false, bootstrapRequired: true }));
  assert.match(panel.html(), /auth env missing/);
  assert.match(panel.html(), /bootstrap required/);
  assert.match(panel.html(), /Create operator and sign in/);
});
test('failed refresh invalidates prior signed-in/bootstrap state immediately', async () => {
  const panel = mount();
  await panel.settle(response({ ...healthy, operator: { id: 'synthetic-operator', email: 'test@example.invalid' } }));
  assert.match(panel.html(), /Signed-in operator/);
  panel.refresh(); assertUnknown(panel.html());
  await panel.reject(); assertUnknown(panel.html());
  assert.doesNotMatch(panel.html(), /test@example.invalid|Change password|Sign out/);
});
test('failed refresh never retains first-operator creation from earlier success', async () => {
  const panel = mount(); await panel.settle(response({ ...healthy, bootstrapRequired: true }));
  assert.match(panel.html(), /Create operator and sign in/);
  panel.refresh(); await panel.reject(); assertUnknown(panel.html());
});

test('older initial success cannot restore certainty after a newer failed refresh', async () => {
  const panel = mount();
  // A sign-in completion can start a refresh while the initial request is pending.
  panel.refresh();
  await panel.reject();
  assertUnknown(panel.html());
  await panel.settle(response({ ...healthy, bootstrapRequired: true }), 0);
  assertUnknown(panel.html());
});
test('older completion cannot clear loading or overwrite a newer successful status', async () => {
  const panel = mount();
  panel.refresh();
  await panel.settle(response({ ...healthy, bootstrapRequired: true }), 0);
  assertUnknown(panel.html());
  assert.match(panel.html(), /Checking authentication status/);
  await panel.settle(response(healthy), 1);
  assert.match(panel.html(), /bootstrap complete/);
  assert.doesNotMatch(panel.html(), /Create operator and sign in/);
});
