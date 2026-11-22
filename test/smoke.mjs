/**
 * Build-output smoke test: verifies the compiled host entry exports the
 * contract the DSH loader needs (name, inject, apply, Config, TYPERT) and that
 * the pure routing helpers behave, without touching the network or a Cordis
 * context.
 */
import { pathToFileURL, fileURLToPath } from 'node:url'
import { existsSync, readFileSync } from 'node:fs'
import { Script } from 'node:vm'
import { dirname, join } from 'node:path'

const root = dirname(fileURLToPath(import.meta.url))
const checks = []

function assert(condition, message) {
  checks.push({ condition: !!condition, message })
}

// 1. Build artifacts exist.
assert(existsSync(join(root, '..', 'lib', 'index.js')), 'lib/index.js exists')
assert(existsSync(join(root, '..', 'lib', 'remote.js')), 'lib/remote.js exists')
assert(!existsSync(join(root, '..', 'dist')), 'no stale dist directory')
assert(existsSync(join(root, '..', 'lib', 'client.js')), 'lib/client.js exists')

// 1b. The client bundle must be a classic script (the loader evals it as one).
const clientSource = readFileSync(join(root, '..', 'lib', 'client.js'), 'utf8')
let classicScriptOk = true
try {
  new Script(clientSource, { filename: 'lib/client.js' })
} catch (_notAClassicScript) {
  classicScriptOk = false
}
assert(classicScriptOk, 'lib/client.js parses as a classic script (no ESM syntax)')
assert(!/^\s*(?:import\s|export\s)/m.test(clientSource), 'lib/client.js contains no import/export statements')
assert(clientSource.includes('__ModuleLoader__.load'), 'lib/client.js self-registers with the module loader')

// 2. Host entry exports the loader contract.
const host = await import(pathToFileURL(join(root, '..', 'lib', 'index.js')).href)
assert(typeof host.apply === 'function', 'apply is a function')
assert(host.name === 'bailian-auto-router', 'name is bailian-auto-router')
assert(Array.isArray(host.inject) && host.inject.includes('llm'), 'inject includes llm')
assert(host.Config !== undefined, 'Config schema exported')
assert(Array.isArray(host.REMOTE_ENDPOINTS) && host.REMOTE_ENDPOINTS.length === 15, 'REMOTE_ENDPOINTS lists the 15 endpoints')
assert(host.REMOTE_ENDPOINTS.some(e => e.endsWith('/pinUserModel')) && host.REMOTE_ENDPOINTS.some(e => e.endsWith('/inheritKeyLedger')), '0.6 adds pinUserModel + inheritKeyLedger endpoints')
assert(!('TYPERT' in host), 'no generated Typert artifact is exported (source markers are used)')

// 3. Pure routing helpers behave.
const catalog = await import(pathToFileURL(join(root, '..', 'lib', 'catalog.js')).href)
assert(catalog.inferVision('qwen-vl-max') === true, 'inferVision(qwen-vl-max) true')
assert(catalog.inferVision('qwen-plus') === false, 'inferVision(qwen-plus) false')
assert(catalog.BUILTIN_CATALOG.length >= 20, 'builtin catalog has >= 20 entries')
assert(catalog.DEFAULT_TASK_ROUTES.image.every(id => catalog.catalogEntry(id)?.vision === true), 'default image route is vision-only')

const decision = await import(pathToFileURL(join(root, '..', 'lib', 'decision.js')).href)
const parsed = decision.parseDecision('```json\n{"selected_model":"qwen-plus","reasoning":"test"}\n```')
assert(parsed?.selectedModel === 'qwen-plus', 'parseDecision extracts from fenced JSON')
assert(decision.parseDecision('no json here') === undefined, 'parseDecision rejects non-JSON')

