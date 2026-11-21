/**
 * End-to-end demo + measurement for one real user request:
 *   "帮我生成一个汽车简单视频,并附上喇叭声音"
 *
 * Runs the shipped plugin (`lib/*.js`) against the live endpoint so the report
 * reflects what the router actually does — task classification, chosen model,
 * silent-fallback chain, and exact token accounting from the usage chunks.
 * Then generates the car image through the router's media path.
 *
 * Writes a machine-readable result to `.dsh-media/demo-result.json`.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const lib = name => import(pathToFileURL(join(root, 'lib', name)).href)
const { Router } = await lib('router.js')
const { RouterStore } = await lib('store.js')
const { analyzeRequest, effortFor } = await lib('decision.js')

const CREDENTIALS = 'C:\\Users\\30410\\.dsh\\.credentials.yaml'
const PATCH = 'C:\\Users\\30410\\.dsh\\profiles\\desktop\\cordis.patch.yml'
const credential = (ref) => {
  const text = readFileSync(CREDENTIALS, 'utf8')
  const match = new RegExp(`^\\s+${ref}:\\s*(\\S+)\\s*$`, 'm').exec(text)
  return match?.[1]?.replace(/^["']|["']$/g, '')
}
const block = readFileSync(PATCH, 'utf8').split(/^ {6}bailian:/m)[1] ?? ''
const baseURL = /baseURL:\s*(\S+)/.exec(block)?.[1].replace(/\/+$/, '')
const keyEnv = /apiKeyEnv:\s*(\S+)/.exec(block)?.[1]
process.env[keyEnv] = credential(keyEnv)

const WORKSPACE = process.argv[2] ?? process.cwd()
const stateDir = join(tmpdir(), `bar-demo-${Date.now()}`)
mkdirSync(stateDir, { recursive: true })
mkdirSync(join(WORKSPACE, '.dsh-media'), { recursive: true })

const ctx = {
  logger: {
    debug() {},
    info(...args) { console.log('   [router]', ...args) },
    warn(...args) { console.log('   [router:warn]', ...args) },
    error() {},
  },
  llm: { fileRequestText: () => '[file]' },
  fiber: {},
  effect() {}, on() { return () => {} },
  get(service) {
    if (service === 'workingDirectory') return { defaultDirectory: WORKSPACE }
    return undefined
  },
  provide() {}, inject() {},
}

const config = {
  baseURL, apiKeyEnv: keyEnv,
  enableDecision: true,
  decisionModel: 'deepseek-v4.1-flash-1017',
  decisionTimeoutMs: 20000,
  decisionInputMaxChars: 6000,
  fallbackModel: 'deepseek-v4.1-flash-1017',
  maxAttempts: 4,
  quotaCooldownMinutes: 30,
  rateLimitCooldownSeconds: 120,
  streamIdleTimeoutMs: 120000,
  autoSyncPool: true,
  poolSyncIntervalHours: 24,
  adoptProfileProvider: false,
  maxCandidatesForDecision: 14,
  includeSpecialEndpoints: false,
  excludeModels: [],
  balanceStrategy: 'balanced',
  balanceWindow: 6,
  balanceBand: 0,
  balanceWindowHours: 24,
  thinkingEffort: 'auto',
  enableMediaRouting: true,
  taskRoutes: { image: [], writing: [], translation: [], code: [], reasoning: [], general: [] },
  models: [],
}

const store = RouterStore.create(join(stateDir, 'state.json'))
await store.ready
const router = new Router(ctx, config, store)

console.log('== 1. 同步账号模型池 ==')
const sync = await router.syncPool(true)
console.log('   ', sync.message)
const snapshot = router.capture()
const videoModels = snapshot.pool.entries.filter(entry => /video|kling|wan-video/i.test(entry.id))
console.log(`   可对话 ${snapshot.pool.entries.length} / 图像 ${snapshot.pool.media.image.length} / 视频 ${videoModels.length} / 语音 ${snapshot.pool.media.speech.length}`)

/** Run one request through the router and collect chunks + timing. */
async function route(label, text) {
  const analysis = analyzeRequest({
    provider: 'bailian-auto', model: 'bailian-auto',
    messages: [{ role: 'user', id: 'm', content: [{ type: 'text', text }], source: { kind: 'user' } }],
  }, 6000)
  console.log(`\n== ${label} ==`)
  console.log(`   任务=${analysis.heuristicTask} 复杂度=${analysis.complexity}(${analysis.complexityLevel}) 自动档位=${effortFor(analysis, 'auto')} 媒体意图=${analysis.mediaIntent ?? '无'}`)

  const chunks = []
  const started = Date.now()
  for await (const chunk of router.stream({
    provider: 'bailian-auto', model: 'bailian-auto',
    messages: [{ role: 'user', id: 'm', content: [{ type: 'text', text }], source: { kind: 'user' } }],
  }, router.capture())) chunks.push(chunk)
  const elapsed = Date.now() - started

  const textOut = chunks.filter(chunk => chunk.type === 'text-delta').map(chunk => chunk.text).join('')
  const usage = chunks.filter(chunk => chunk.type === 'usage').at(-1)?.usage
  const record = store.state.history.at(-1)
  console.log(`   最终模型=${record?.finalModel} 来源=${record?.decisionSource} 尝试链=${(record?.attempts ?? []).map(a => `${a.model}${a.ok ? '✓' : '✗'}${a.code ?? ''}`).join(' > ')}`)
  const execTokens = usage?.totalTokens ?? ((usage?.inputTokens ?? 0) + (usage?.outputTokens ?? 0))
  console.log(`   token: 执行 输入=${usage?.inputTokens ?? 0} 输出=${usage?.outputTokens ?? 0} 小计=${execTokens} | 决策=${record?.decisionTokens ?? 0} | 合计=${execTokens + (record?.decisionTokens ?? 0)}  耗时=${elapsed}ms`)
  console.log(`   回复: ${textOut.replace(/\s+/g, ' ').slice(0, 160)}`)
  return { record, usage, text: textOut, elapsed, analysis }
}

