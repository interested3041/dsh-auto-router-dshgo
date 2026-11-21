/**
 * Live end-to-end verification against the REAL Bailian endpoint, using this
 * machine's own credential and endpoint. Exercises the shipped build
 * (`lib/*.js`) exactly as the Host would: adapter metadata → decision model →
 * routing → streaming execution → quota bookkeeping.
 *
 * The API key and workspace endpoint are read from the profile's credential
 * file / plugin config; neither is printed.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'
import { mkdtemp, rm } from 'node:fs/promises'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const lib = name => import(pathToFileURL(join(root, 'lib', name)).href)
const { Router } = await lib('router.js')
const { rankForTask } = await lib('pool.js')
const { BUILTIN_CATALOG } = await lib('catalog.js')
const { RouterStore } = await lib('store.js')
const { BailianAutoAdapter } = await lib('adapter.js')

const CREDENTIALS = 'C:\\Users\\30410\\.dsh\\.credentials.yaml'
const PROFILE_PATCH = 'C:\\Users\\30410\\.dsh\\profiles\\desktop\\cordis.patch.yml'

/** Pull one inline credential value without echoing it. */
function credential(ref) {
  const text = readFileSync(CREDENTIALS, 'utf8')
  const match = new RegExp(`^\\s+${ref}:\\s*(\\S+)\\s*$`, 'm').exec(text)
  if (!match) throw new Error(`credential ${ref} not found`)
  return match[1].replace(/^["']|["']$/g, '')
}

/** Read the profile's bailian provider endpoint from its YAML patch. */
function bailianEndpoint() {
  const text = readFileSync(PROFILE_PATCH, 'utf8')
  const block = text.split(/^ {6}bailian:/m)[1] ?? ''
  const url = /baseURL:\s*(\S+)/.exec(block)?.[1]
  const keyEnv = /apiKeyEnv:\s*(\S+)/.exec(block)?.[1]
  return { baseURL: url, apiKeyEnv: keyEnv }
}

const { baseURL, apiKeyEnv } = bailianEndpoint()
console.log('endpoint   :', baseURL)
console.log('credential :', apiKeyEnv, `(${credential(apiKeyEnv).slice(0, 3)}…)`)
// The Host resolves this through the credentials service; this standalone
// verification process has no Cordis context, so hand it to the env fallback.
process.env[apiKeyEnv] = credential(apiKeyEnv)

const results = []
const check = (ok, message) => {
  results.push({ ok: Boolean(ok), message })
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${message}`)
}

/** Cordis-like host context: no credentials service (env fallback), no editor. */
const ctx = {
  logger: { debug() {}, info(...args) { console.log('   [host]', ...args) }, warn(...args) { console.log('   [warn]', ...args) }, error() {} },
  llm: { fileRequestText: ref => `[file ${ref?.attachmentId ?? '?'}]` },
  fiber: {},
  effect() {}, on() { return () => {} }, get() { return undefined }, provide() {}, inject() {},
}

const config = {
  baseURL,
  apiKeyEnv,
  enableDecision: true,
  decisionModel: 'deepseek-v4.1-flash-1017',
  decisionTimeoutMs: 20000,
  decisionInputMaxChars: 4000,
  fallbackModel: 'deepseek-v4.1-flash-1017',
  maxAttempts: 4,
  quotaCooldownMinutes: 30,
  rateLimitCooldownSeconds: 120,
  streamIdleTimeoutMs: 60000,
  autoSyncPool: true,
  poolSyncIntervalHours: 24,
  adoptProfileProvider: false,
  taskRoutes: {
    image: ['qwen3.8-max-0902', 'qwen3-vl-plus', 'qwen3.8-omni-flash'],
    writing: ['glm-5.2', 'qwen3.8-max-0902'],
    translation: ['qwen-mt-plus', 'qwen3.8-max-0902'],
    code: ['deepseek-v4-pro', 'qwen3.8-max-0902'],
    reasoning: ['deepseek-v4-pro', 'qwen3.8-max-0902'],
    general: ['deepseek-v4.1-flash-1017', 'qwen3.8-flash'],
  },
  models: [],
}

const tmp = await mkdtemp(join(tmpdir(), 'bar-live-'))
const store = RouterStore.create(join(tmp, 'state.json'))
await store.ready
const router = new Router(ctx, config, store)
const adapter = new BailianAutoAdapter(router)

// 1. The virtual model is advertised to the model selector.
const models = await adapter.listModels('bailian-auto')
const virtual = models.find(model => model.id === 'bailian-auto')
check(virtual !== undefined, `虚拟模型已注册到选择器: ${virtual?.name}`)
check(virtual?.inputModalities?.includes('image'), '虚拟模型声明 text+image 模态')
const info = await adapter.resolveModel('bailian-auto', 'bailian-auto')
check((info.context?.contextWindow ?? 0) > 0, `虚拟模型上下文窗口: ${info.context?.contextWindow}`)

// 2. Pool sync from the real endpoint.
const sync = await router.syncPool(true)
check(sync.ok, `池同步: ${sync.message}`)
const poolIds = store.state.pool.map(entry => entry.id)
const decisionInPool = poolIds.includes('deepseek-v4.1-flash-1017')
check(decisionInPool, `决策模型 ${'deepseek-v4.1-flash-1017'} 在真实模型列表中`)
for (const id of ['glm-5.2', 'qwen3.8-max-0902', 'deepseek-v4-pro', 'qwen-vl-ocr']) {
  check(poolIds.includes(id), `候选模型存在于端点: ${id}`)
}

// 2b. Pool composition: how much of the account's own catalogue is routable.
const snapshot = router.capture()
const catalogIds = new Set(BUILTIN_CATALOG.map(entry => entry.id))
const notInCatalog = snapshot.pool.entries.filter(entry => !catalogIds.has(entry.id))
const vision = snapshot.pool.entries.filter(entry => entry.traits.vision)
console.log('\n=== 模型池构成 ===')
console.log(`   账号可获取 : ${snapshot.pool.total}`)
console.log(`   可对话     : ${snapshot.pool.entries.length}`)
console.log(`   可读图片   : ${vision.length}`)
console.log(`   已排除非对话: ${snapshot.pool.excluded.length}`)
console.log(`   不在内置目录(完全来自你的账号): ${notInCatalog.length}`)
console.log('   排除示例   :', snapshot.pool.excluded.slice(0, 6).map(entry => `${entry.id}(${entry.reason})`).join(', '))
console.log(`   媒体端点   : 图像 ${snapshot.pool.media.image.length} 个 (${snapshot.pool.media.image.slice(0, 3).map(entry => entry.id).join(', ')}); 语音 ${snapshot.pool.media.speech.length}; 识别 ${snapshot.pool.media.asr.length}`)
check(snapshot.pool.media.image.length > 0, `图像生成模型 ${snapshot.pool.media.image.length} 个可直接路由`)
check(snapshot.pool.entries.length > 100, `可路由模型数量: ${snapshot.pool.entries.length} 个`)
check(notInCatalog.length > 40, `其中 ${notInCatalog.length} 个来自账号、不在内置目录`)
check(vision.length >= 5, `可读图片模型 ${vision.length} 个`)
check(snapshot.pool.excluded.length > 10, `已排除 ${snapshot.pool.excluded.length} 个非对话端点`)

for (const task of ['writing', 'code', 'reasoning', 'translation', 'general']) {
  const ranked = rankForTask(task, snapshot.pool, snapshot.options)
  console.log(`   排序[${task}]:`, ranked.slice(0, 5).join(' > '))
  check(ranked.length > 20, `${task} 候选充足: ${ranked.length}`)
}

/** Run one request through the full router. */
async function route(label, text, { withImage = false } = {}) {
  const content = withImage
    ? [{ type: 'text', text }]
    : [{ type: 'text', text }]
  const options = {
    provider: 'bailian-auto',
    model: 'bailian-auto',
    messages: [{ role: 'user', id: 'm1', content, source: { kind: 'user' } }],
  }
  const chunks = []
  const started = Date.now()
  for await (const chunk of adapter.stream(options)) chunks.push(chunk)
  const answer = chunks.filter(c => c.type === 'text-delta').map(c => c.text).join('')
  const finish = chunks.at(-1)
  const record = store.state.history.at(-1)
  console.log(`\n=== ${label} ===`)
  console.log('   task     :', record?.task, '| source:', record?.decisionSource, '| final:', record?.finalModel)
  console.log('   attempts :', record?.attempts.map(a => `${a.model}${a.ok ? '✓' : `✗${a.code}`}`).join(' -> '))
  console.log('   reasoning:', record?.reasoning)
  console.log('   answer   :', answer.replace(/\s+/g, ' ').slice(0, 120))
  console.log('   latency  :', Date.now() - started, 'ms')
  check(answer.trim().length > 0, `${label}: 收到非空回答 (${answer.trim().length} 字)`)
  check(finish?.type === 'finish', `${label}: 流以 finish 块结束`)
  check(chunks.some(c => c.type === 'usage'), `${label}: 收到 usage 计费块`)
  check(record?.ok === true, `${label}: 路由记录成功`)
  return { record, answer }
}

// 3. Chinese writing → expect a writing-tier model.
await route('中文写作', '请帮我写一段 80 字左右的咖啡店开业文案,语气温暖。')

// 4. Code → expect deepseek/qwen tier.
await route('代码任务', '用 JavaScript 写一个函数:输入数组,返回去掉重复元素后的新数组,并说明时间复杂度。')

// 5. Simple chat → expect general/fast tier.
await route('通用对话', '你好,请用一句话介绍你自己。')

// 5b. Load balancing: three identical code requests should not all use one model.
const balanced = []
for (let index = 0; index < 3; index += 1) {
  const result = await route(`均衡测试 #${index + 1}`, '用 JavaScript 写一个函数判断回文,并说明复杂度。')
  balanced.push(result.record?.finalModel)
}
console.log('   均衡序列   :', balanced.join(' → '))
check(new Set(balanced).size >= 2, `同一任务在 ${new Set(balanced).size} 个模型间轮转`)
check(!balanced.every(id => id === balanced[0]), '没有单一模型垄断该任务')

// 6. Report the quota bookkeeping the status panel reads.
const quota = Object.entries(store.state.quota)
console.log('\n=== 本地额度状态 (面板数据) ===')
for (const [model, state] of quota) {
  console.log(`   ${model}: calls=${state.calls} fails=${state.fails} cooldown=${state.cooldownUntil ? 'yes' : 'no'}`)
}
check(quota.length > 0, '额度状态已记录')

await store.dispose()
await rm(tmp, { recursive: true, force: true })

const failed = results.filter(result => !result.ok)
console.log(`\n${results.length - failed.length}/${results.length} live checks passed`)
process.exit(failed.length === 0 ? 0 : 1)