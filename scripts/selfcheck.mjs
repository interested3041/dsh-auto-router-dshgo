/**
 * Live self-check against the real endpoint: exercises the one-click integrity
 * check end to end (credential, endpoint, pool, client.js, state.json, thinking
 * mapping) using this machine's own credential. Prints each item's ✓/✗.
 */
import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const lib = name => import(pathToFileURL(join(root, 'lib', name)).href)
const { Router } = await lib('router.js')
const { RouterStore } = await lib('store.js')
const { createService } = await lib('service.js')

const CREDENTIALS = 'C:\\Users\\30410\\.dsh\\.credentials.yaml'
const PATCH = 'C:\\Users\\30410\\.dsh\\profiles\\desktop\\cordis.patch.yml'
const credential = (ref) => new RegExp(`^\\s+${ref}:\\s*(\\S+)\\s*$`, 'm').exec(readFileSync(CREDENTIALS, 'utf8'))?.[1]?.replace(/^["']|["']$/g, '')
const block = readFileSync(PATCH, 'utf8').split(/^ {6}bailian:/m)[1] ?? ''
const baseURL = /baseURL:\s*(\S+)/.exec(block)?.[1].replace(/\/+$/, '')
const keyEnv = /apiKeyEnv:\s*(\S+)/.exec(block)?.[1]
process.env[keyEnv] = credential(keyEnv)

const store = RouterStore.create(join(tmpdir(), `selfcheck-${Date.now()}.json`))
await store.ready
const ctx = {
  logger: { debug() {}, info() {}, warn() {}, error() {} },
  llm: { fileRequestText: () => '[file]' }, fiber: { entry: undefined },
  effect() {}, on() { return () => {} }, get() { return undefined }, provide() {}, inject() {},
}
const router = new Router(ctx, {
  baseURL, apiKeyEnv: keyEnv, enableDecision: true, decisionModel: 'deepseek-v4.1-flash-1017',
  decisionTimeoutMs: 20000, decisionInputMaxChars: 6000, fallbackModel: 'deepseek-v4.1-flash-1017',
  maxAttempts: 4, quotaCooldownMinutes: 30, rateLimitCooldownSeconds: 120, streamIdleTimeoutMs: 120000,
  autoSyncPool: false, poolSyncIntervalHours: 0, adoptProfileProvider: false, maxCandidatesForDecision: 14,
  includeSpecialEndpoints: false, excludeModels: [], balanceStrategy: 'balanced', balanceWindow: 6,
  balanceBand: 0, balanceWindowHours: 24, thinkingEffort: 'auto', enableMediaRouting: true,
  stickySession: false, sessionTurnLimit: 8, taskRoutes: {}, models: [], accounts: [], activeAccountId: '',
  modelLimits: {},
}, store)

const service = createService(ctx, router, store)
const result = await service.selfCheck()
console.log(`整体: ${result.ok ? '✓ 全部通过' : '✗ 有未过项'}\n`)
for (const item of result.items) {
  console.log(`  ${item.ok ? '✓' : '✗'}  ${item.name}: ${item.detail}`)
  if (item.hint) console.log(`         → ${item.hint}`)
}
console.log(`\n可对话模型: ${result.state.pool.count}`)
await store.dispose()
process.exit(result.ok ? 0 : 1)