// ---- 1) the user's actual sentence ----
const answer = await route('用户请求', '帮我生成一个汽车简单视频,并附上喇叭声音')

// ---- 2) the image the video is built from (router media path) ----
const image = await route('画面生成', '画一张红色跑车在夜色霓虹街道上,车头灯亮起,电影感')

const result = {
  at: Date.now(),
  endpoint: baseURL,
  pool: {
    chat: snapshot.pool.entries.length,
    image: snapshot.pool.media.image.length,
    video: videoModels.length,
    speech: snapshot.pool.media.speech.length,
  },
  requests: [
    {
      label: '用户请求(文本)',
      prompt: '帮我生成一个汽车简单视频,并附上喇叭声音',
      task: answer.record?.task,
      complexity: answer.analysis.complexity,
      complexityLevel: answer.analysis.complexityLevel,
      effort: effortFor(answer.analysis, 'auto'),
      model: answer.record?.finalModel,
      decisionSource: answer.record?.decisionSource,
      attempts: answer.record?.attempts ?? [],
      inputTokens: answer.usage?.inputTokens ?? 0,
      outputTokens: answer.usage?.outputTokens ?? 0,
      totalTokens: answer.usage?.totalTokens ?? 0,
      decisionTokens: answer.record?.decisionTokens ?? 0,
      elapsedMs: answer.elapsed,
      reply: answer.text.slice(0, 400),
    },
    {
      label: '画面生成(图像)',
      prompt: '画一张红色跑车在夜色霓虹街道上,车头灯亮起,电影感',
      decisionSource: image.record?.decisionSource,
      model: image.record?.finalModel,
      attempts: image.record?.attempts ?? [],
      totalTokens: image.usage?.totalTokens ?? 0,
      decisionTokens: image.record?.decisionTokens ?? 0,
      elapsedMs: image.elapsed,
      reply: image.text.slice(0, 400),
    },
  ],
}
writeFileSync(join(WORKSPACE, '.dsh-media', 'demo-result.json'), JSON.stringify(result, null, 2), 'utf8')
await store.dispose()
console.log('\n结果已写入 .dsh-media/demo-result.json')
console.log('image pool:', snapshot.pool.media.image.slice(0, 5).map(entry => entry.id).join(', '))