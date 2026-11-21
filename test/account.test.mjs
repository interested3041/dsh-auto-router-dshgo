/**
 * Account-switch behaviour: a different Aliyun account (other endpoint and/or
 * credential reference) must work without editing task routes, and without the
 * previous account's model list or cooldowns leaking into it.
 */
import http from 'node:http'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const lib = name => import(pathToFileURL(join(root, 'lib', name)).href)
const { Router } = await lib('router.js')
const { RouterStore } = await lib('store.js')

process.env.BAILIAN_API_KEY = 'sk-account-b'

// Two endpoints standing in for two accounts, each with its own catalogue.
const catalogues = {
  a: ['glm-5.2', 'deepseek-v4.1-flash-1017', 'qwen3-vl-plus', 'qwen3-tts-flash'],
  b: ['sensenova-7b-chat', 'wanx-lite-plus', 'kimi-k3.1-pro', 'sensenova-vl-2', 'text-embedding-9'],
}

let currentAccount = 'a'
const requests = []

const server = http.createServer(async (req, res) => {
  const body = await new Promise(resolve => {
    let raw = ''
    req.on('data', chunk => { raw += chunk })
    req.on('end', () => resolve(raw.length > 0 ? JSON.parse(raw) : {}))
  })
  requests.push({ url: req.url, model: body.model })
  if (req.url === '/a/v1/models' || req.url === '/b/v1/models') {
    const key = req.url.slice(1, 2)
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ data: catalogues[key].map(id => ({ id, object: 'model' })) }))
    return
  }
  if (req.url?.endsWith('/chat/completions')) {
    const isDecision = body.stream !== true
    if (isDecision) {
      // The decision model answers with the first candidate it was shown.
      const shown = String(body.messages?.[1]?.content ?? '')
      const first = /- ([^\s(]+)/.exec(shown)?.[1] ?? body.model
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({
        choices: [{ message: { content: JSON.stringify({ selected_model: first, task_type: 'general', reasoning: 'account test' }) } }],
      }))
      return
    }
    res.writeHead(200, { 'content-type': 'text/event-stream' })
    res.write(`data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: `来自${body.model}` }, finish_reason: 'stop' }] })}\n\n`)
    res.write(`data: ${JSON.stringify({ usage: { prompt_tokens: 5, completion_tokens: 3, total_tokens: 8 } })}\n\n`)
    res.write('data: [DONE]\n\n')
    res.end()
    return
  }
  res.writeHead(404)
  res.end('{}')
})
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
const port = server.address().port
const endpoint = account => `http://127.0.0.1:${port}/${account}/v1`

const ctx = {
  logger: { debug() {}, info() {}, warn() {}, error() {} },
  llm: { fileRequestText: () => '[file]' },
  fiber: {},
  effect() {}, on() { return () => {} }, get() { return undefined }, provide() {}, inject() {},
}

function configFor(baseURL) {
  return {
    baseURL,
    apiKeyEnv: 'BAILIAN_API_KEY',
    enableDecision: true,
    decisionModel: 'deepseek-v4.1-flash-1017',
    decisionTimeoutMs: 5000,
    decisionInputMaxChars: 4000,
    // Deliberately a model the second account does not serve.
    fallbackModel: 'deepseek-v4.1-flash-1017',
    maxAttempts: 4,
    quotaCooldownMinutes: 30,
    rateLimitCooldownSeconds: 120,
    streamIdleTimeoutMs: 10000,
    autoSyncPool: false,
    poolSyncIntervalHours: 0,
    adoptProfileProvider: false,
    maxCandidatesForDecision: 10,
    includeSpecialEndpoints: false,
    excludeModels: [],
    taskRoutes: { image: [], writing: [], translation: [], code: [], reasoning: [], general: [] },
    models: [],
  }
}

