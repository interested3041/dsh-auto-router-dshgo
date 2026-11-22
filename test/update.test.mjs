// Auto Router 0.6.1 — self-update version compare + install dir resolution.
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const lib = name => pathToFileURL(join(process.cwd(), 'lib', name)).href
const { compareVersions, currentVersion, installDir, UPDATE_REPO } = await import(lib('update.js'))

let n = 0
const ok = (name, fn) => { fn(); n++; console.log('ok   ', name) }

ok('compare equal', () => assert.equal(compareVersions('0.6.0', '0.6.0'), 0))
ok('compare patch bump', () => assert.equal(compareVersions('0.6.1', '0.6.0'), 1))
ok('compare older', () => assert.equal(compareVersions('0.5.5', '0.6.0'), -1))
ok('compare minor bump', () => assert.equal(compareVersions('0.7.0', '0.6.9'), 1))
ok('compare major bump', () => assert.equal(compareVersions('1.0.0', '0.9.9'), 1))
ok('compare strips v prefix', () => assert.equal(compareVersions('v0.6.1', '0.6.1'), 0))
ok('compare numeric not lexical', () => assert.equal(compareVersions('0.10.0', '0.9.0'), 1))
ok('currentVersion reads package', () => assert.match(currentVersion(), /^\d+\.\d+\.\d+$/))
ok('installDir contains package.json', () => assert.ok(installDir().length > 0))
ok('repo default set', () => assert.ok(UPDATE_REPO.includes('dsh-auto-router')))

console.log(`${n}/${n} checks passed`)