// Operator CLI loader: pinned TypeScript compiler, application aliases, real server condition.
// No dotenv loading and no replacement of service implementations.
import { registerHooks } from 'node:module';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ts from 'typescript';
const root = new URL('../../', import.meta.url);
registerHooks({
  resolve(specifier, context, next) {
    if (specifier === 'server-only') return { url: new URL('node_modules/next/dist/compiled/server-only/empty.js', root).href, shortCircuit: true };
    let url;
    if (specifier.startsWith('@/')) url = new URL(`src/${specifier.slice(2)}`, root);
    else if (specifier.startsWith('.') && context.parentURL?.startsWith('file:')) url = new URL(specifier, context.parentURL);
    if (url && !existsSync(fileURLToPath(url))) {
      for (const ext of ['.ts', '.tsx', '.mts']) if (existsSync(fileURLToPath(url) + ext)) return { url: pathToFileURL(fileURLToPath(url) + ext).href, shortCircuit: true };
    }
    if (url && specifier.startsWith('@/')) return { url: url.href, shortCircuit: true };
    return next(specifier, context);
  },
  load(url, context, next) {
    if (/\.(ts|tsx|mts)$/.test(url)) return { format: 'module', source: ts.transpileModule(readFileSync(new URL(url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText, shortCircuit: true };
    return next(url, context);
  },
});