const results = []
const check = (ok, message) => {
  results.push(Boolean(ok))
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${message}`)
}

const tmp = await mkdtemp(join(tmpdir(), 'bar-account-'))
const store = RouterStore.create(join(tmp, 'state.json'))
await store.ready

// ---- Account A ----
const configA = configFor(endpoint('a'))
const routerA = new Router(ctx, configA, store)
await routerA.syncPool(true)
const snapA = routerA.capture()
check(snapA.pool.total === 4, `账号A 目录: ${snapA.pool.total} 个`)
check(snapA.derived === undefined, '账号A 提供配置模型,不做替代')
check(snapA.pool.entries.some(entry => entry.id === 'glm-5.2'), '账号A 有 glm-5.2')
check(!snapA.pool.entries.some(entry => entry.id === 'qwen3-tts-flash'), '账号A 的 TTS 被排除')

// Put a model into cooldown to prove the cooldown does not leak to account B.
store.markFailure('glm-5.2', 'QUOTA', 30 * 60_000)
check(store.inCooldown('glm-5.2'), '账号A 的 glm-5.2 处于冷却')

// ---- Switch to account B (different endpoint) ----
const configB = configFor(endpoint('b'))
const routerB = new Router(ctx, configB, store)
const snapB = routerB.capture()

check(store.state.scope === `${endpoint('b')}|BAILIAN_API_KEY`, '作用域已切换到账号B')
check(store.state.pool.length === 0, '切换账号后旧模型池已清空')
check(!store.inCooldown('glm-5.2'), '旧账号的冷却状态已清除')
check(snapB.pool.total > 0, '账号B 未同步时用内置目录兜底')

// Sync account B's own catalogue.
await routerB.syncPool(true)
const snapB2 = routerB.capture()
check(snapB2.pool.entries.some(entry => entry.id === 'sensenova-7b-chat'), '账号B 的新模型可路由')
check(!snapB2.pool.entries.some(entry => entry.id === 'glm-5.2'), '账号B 不再包含账号A 的模型')
check(!snapB2.pool.entries.some(entry => entry.id === 'text-embedding-9'), '账号B 的 embedding 被排除')
check(snapB2.pool.entries.some(entry => entry.id === 'sensenova-vl-2'), '账号B 的视觉模型可路由')
check(snapB2.derived?.decisionModel === true, '配置的决策模型不在账号B → 标记为已替代')
check(snapB2.options.decisionModel !== 'deepseek-v4.1-flash-1017',
  `决策模型已自动替代为 ${snapB2.options.decisionModel}`)
check(snapB2.pool.byId.has(snapB2.options.decisionModel), '替代后的决策模型确实存在于账号B')
check(snapB2.derived?.fallbackModel === true, '配置的回退模型不在账号B → 标记为已替代')
check(snapB2.pool.byId.has(snapB2.options.fallbackModel), '替代后的回退模型确实存在于账号B')

// A real request on account B must work with zero config edits.
const chunks = []
for await (const chunk of routerB.stream({
  provider: 'bailian-auto',
  model: 'bailian-auto',
  messages: [{ role: 'user', id: 'm1', content: [{ type: 'text', text: '你好' }], source: { kind: 'user' } }],
}, snapB2)) chunks.push(chunk)
const answer = chunks.filter(chunk => chunk.type === 'text-delta').map(chunk => chunk.text).join('')
const record = store.state.history.at(-1)
check(answer.length > 0, `账号B 请求成功: ${answer}`)
check(record?.ok === true, '账号B 路由记录成功')
check(!record?.attempts.some(attempt => attempt.model === 'deepseek-v4.1-flash-1017'),
  '账号B 从未尝试它不存在的模型')
check(requests.every(request => !String(request.model).startsWith('deepseek-v4.1-flash-1017')),
  '发往账号B的请求全部使用其真实存在的模型')

// ---- Image request on account B picks its vision model ----
const imageChunks = []
for await (const chunk of routerB.stream({
  provider: 'bailian-auto',
  model: 'bailian-auto',
  messages: [{
    role: 'user', id: 'm2',
    content: [{ type: 'text', text: '这张图里是什么' }, { type: 'image', attachment: { attachmentId: 'img-9', width: 32, height: 32, bytes: 64 } }],
    source: { kind: 'user' },
  }],
}, routerB.capture())) imageChunks.push(chunk)
const imageRecord = store.state.history.at(-1)
check(imageRecord?.modality === 'image', '图片请求被识别为图片任务')
check(snapB2.pool.byId.get(imageRecord.finalModel)?.traits.vision === true,
  `图片请求落在账号B 的视觉模型: ${imageRecord.finalModel}`)

await new Promise(resolve => server.close(resolve))
await store.dispose()
await rm(tmp, { recursive: true, force: true })

const failed = results.filter(ok => !ok).length
console.log(`\n${results.length - failed}/${results.length} checks passed`)
process.exit(failed === 0 ? 0 : 1)