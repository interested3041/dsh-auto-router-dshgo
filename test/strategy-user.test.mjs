// Auto Router 0.6 — ordering strategies + free-quota rotation + user directive.
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const lib = name => pathToFileURL(join(process.cwd(), 'lib', name)).href
const { orderCandidates, priceOf } = await import(lib('strategy.js'))
const { parseUserModelDirective } = await import(lib('identity.js'))
const { RouterStore } = await import(lib('store.js'))

let n = 0
const ok = (name, fn) => { fn(); n++; console.log('ok   ', name) }

const cands = [
  { id: 'cheap-flash', quality: 40, speed: 90 },
  { id: 'mid-plus', quality: 70, speed: 60 },
  { id: 'flag-max', quality: 95, speed: 30 },
]

ok('auto keeps input order', () => {
  assert.deepEqual(orderCandidates(cands, 'auto').order, ['cheap-flash', 'mid-plus', 'flag-max'])
})
ok('price ascending', () => {
  assert.deepEqual(orderCandidates(cands, 'price').order, ['cheap-flash', 'mid-plus', 'flag-max'])
  assert.ok(priceOf('cheap-flash') < priceOf('flag-max'))
})
ok('capability descending', () => {
  assert.deepEqual(orderCandidates(cands, 'capability').order, ['flag-max', 'mid-plus', 'cheap-flash'])
})
ok('speed descending', () => {
  assert.deepEqual(orderCandidates(cands, 'speed').order, ['cheap-flash', 'mid-plus', 'flag-max'])
})
ok('free_quota with empty ledger starts from the cheapest/light model', () => {
  const r = orderCandidates(cands, 'free_quota', null, { bucketTokens: 1000, bucketTolerance: 0.05 })
  assert.equal(r.allFull, false)
  assert.equal(r.order[0], 'cheap-flash')
})

const store = new RouterStore(mkdtempSync(join(tmpdir(), 'dsh-strat-')))
await store.ready
ok('free_quota rotates to the least-used bucket', () => {
  store.recordLedgerTokens('k', 'flag-max', 900)
  store.recordLedgerTokens('k', 'mid-plus', 100)
  const ledger = store.ledgerOf('k')
  const r = orderCandidates(cands, 'free_quota', ledger, { bucketTokens: 1000, bucketTolerance: 0.05 })
  assert.equal(r.order[0], 'cheap-flash') // least bucket usage first (0 < 100 < 900)
})
ok('free_quota parks full buckets last', () => {
  store.recordLedgerTokens('k', 'mid-plus', 900) // now mid also ~full
  const ledger = store.ledgerOf('k')
  const r = orderCandidates(cands, 'free_quota', ledger, { bucketTokens: 1000, bucketTolerance: 0.05 })
  assert.equal(r.order[r.order.length - 1], 'mid-plus')
})
ok('free_quota allFull triggers cycle reset', () => {
  store.recordLedgerTokens('k', 'cheap-flash', 1000)
  store.recordLedgerTokens('k', 'flag-max', 100) // now every bucket is full
  const ledger = store.ledgerOf('k')
  const r = orderCandidates(cands, 'free_quota', ledger, { bucketTokens: 1000, bucketTolerance: 0.05 })
  assert.equal(r.allFull, true)
  store.resetBucket('k')
  assert.equal(store.ledgerOf('k').cycle, 1)
  assert.equal(store.ledgerOf('k').models['cheap-flash'].bucketTokens, 0)
})

ok('parse /model directive', () => {
  const r = parseUserModelDirective('/model qwen3.8-max 帮我写代码')
  assert.equal(r.model, 'qwen3.8-max')
  assert.equal(r.rest, '帮我写代码')
})
ok('parse @model directive', () => {
  const r = parseUserModelDirective('@model:deepseek-v4.1-flash hi')
  assert.equal(r.model, 'deepseek-v4.1-flash')
  assert.equal(r.rest, 'hi')
})
ok('no directive returns null', () => {
  assert.equal(parseUserModelDirective('普通一句话'), null)
})

console.log(`${n}/${n} checks passed`)
