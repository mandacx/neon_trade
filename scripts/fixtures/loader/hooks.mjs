// Node loader hooks for the offline tests of the Trade Ideas unsubscribe route, page and sendEmail. Test-only.
// Lets scripts import the app's modules without Next.js:
//   - `@/...` aliases resolve to the repo (tsconfig paths), extensionless relative imports get .ts / .tsx;
//   - `server-only` resolves to an empty module (it throws outside React Server Components);
//   - the database client and the admin settings store resolve to in-memory stubs (no network, no database);
//   - .tsx files are transpiled with the project's TypeScript (Node's type stripping has no JSX).
// Nothing here talks to a network or a database.
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const STUBS = {
  'server-only': 'stubs/empty.mjs',
  '@/lib/db': 'stubs/db.mjs',
  '@/lib/ideas': 'stubs/ideas.mjs',
  '@/lib/appSettings': 'stubs/appSettings.mjs',
};

const ROOT = new URL('../../../', import.meta.url);

export async function resolve(specifier, context, next) {
  if (Object.hasOwn(STUBS, specifier)) {
    return { url: new URL(STUBS[specifier], import.meta.url).href, shortCircuit: true, format: 'module' };
  }
  if (specifier.startsWith('@/')) {
    const base = fileURLToPath(new URL(specifier.slice(2), ROOT));
    for (const ext of ['.ts', '.tsx', '/index.ts', '.js']) {
      if (existsSync(base + ext)) return next(new URL(specifier.slice(2) + ext, ROOT).href, context);
    }
    return next(specifier, context);
  }
  try {
    return await next(specifier, context);
  } catch (err) {
    if (err?.code !== 'ERR_MODULE_NOT_FOUND') throw err;
    // Extensionless relative import (components/*.tsx) or a package subpath without ".js" (next/server).
    if (specifier.startsWith('.')) {
      for (const ext of ['.ts', '.tsx']) {
        try { return await next(specifier + ext, context); } catch { /* try the next extension */ }
      }
    } else {
      try { return await next(specifier + '.js', context); } catch { /* fall through */ }
    }
    throw err;
  }
}

export async function load(url, context, next) {
  // Repo .ts files are transpiled too: Node's type stripping rejects parameter properties (lib/ideas.ts uses them).
  if (url.startsWith('file:') && (url.endsWith('.tsx') || url.endsWith('.ts')) && !url.includes('/node_modules/')) {
    const source = await readFile(fileURLToPath(url), 'utf8');
    const out = ts.transpileModule(source, {
      fileName: fileURLToPath(url),
      compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, verbatimModuleSyntax: false },
    });
    return { format: 'module', source: out.outputText, shortCircuit: true };
  }
  return next(url, context);
}
