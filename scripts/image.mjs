/** Route one image-generation prompt through the plugin's media path. */
import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const lib = name => import(pathToFileURL(join(root, 'lib', name)).href)
const { Router } = await lib('router.js')
const { RouterStore } = await lib('store.js')

const CREDENTIALS = 'C:\\Users\\30410\\.dsh\\.credentials.yaml'
const PATCH = 'C:\\Users\\30410\\.dsh\\profiles\\desktop\\cordis.patch.yml'
const credential = (ref) => {
  const text = readFileSync(CREDENTIALS, 'utf8')
  return new RegExp(`^\\s+${ref}:\\s*(\\S+)\\s*$`, 'm').exec(text)?.[1]?.replace(/^["']|["']$/g, '')
}
const block = readFileSync(PATCH, 'utf8').split(/^ {6}bailian:/m)[1] ?? ''
const baseURL = /baseURL:\s*(\S+)/.exec(block)?.[1].replace(/\/+$/, '')
const keyEnv = /apiKeyEnv:\s*(\S+)/.exec(block)?.[1]
process.env[keyEnv] = credential(keyEnv)

const WORKSPACE = process.argv[2]
const prompt = process.argv[3]
const store = RouterStore.create(join(tmpdir(), `img-${Date.now()}.json`))
await store.ready
const ctx = {
  logger: { debug() {}, info() {}, warn() {}, error() {} },
  llm: { fileRequestText: () => '' }, fiber: {},
  effect() {}, on() { return () => {} },
  get: service => (service === 'workingDirectory' ? { defaultDirectory: WORKSPACE } : undefined),
  provide() {}, inject() {},
}
const router = new Router(ctx, {
  baseURL, apiKeyEnv: keyEnv, enableDecision: true, decisionModel: 'deepseek-v4.1-flash-1017',
  decisionTimeoutMs: 20000, decisionInputMaxChars: 6000, fallbackModel: 'deepseek-v4.1-flash-1017',
  maxAttempts: 4, quotaCooldownMinutes: 30, rateLimitCooldownSeconds: 120, streamIdleTimeoutMs: 120000,
  autoSyncPool: true, poolSyncIntervalHours: 24, adoptProfileProvider: false, maxCandidatesForDecision: 14,
  includeSpecialEndpoints: false, excludeModels: [], balanceStrategy: 'balanced', balanceWindow: 6,
  balanceBand: 0, balanceWindowHours: 24, thinkingEffort: 'auto', enableMediaRouting: true,
  taskRoutes: { image: [], writing: [], translation: [], code: [], reasoning: [], general: [] }, models: [],
}, store)
await router.syncPool(true)

const chunks = []
for await (const chunk of router.stream({
  provider: 'bailian-auto', model: 'bailian-auto',
  messages: [{ role: 'user', id: 'm', content: [{ type: 'text', text: prompt }], source: { kind: 'user' } }],
}, router.capture())) chunks.push(chunk)
console.log(chunks.filter(c => c.type === 'text-delta').map(c => c.text).join(''))
console.log('model:', store.state.history.at(-1)?.finalModel)
await store.dispose()