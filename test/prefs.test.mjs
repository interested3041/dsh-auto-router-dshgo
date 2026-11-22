// 0.8.0 — persisted user preferences: save/load/hydrate/rollback contract.
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadPrefs, savePrefs, hydrateConfig } from '../lib/prefs.js'
import { resolveOptions } from '../lib/config.js'

let n = 0
const ok = (cond, msg) => { assert.ok(cond, msg); n++ }
const eq = (a, b, msg) => { assert.deepEqual(a, b, msg); n++ }
const throws = (fn, re, msg) => { assert.throws(fn, re, msg); n++ }

// Mirror of the cosmokit volatile protocol (frozen get + shared write symbol).
const WRITE = Symbol.for('cosmokit.volatile.write')
const vol = (value) => {
  let current = value
  return Object.freeze({ get: () => current, [WRITE]: (next) => { current = next } })
}

const dir = mkdtempSync(join(tmpdir(), 'prefs-'))
const file = join(dir, 'prefs.json')

eq(loadPrefs(file), {}, 'missing prefs -> {}')
writeFileSync(file, '{oops', 'utf8')
eq(loadPrefs(file), {}, 'corrupt prefs -> {}')

savePrefs(file, {
  sortStrategy: 'price', rogueKey: 1,
  accounts: [{ id: 'a', name: 'n', baseURL: 'https://x/v1', apiKey: 'sk-secret123456' }],
})
const saved = JSON.parse(readFileSync(file, 'utf8'))
eq(saved.sortStrategy, 'price', 'known key saved')
ok(!('rogueKey' in saved), 'unknown key filtered')
eq(saved.accounts[0].apiKey, 'sk-secret123456', 'account secret kept in prefs (local trust)')
savePrefs(file, { connectionNames: { 'e|p': '我的连接' } })
eq(loadPrefs(file).sortStrategy, 'price', 'merge keeps earlier keys')
eq(loadPrefs(file).connectionNames['e|p'], '我的连接', 'rename saved')

const config = {
  sortStrategy: vol('auto'), modelLimits: vol({}), connectionNames: vol({}),
  baseURL: vol('https://default/v1'),
}
const undo = hydrateConfig(config, loadPrefs(file))
eq(config.sortStrategy.get(), 'price', 'volatile hydrated')
eq(config.connectionNames.get()['e|p'], '我的连接', 'rename hydrated')
eq(resolveOptions(config).sortStrategy, 'price', 'resolveOptions sees hydrated sort')
undo()
eq(config.sortStrategy.get(), 'auto', 'rollback restores')
eq(resolveOptions(config).sortStrategy, 'auto', 'resolve after rollback')

const plainCfg = { sortStrategy: 'auto' }
const undo2 = hydrateConfig(plainCfg, { sortStrategy: 'speed' })
eq(plainCfg.sortStrategy, 'speed', 'plain config hydrated')
undo2()
eq(plainCfg.sortStrategy, 'auto', 'plain rollback')

const c3 = { sortStrategy: vol('auto') }
hydrateConfig(c3, { notAKey: 1, modelLimits: { m: { maxTokens: 100000 } } })
eq(c3.sortStrategy.get(), 'auto', 'absent config key untouched')
ok(!('notAKey' in c3), 'unknown key not injected')

const c4 = { baseURL: vol('https://ok/v1'), sortStrategy: vol('auto') }
const undo4 = hydrateConfig(c4, { baseURL: 'not-a-url' })
throws(() => resolveOptions(c4), /URL|HTTP/, 'bad prefs fail validation')
undo4()
eq(resolveOptions(c4).baseURL, 'https://ok/v1', 'bad prefs rolled back, base config valid')

const c5 = { modelLimits: vol({}) }
hydrateConfig(c5, { modelLimits: { m: { maxTokens: 100 } } })
eq(resolveOptions(c5).modelLimits.m.maxTokens, 1000000, 'hydrated legacy limit migrated to 1M')

rmSync(dir, { recursive: true, force: true })
console.log(`${n}/${n} checks passed`)