// 4. The Host service is discoverable by the Gateway's source (SRC) route:
//    a frozen `typertRemote` binding on the instance plus a marker record on
//    the prototype, and every marker must resolve to a prototype method whose
//    emitted parameter list the Gateway can parse.
const remoteModule = await import(pathToFileURL(join(root, '..', 'lib', 'remote.js')).href)
const MARKER_KEY = '@deepseek-ai/dsh-typert-protocol/remote-methods'
const provided = []
const fakeCtx = {
  root: { reflect: { props: {} }, accessor() { /* recorded as declared */ } },
  provide(name, value) { provided.push({ name, value }) },
  logger: { info() {}, warn() {}, error() {}, debug() {} },
}
const fakeImpl = Object.fromEntries(
  ['getState', 'updateConfig', 'refreshPool', 'switchConnection', 'upsertAccount', 'removeAccount', 'activateAccount', 'resetQuota', 'clearHistory']
    .map(method => [method, async () => ({ ok: method })]),
)
remoteModule.provideRemoteService(fakeCtx, fakeImpl)

assert(provided.length === 1 && provided[0].name === 'bailianRouter', 'service registered under the bailianRouter key')
const instance = provided[0].value
const binding = instance.typertRemote
assert(binding !== undefined && Object.isFrozen(binding), 'typertRemote binding present and frozen')
assert(binding.service === instance, 'binding names the service instance itself')
assert(binding.serviceKey === 'bailianRouter' && binding.namespace === 'bailianRouter', 'binding declares key and namespace')

const marker = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(instance), MARKER_KEY)?.value
assert(marker?.version === 1, 'prototype carries a version 1 marker record')
const marked = (marker?.methods ?? []).map(entry => entry.method).sort()
assert(JSON.stringify(marked) === JSON.stringify([...remoteModule.REMOTE_ENDPOINTS].map(endpoint => endpoint.split('/')[1]).sort()), 'every endpoint is marked')

/** Mirror the Gateway: read the emitted parameter list, rejecting anything but plain identifiers. */
function parameterNames(fn) {
  const source = Function.prototype.toString.call(fn)
  const open = source.indexOf('(')
  const close = source.indexOf(')', open + 1)
  const body = source.slice(open + 1, close).trim()
  if (body.length === 0) return []
  return body.split(',').map(part => part.trim())
}
const prototype = Object.getPrototypeOf(instance)
const expectedWires = {
  getState: [], updateConfig: ['patch'], refreshPool: [],
  switchConnection: ['entryId', 'providerId'], upsertAccount: ['account'],
  removeAccount: ['id'], activateAccount: ['id'], resetQuota: ['model'],
  resetModelTotals: ['model'], selfCheck: [], clearHistory: [],
  pinUserModel: ['model'], inheritKeyLedger: ['fromKeyId', 'toKeyId'],
  checkUpdate: [], applyUpdate: ['tag'],
}
let wiresOk = true
for (const [method, wires] of Object.entries(expectedWires)) {
  const implementation = prototype[method]
  if (typeof implementation !== 'function') { wiresOk = false; break }
  if (JSON.stringify(parameterNames(implementation)) !== JSON.stringify(wires)) { wiresOk = false; break }
}
assert(wiresOk, 'prototype parameter lists parse as the wire names the Client sends')
assert(instance.getState instanceof Function, 'methods are callable on the instance')

// 5. Client contribution must repeat the same namespace and wire names.
const clientEndpoints = [...clientSource.matchAll(/endpoint\('([A-Za-z]+)'\)/g)].map(match => match[1]).sort()
assert(JSON.stringify(clientEndpoints) === JSON.stringify(Object.keys(expectedWires).sort()), 'client declares exactly the marked endpoints')
assert(/namespace:\s*NS/.test(clientSource) && /service:\s*NS/.test(clientSource), 'client descriptors carry namespace and service')
const clientWires = [...clientSource.matchAll(/param\('([A-Za-z]+)'/g)].map(match => match[1]).sort()
assert(JSON.stringify(clientWires) === JSON.stringify(['account', 'entryId', 'fromKeyId', 'id', 'id', 'model', 'model', 'model', 'patch', 'providerId', 'tag', 'toKeyId'].sort()), 'client wire names match the Host parameter names')

// Report.
let failed = 0
for (const check of checks) {
  if (!check.condition) failed += 1
  console.log(`${check.condition ? 'ok' : 'FAIL'}  ${check.message}`)
}
console.log(`\n${checks.length - failed}/${checks.length} checks passed`)
process.exit(failed > 0 ? 1 : 0)
