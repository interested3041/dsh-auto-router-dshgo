// The DSH client module loader evaluates `client.js` as a CLASSIC script and
// expects it to self-register through `window.__ModuleLoader__.load({...})`.
// TypeScript, under `module: NodeNext` with `"type": "module"`, treats a file
// with no imports/exports as an ES module and appends an `export {};` marker —
// which the browser rejects with `SyntaxError: Unexpected token 'export'`.
//
// This step strips that marker and then PROVES the result is a classic script
// by compiling it with `vm.Script` (ESM syntax fails there). A bundle that still
// contains module syntax fails the build instead of silently breaking the page.
import { readFile, writeFile } from 'node:fs/promises'
import { Script } from 'node:vm'

const file = new URL('../lib/client.js', import.meta.url)
const source = await readFile(file, 'utf8')
const stripped = source.replace(/^\s*export\s*\{\s*\}\s*;?\s*$/gm, '')

if (stripped !== source) {
  await writeFile(file, stripped, 'utf8')
  console.log('postbuild: removed the ES-module marker from lib/client.js')
}

// Any remaining module syntax means the client half was compiled as a module.
const moduleSyntax = /^\s*(?:import\s|export\s)/m.exec(stripped)
if (moduleSyntax !== null) {
  throw new Error(
    `lib/client.js still contains module syntax (${JSON.stringify(moduleSyntax[0].trim())}); `
    + 'the DSH client loader evaluates it as a classic script',
  )
}

// Compiling as a *script* is the exact check the browser performs.
try {
  new Script(stripped, { filename: 'lib/client.js' })
} catch (error) {
  throw new Error(`lib/client.js is not a valid classic script: ${String(error?.message ?? error)}`)
}

// The bundle must register itself; an empty file would also "compile".
if (!stripped.includes('__ModuleLoader__.load')) {
  throw new Error('lib/client.js does not call window.__ModuleLoader__.load')
}

console.log('postbuild: lib/client.js verified as a classic script bundle')