// Per-key token ledger, bucket rotation accounting and v1->v2 migration.
import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { RouterStore } from '../lib/store.js'

let n = 0
const ok = (name, fn) => { fn(); n++; console.log('ok   ', name) }
const okAsync = async (name, fn) => { await fn(); n++; console.log('ok   ', name) }

const tmp = await mkdtemp(join(tmpdir(), 'ledger-'))
const store = RouterStore.create(join(tmp, 'state.json'))
await store.ready

ok('fresh state is v2 with empty ledgers', () => {
  assert.equal(store.state.version, 2)
  assert.deepEqual(store.state.ledgers, {})
  assert.deepEqual(store.state.keyHistory, [])
})

ok('ledgerOf creates an empty ledger', () => {
  const ledger = store.ledgerOf('acct:a', { label: 'A', baseURL: 'https://x/v1' })
  assert.equal(ledger.keyId, 'acct:a')
  assert.equal(ledger.totalTokens, 0)
  assert.deepEqual(ledger.models, {})
})

ok('ledgerOf returns the same instance', () => {
  assert.equal(store.ledgerOf('acct:a'), store.state.ledgers['acct:a'])
})

ok('recordLedgerTokens accumulates tokens/calls/bucket', () => {
  store.recordLedgerTokens('acct:a', 'm1', 1000)
  store.recordLedgerTokens('acct:a', 'm1', 500)
  const entry = store.state.ledgers['acct:a'].models.m1
  assert.equal(entry.tokens, 1500)
  assert.equal(entry.calls, 2)
  assert.equal(entry.bucketTokens, 1500)
})

ok('negative tokens clamp to zero', () => {
  store.recordLedgerTokens('acct:a', 'm2', -50)
  assert.equal(store.state.ledgers['acct:a'].models.m2.tokens, 0)
})

ok('totalTokens sums across models', () => {
  assert.equal(store.state.ledgers['acct:a'].totalTokens, 1500)
})

ok('resetBucket(model) zeroes one bucket', () => {
  store.resetBucket('acct:a', 'm1')
  assert.equal(store.state.ledgers['acct:a'].models.m1.bucketTokens, 0)
  assert.equal(store.state.ledgers['acct:a'].models.m1.tokens, 1500)
})

ok('resetBucket() zeroes all and bumps cycle', () => {
  store.recordLedgerTokens('acct:a', 'm2', 10)
  store.resetBucket('acct:a')
  assert.equal(store.state.ledgers['acct:a'].models.m2.bucketTokens, 0)
  assert.equal(store.state.ledgers['acct:a'].cycle, 1)
})

ok('hasLedger reflects existence', () => {
  assert.equal(store.hasLedger('acct:a'), true)
  assert.equal(store.hasLedger('acct:nope'), false)
})

ok('sameEndpointLedger finds same url other key', () => {
  store.ledgerOf('acct:b', { label: 'B', baseURL: 'https://x/v1' })
  const found = store.sameEndpointLedger('acct:b', 'https://x/v1')
  assert.equal(found?.keyId, 'acct:a')
})

ok('sameEndpointLedger ignores trailing slash', () => {
  assert.equal(store.sameEndpointLedger('acct:b', 'https://x/v1/')?.keyId, 'acct:a')
})

ok('sameEndpointLedger excludes the same key', () => {
  assert.equal(store.sameEndpointLedger('acct:a', 'https://x/v1')?.keyId, 'acct:b')
})

ok('sameEndpointLedger undefined for other url', () => {
  store.ledgerOf('acct:c', { label: 'C', baseURL: 'https://other/v1' })
  assert.equal(store.sameEndpointLedger('acct:c', 'https://other/v1'), undefined)
})

