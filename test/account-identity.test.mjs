// Key identity, connection de-duplication/display names, and ordering strategies.
import assert from 'node:assert/strict'
import {
  accountKeyId, discoveredKeyId, endpointKeyId, resolveKeyId,
  dedupeConnections, connectionLabel, connectionFingerprint,
} from '../lib/identity.js'
import { orderCandidates, priceOf } from '../lib/strategy.js'
import { PROVIDER, VIRTUAL_MODEL } from '../lib/catalog.js'

let n = 0
const ok = (name, fn) => { fn(); n++; console.log('ok   ', name) }

ok('accountKeyId prefixes acct', () => assert.equal(accountKeyId('a'), 'acct:a'))
ok('discoveredKeyId stable for same inputs', () =>
  assert.equal(discoveredKeyId('https://x/v1', 'REF', 'ab12'), discoveredKeyId('https://x/v1/', 'REF', 'ab12')))
ok('discoveredKeyId differs on key hint', () =>
  assert.notEqual(discoveredKeyId('https://x/v1', 'REF', 'ab12'), discoveredKeyId('https://x/v1', 'REF', 'cd34')))
ok('endpointKeyId stable', () => assert.equal(endpointKeyId('https://x/v1', 'E'), endpointKeyId('https://x/v1/', 'E')))
ok('resolveKeyId prefers saved account', () =>
  assert.equal(resolveKeyId({ activeAccountId: 'a', baseURL: 'https://x/v1', apiKeyEnv: 'E' }), 'acct:a'))
ok('resolveKeyId uses discovery when no account', () =>
  assert.equal(resolveKeyId({ discovered: { credentialRef: 'R', keyHint: 'h' }, baseURL: 'https://x/v1', apiKeyEnv: 'E' }), discoveredKeyId('https://x/v1', 'R', 'h')))
ok('resolveKeyId falls back to endpoint', () =>
  assert.equal(resolveKeyId({ baseURL: 'https://x/v1', apiKeyEnv: 'E' }), endpointKeyId('https://x/v1', 'E')))

const self = { id: PROVIDER, name: PROVIDER, baseURL: 'https://x/v1', kind: 'discovered' }
const virt = { id: VIRTUAL_MODEL, name: VIRTUAL_MODEL, baseURL: 'https://x/v1', kind: 'discovered' }
const a1 = { id: 'c1', name: 'My Packy', providerId: 'packy', baseURL: 'https://x/v1', credentialRef: 'R1', keyHint: 'h1', kind: 'saved' }
const a2 = { id: 'c2', name: 'dup', providerId: 'packy', baseURL: 'https://x/v1/', credentialRef: 'R1', keyHint: 'h1', kind: 'discovered' }
const a3 = { id: 'c3', name: 'other key', baseURL: 'https://x/v1', credentialRef: 'R2', keyHint: 'h2', kind: 'saved' }

ok('dedupe drops the plugin self provider', () =>
  assert.equal(dedupeConnections([self, a1]).length, 1))
ok('dedupe drops the virtual model id', () =>
  assert.equal(dedupeConnections([virt, a1]).length, 1))
ok('dedupe collapses same endpoint+credential', () =>
  assert.equal(dedupeConnections([a1, a2]).length, 1))
ok('dedupe keeps distinct credentials', () =>
  assert.equal(dedupeConnections([a1, a3]).length, 2))
ok('fingerprint ignores trailing slash', () =>
  assert.equal(connectionFingerprint(a1), connectionFingerprint(a2)))
ok('label prefers user name', () => assert.equal(connectionLabel(a1), 'My Packy'))
ok('label falls back to providerId', () =>
  assert.equal(connectionLabel({ id: 'z', name: '', providerId: 'pid', baseURL: 'u', kind: 'saved' }), 'pid'))

const cands = [
  { id: 'deepseek-v4-pro', quality: 90, speed: 40 },
  { id: 'deepseek-v4.1-flash-1017', quality: 85, speed: 90 },
  { id: 'qwen-turbo', quality: 50, speed: 95 },
]
const opts = { bucketTokens: 1_000_000, bucketTolerance: 0.05 }

