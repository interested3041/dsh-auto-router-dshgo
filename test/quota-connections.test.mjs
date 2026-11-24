// Auto Router 0.6 — config defaults, connection dedupe/self-filter, ledger inherit.
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const lib = name => pathToFileURL(join(process.cwd(), 'lib', name)).href
const { resolveOptions } = await import(lib('config.js'))
const { resolveKeyId, dedupeConnections, connectionLabel, accountKeyId, discoveredKeyId } = await import(lib('identity.js'))
const { listConnections } = await import(lib('connection.js'))
const { RouterStore } = await import(lib('store.js'))
const { priceOf, orderCandidates } = await import(lib('strategy.js'))

let n = 0
const ok = (name, fn) => { fn(); n++; console.log('ok   ', name) }

ok('default sortStrategy auto', () => assert.equal(resolveOptions({}).sortStrategy, 'auto'))
ok('default bucketTokens 1e6', () => assert.equal(resolveOptions({}).bucketTokens, 1_000_000))
ok('default bucketTolerance .05', () => assert.equal(resolveOptions({}).bucketTolerance, 0.05))
ok('sortStrategy price honored', () => assert.equal(resolveOptions({ sortStrategy: 'price' }).sortStrategy, 'price'))
ok('sortStrategy free_quota honored', () => assert.equal(resolveOptions({ sortStrategy: 'free_quota' }).sortStrategy, 'free_quota'))
ok('bucketTokens override', () => assert.equal(resolveOptions({ bucketTokens: 5000 }).bucketTokens, 5000))
ok('bucketTolerance override', () => assert.equal(resolveOptions({ bucketTolerance: 0.2 }).bucketTolerance, 0.2))
ok('invalid sortStrategy falls back auto', () => assert.equal(resolveOptions({ sortStrategy: 'bogus' }).sortStrategy, 'auto'))

const self = { id: 'auto-router', name: 'auto-router', providerId: 'auto-router', baseURL: 'https://x', kind: 'discovered' }
const real = { id: 'llm-pi-ai', name: '阿里云', providerId: 'bailian', baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1', credentialRef: 'DASHSCOPE_API_KEY', kind: 'discovered' }
const dup = { ...real, id: 'llm-pi-ai-2', name: '阿里云副本' }
const other = { id: 'sf', name: '硅基', providerId: 'siliconflow', baseURL: 'https://api.siliconflow.cn/v1', credentialRef: 'SF_KEY', kind: 'discovered' }

ok('dedupe filters the plugin self provider', () => {
  assert.equal(dedupeConnections([self, real]).length, 1)
})
ok('dedupe keeps real bailian provider', () => {
  assert.equal(dedupeConnections([real])[0].providerId, 'bailian')
})
ok('dedupe collapses same endpoint+credential', () => {
  assert.equal(dedupeConnections([real, dup]).length, 1)
})
ok('dedupe keeps distinct endpoints', () => {
  assert.equal(dedupeConnections([real, other]).length, 2)
})
ok('connectionLabel prefers user name', () => assert.equal(connectionLabel(real), '阿里云'))
ok('connectionLabel falls back providerId', () => assert.equal(connectionLabel({ id: 'x', name: '', providerId: 'p', baseURL: 'b', kind: 'discovered' }), 'p'))

ok('listConnections carries provider displayName (never credential ref)', () => {
  const ctx = { get: key => key === 'configEditor' ? {
    configuration: () => [{
      entry: { options: { id: 'cc-switch-packy-code' } },
      inherited: { providers: { 'cc-switch-packy-code': { displayName: 'PackyCode', baseURL: 'https://api.siliconflow.cn/v1', apiKeyEnv: 'CC_SWITCH_DSH_CC_SWITCH_PACKY_CODE' } } },
      override: {},
    }],
  } : undefined }
  const list = listConnections(ctx)
  assert.equal(list[0].name, 'PackyCode')
  assert.equal(list[0].providerId, 'cc-switch-packy-code')
  assert.equal(list[0].apiKeyEnv, 'CC_SWITCH_DSH_CC_SWITCH_PACKY_CODE')
  assert.notEqual(connectionLabel({ ...list[0], kind: 'discovered' }), list[0].apiKeyEnv)
})
ok('flat provider row reads displayName too', () => {
  const ctx = { get: key => key === 'configEditor' ? {
    configuration: () => [{ entry: { options: { id: 'pack' } }, inherited: { displayName: 'PackyCode', baseURL: 'https://api.siliconflow.cn/v1' }, override: {} }],
  } : undefined }
  assert.equal(listConnections(ctx)[0].name, 'PackyCode')
})

ok('accountKeyId acct prefix', () => assert.ok(accountKeyId('a1').startsWith('acct:')))
ok('discoveredKeyId disc prefix', () => assert.ok(discoveredKeyId('https://x', 'REF', 'hint').startsWith('disc:')))
ok('resolveKeyId active account wins', () => assert.equal(resolveKeyId({ activeAccountId: 'a1', baseURL: 'https://x', apiKeyEnv: 'E' }), accountKeyId('a1')))
ok('resolveKeyId endpoint fallback ep prefix', () => assert.ok(resolveKeyId({ baseURL: 'https://x', apiKeyEnv: 'E' }).startsWith('ep:')))
ok('resolveKeyId stable for same input', () => assert.equal(resolveKeyId({ baseURL: 'https://x', apiKeyEnv: 'E' }), resolveKeyId({ baseURL: 'https://x', apiKeyEnv: 'E' })))

const store = new RouterStore(mkdtempSync(join(tmpdir(), 'dsh-qc-')))
await store.ready
ok('recordLedgerTokens accumulates per model', () => {
  store.recordLedgerTokens('k1', 'm', 100)
  store.recordLedgerTokens('k1', 'm', 50)
  assert.equal(store.ledgerOf('k1').models.m.tokens, 150)
  assert.equal(store.ledgerOf('k1').totalTokens, 150)
})
ok('resetBucket(model) clears only that model', () => {
  store.recordLedgerTokens('k1', 'n', 10)
  store.resetBucket('k1', 'm')
  assert.equal(store.ledgerOf('k1').models.m.bucketTokens, 0)
  assert.equal(store.ledgerOf('k1').models.n.bucketTokens, 10)
})
ok('resetBucket()全清 bumps cycle', () => {
  const before = store.ledgerOf('k1').cycle
  store.resetBucket('k1')
  assert.equal(store.ledgerOf('k1').cycle, before + 1)
})

ok('price tiers flash<plus<max', () => {
  assert.ok(priceOf('qwen-flash') < priceOf('qwen-plus'))
  assert.ok(priceOf('qwen-plus') < priceOf('qwen-max'))
})
ok('price tie broken by quality', () => {
  const r = orderCandidates([{ id: 'a-flash', quality: 40, speed: 50 }, { id: 'b-flash', quality: 80, speed: 50 }], 'price')
  assert.equal(r.order[0], 'b-flash')
})
ok('invalid bucketTokens falls back default', () => assert.equal(resolveOptions({ bucketTokens: 10 }).bucketTokens, 1_000_000))
ok('out-of-range bucketTolerance clamps to 0.5', () => assert.equal(resolveOptions({ bucketTolerance: 0.9 }).bucketTolerance, 0.5))
ok('dedupe empty list stays empty', () => assert.deepEqual(dedupeConnections([]), []))
ok('connectionLabel falls back id', () => assert.equal(connectionLabel({ id: 'only-id', name: '', providerId: '', baseURL: 'b', kind: 'discovered' }), 'only-id'))

console.log(`${n}/${n} checks passed`)