ok('inheritLedger clones models/total/cycle', () => {
  store.recordLedgerTokens('acct:a', 'm1', 700)
  const target = store.inheritLedger('acct:a', 'acct:d', { label: 'D', baseURL: 'https://x/v1' })
  assert.equal(target.models.m1.tokens, 2200)
  assert.equal(target.totalTokens, store.state.ledgers['acct:a'].totalTokens)
  assert.equal(target.inheritedFrom, 'acct:a')
})

ok('inheritLedger from missing source throws', () => {
  assert.throws(() => store.inheritLedger('acct:ghost', 'acct:e', { baseURL: 'https://x/v1' }), /source ledger not found/)
})

ok('keyHistory is recency ordered', () => {
  store.ledgerOf('acct:e', { baseURL: 'https://x/v1' })
  assert.equal(store.state.keyHistory[0], 'acct:e')
})

ok('recordRoute keeps origin/strategy/keyId/tokens', () => {
  store.recordRoute({ at: 1, task: 'general', modality: 'text', decisionSource: 'model', attempts: [], ok: true, origin: 'user', strategy: 'price', keyId: 'acct:a', tokens: 42 })
  const last = store.state.history.at(-1)
  assert.equal(last.origin, 'user')
  assert.equal(last.strategy, 'price')
  assert.equal(last.keyId, 'acct:a')
  assert.equal(last.tokens, 42)
})

ok('ledger survives recordUsage (strategy switch does not reset)', () => {
  const before = store.state.ledgers['acct:a'].totalTokens
  store.recordUsage('general', 'm1', 999)
  assert.equal(store.state.ledgers['acct:a'].totalTokens, before)
})

await okAsync('flush persists ledgers to disk', async () => {
  await store.flush()
  const raw = JSON.parse(await readFile(join(tmp, 'state.json'), 'utf8'))
  assert.equal(raw.version, 2)
  assert.ok(raw.ledgers['acct:a'])
})

await okAsync('reopen reads ledgers back', async () => {
  const again = await RouterStore.open(join(tmp, 'state.json'))
  assert.equal(again.state.ledgers['acct:a'].models.m1.tokens, 2200)
  await again.dispose()
})

await okAsync('v1 file migrates and keeps a backup', async () => {
  const file = join(tmp, 'v1.json')
  await writeFile(file, JSON.stringify({ version: 1, pool: [{ id: 'm1', source: 'sync' }], quota: { m1: { fails: 0, calls: 3 } }, history: [], usage: {}, visionVeto: {}, visionOk: {}, effortUnsupported: {}, sessions: {}, modelTotals: { m1: { calls: 3, tokens: 10 } } }), 'utf8')
  const migrated = await RouterStore.open(file)
  assert.equal(migrated.state.version, 2)
  assert.deepEqual(migrated.state.ledgers, {})
  assert.equal(migrated.state.pool.length, 1)
  assert.equal(migrated.state.quota.m1.calls, 3)
  assert.equal(migrated.state.modelTotals.m1.tokens, 10)
  const backup = JSON.parse(await readFile(`${file}.v1.bak`, 'utf8'))
  assert.equal(backup.version, 1)
  await migrated.dispose()
})

await okAsync('sanitize keeps only numeric ledger fields', async () => {
  const file = join(tmp, 'dirty.json')
  await writeFile(file, JSON.stringify({ version: 2, ledgers: { k: { label: 'K', baseURL: 'u', models: { m: { tokens: 'x', calls: 2, bucketTokens: 5 } }, totalTokens: 5 } }, keyHistory: ['k', 3], pendingUserModel: 'm1' }), 'utf8')
  const dirty = await RouterStore.open(file)
  assert.equal(dirty.state.ledgers.k.models.m.tokens, 0)
  assert.equal(dirty.state.ledgers.k.models.m.calls, 2)
  assert.deepEqual(dirty.state.keyHistory, ['k'])
  assert.equal(dirty.state.pendingUserModel, 'm1')
  await dirty.dispose()
})

await store.dispose()
await rm(tmp, { recursive: true, force: true })
console.log(`${n}/${n} checks passed`)