ok('price puts flash before pro', () => {
  const { order } = orderCandidates(cands, 'price', undefined, opts)
  assert.ok(order.indexOf('deepseek-v4.1-flash-1017') < order.indexOf('deepseek-v4-pro'))
})
ok('capability orders by quality desc', () => {
  const { order } = orderCandidates(cands, 'capability', undefined, opts)
  assert.deepEqual(order, ['deepseek-v4-pro', 'deepseek-v4.1-flash-1017', 'qwen-turbo'])
})
ok('speed orders by speed desc', () => {
  const { order } = orderCandidates(cands, 'speed', undefined, opts)
  assert.deepEqual(order, ['qwen-turbo', 'deepseek-v4.1-flash-1017', 'deepseek-v4-pro'])
})
ok('free_quota all-empty starts from the cheapest/light model', () => {
  const { order, allFull } = orderCandidates(cands, 'free_quota', undefined, opts)
  assert.equal(allFull, false)
  assert.equal(order[0], 'qwen-turbo')
})
ok('free_quota picks least-consumed bucket', () => {
  const ledger = { keyId: 'k', label: 'k', baseURL: 'u', updatedAt: 0, totalTokens: 0, cycle: 0, models: {
    'deepseek-v4-pro': { tokens: 900000, calls: 1, bucketTokens: 900000, bucketStartedAt: 0, lastUsedAt: 0 },
    'deepseek-v4.1-flash-1017': { tokens: 100000, calls: 1, bucketTokens: 100000, bucketStartedAt: 0, lastUsedAt: 0 },
    'qwen-turbo': { tokens: 0, calls: 0, bucketTokens: 0, bucketStartedAt: 0, lastUsedAt: 0 },
  } }
  const { order } = orderCandidates(cands, 'free_quota', ledger, opts)
  assert.equal(order[0], 'qwen-turbo')
})
ok('free_quota pushes full buckets to the tail', () => {
  const ledger = { keyId: 'k', label: 'k', baseURL: 'u', updatedAt: 0, totalTokens: 0, cycle: 0, models: {
    'deepseek-v4-pro': { tokens: 960000, calls: 1, bucketTokens: 960000, bucketStartedAt: 0, lastUsedAt: 0 },
  } }
  const { order } = orderCandidates(cands, 'free_quota', ledger, opts)
  assert.equal(order.at(-1), 'deepseek-v4-pro')
})
ok('free_quota allFull when every bucket past threshold', () => {
  const full = Object.fromEntries(cands.map(c => [c.id, { tokens: 990000, calls: 1, bucketTokens: 990000, bucketStartedAt: 0, lastUsedAt: 0 }]))
  const ledger = { keyId: 'k', label: 'k', baseURL: 'u', updatedAt: 0, totalTokens: 0, cycle: 0, models: full }
  const { allFull } = orderCandidates(cands, 'free_quota', ledger, opts)
  assert.equal(allFull, true)
})
ok('tolerance boundary: 96% is full at 5% tolerance', () => {
  const ledger = { keyId: 'k', label: 'k', baseURL: 'u', updatedAt: 0, totalTokens: 0, cycle: 0, models: {
    'qwen-turbo': { tokens: 960000, calls: 1, bucketTokens: 960000, bucketStartedAt: 0, lastUsedAt: 0 },
  } }
  const { order } = orderCandidates(cands, 'free_quota', ledger, opts)
  assert.notEqual(order[0], 'qwen-turbo')
})
ok('priceOf known id vs tier fallback', () => {
  assert.equal(priceOf('deepseek-v4.1-flash-1017'), 2)
  assert.ok(priceOf('some-unknown-flash-x') < priceOf('some-unknown-pro-x'))
})
ok('orderCandidates does not mutate the ledger', () => {
  const ledger = { keyId: 'k', label: 'k', baseURL: 'u', updatedAt: 0, totalTokens: 5, cycle: 0, models: {
    'qwen-turbo': { tokens: 5, calls: 1, bucketTokens: 5, bucketStartedAt: 0, lastUsedAt: 0 },
  } }
  orderCandidates(cands, 'free_quota', ledger, opts)
  assert.equal(ledger.models['qwen-turbo'].bucketTokens, 5)
  assert.equal(ledger.cycle, 0)
})

console.log(`${n}/${n} checks passed`)
