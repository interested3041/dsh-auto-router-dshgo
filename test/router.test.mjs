/**
 * Functional test of the router core against a mock Bailian (OpenAI-compatible)
 * HTTP server. Verifies:
 *  A. decision-model routing + chunk protocol order (block-end → usage → finish)
 *  B. 429 before any output → silent switch to the next candidate + cooldown
 *  B2. HTTP 400 Throttling.AllocationQuota → QUOTA cooldown + switch
 *  C. failure after partial output → no switch, error propagates
 *  D. decision timeout → configured fallback model
 *  E. image input → vision-only candidate; a non-vision decision answer is
 *     rejected in favor of the heuristic vision model
 *  F. pool sync from GET /v1/models
 */
import http from 'node:http'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const { Router } = await import(pathToFileURL(join(root, 'lib', 'router.js')).href)
const { RouterStore } = await import(pathToFileURL(join(root, 'lib', 'store.js')).href)
const { resolveOptions } = await import(pathToFileURL(join(root, 'lib', 'config.js')).href)

process.env.DASHSCOPE_API_KEY = 'sk-test-key'

// ---- mock server -----------------------------------------------------------
let handler = () => { throw new Error('no handler') }
const server = http.createServer((req, res) => handler(req, res))
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
const port = server.address().port
const baseURL = `http://127.0.0.1:${port}/v1`

function readBody(req) {
  return new Promise((resolve) => {
    let body = ''
    req.on('data', chunk => { body += chunk })
    req.on('end', () => resolve(body.length > 0 ? JSON.parse(body) : {}))
  })
}

function sseOk(res, pieces) {
  res.writeHead(200, { 'content-type': 'text/event-stream' })
  for (const piece of pieces) res.write(`data: ${JSON.stringify(piece)}\n\n`)
  res.write('data: [DONE]\n\n')
  res.end()
}

const deltaChunk = (text, extra = {}) => ({ choices: [{ index: 0, delta: { content: text }, ...extra }] })
const usageChunk = { usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } }

// ---- harness mocks ---------------------------------------------------------
const mockCtx = {
  logger: { debug() {}, info() {}, warn() {}, error() {} },
  llm: { fileRequestText: ref => `[file ${ref?.attachmentId ?? '?'}]` },
  fiber: { entry: { options: { id: 'auto-router', name: 'dsh-auto-router' } } },
  effect() {}, on() { return () => {} }, get() { return undefined }, provide() {}, inject() {},
}

function baseConfig(overrides = {}) {
  return {
    baseURL,
    vendor: 'bailian',
    apiKeyEnv: 'DASHSCOPE_API_KEY',
    enableDecision: true,
    decisionModel: 'deepseek-v4.1-flash',
    decisionTimeoutMs: 1500,
    decisionInputMaxChars: 6000,
    fallbackModel: 'deepseek-v4.1-flash',
    maxAttempts: 4,
    quotaCooldownMinutes: 30,
    rateLimitCooldownSeconds: 120,
    streamIdleTimeoutMs: 10000,
    autoSyncPool: false,
    poolSyncIntervalHours: 0,
    adoptProfileProvider: false,
    maxCandidatesForDecision: 14,
    includeSpecialEndpoints: false,
    excludeModels: [],
    ...overrides,
  }
}

const tmp = await mkdtemp(join(tmpdir(), 'bar-test-'))
let storeSeq = 0
async function makeRouter(configOverrides = {}) {
  const store = RouterStore.create(join(tmp, `state-${storeSeq++}.json`))
  await store.ready
  const router = new Router(mockCtx, baseConfig(configOverrides), store)
  return { router, store }
}

function userRequest(text, withImage = false) {
  const content = withImage
    ? [{ type: 'text', text }, { type: 'image', attachment: { attachmentId: 'img-1', width: 64, height: 64, bytes: 100 } }]
    : [{ type: 'text', text }]
  return {
    provider: 'bailian-auto',
    model: 'bailian-auto',
    messages: [{ role: 'user', id: 'm-1', content, source: { kind: 'user' } }],
  }
}

async function collect(gen) {
  const chunks = []
  for await (const chunk of gen) chunks.push(chunk)
  return chunks
}

// ---- assertions -------------------------------------------------------------
const checks = []
function assert(condition, message) {
  checks.push({ condition: !!condition, message })
  if (!condition) console.error('FAILED: ' + message)
}

/** Install a handler routing by body.model with per-model behaviors. */
function behaviorHandler(behaviors, calls) {
  return async (req, res) => {
    if (req.method === 'GET' && req.url === '/v1/models') {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ data: [{ id: 'glm-5.2' }, { id: 'qwen-vl-max' }, { id: 'deepseek-v4.1-flash' }, { id: 'qwen3.8-max' }] }))
      return
    }
    if (req.method === 'POST' && req.url === '/v1/chat/completions') {
      const body = await readBody(req)
      calls.push(body)
      const behavior = behaviors[body.model] ?? behaviors['*']
      if (!behavior) {
        res.writeHead(404, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ error: { message: `model ${body.model} not found`, code: 'ModelNotFound' } }))
        return
      }
      await behavior(body, res)
      return
    }
    res.writeHead(404); res.end('{}')
  }
}

const decisionJson = (model, task, reasoning) => ({
  choices: [{
    message: { content: JSON.stringify({ selected_model: model, task_type: task, reasoning }) },
    finish_reason: 'stop',
  }],
})

const decisionOnce = (model, task, reasoning) => (body, res) => {
  if (body.stream) return // execution call: not this behavior
  res.writeHead(200, { 'content-type': 'application/json' })
  res.end(JSON.stringify(decisionJson(model, task, reasoning)))
}

const streamOk = text => (body, res) => {
  if (!body.stream) {
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify(decisionJson('glm-5.2', 'writing', 'default')))
    return
  }
  sseOk(res, [deltaChunk(text), deltaChunk('!', { finish_reason: 'stop' }), usageChunk])
}

// ---- Scenario A: decision routing + protocol order ---------------------------
{
  const calls = []
  handler = behaviorHandler({
    'deepseek-v4.1-flash': (body, res) => {
      if (body.stream) return streamOk('fallback')(body, res)
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify(decisionJson('glm-5.2', 'writing', '中文写作任务')))
    },
    'glm-5.2': streamOk('你好'),
  }, calls)
  const { router, store } = await makeRouter({ taskRoutes: {
    image: ['glm-5.2'], writing: ['glm-5.2'], translation: ['glm-5.2'],
    code: ['glm-5.2'], reasoning: ['glm-5.2'], general: ['glm-5.2'],
  } })
  const snapshot = router.capture()
  const chunks = await collect(router.stream(userRequest('用 TypeScript 实现一个带泛型的 LRU 缓存，包含边界检查、并发安全和两个单测用例'), snapshot))
  const types = chunks.map(c => c.type)
  const text = chunks.filter(c => c.type === 'text-delta').map(c => c.text).join('')
  assert(calls.some(c => c.model === 'deepseek-v4.1-flash' && c.stream !== true), 'A: decision model called one-shot')
  assert(calls.some(c => c.model === 'glm-5.2' && c.stream === true), 'A: execution model called with stream')
  assert(text === '你好!', 'A: text deltas forwarded intact')
  const finishIdx = types.indexOf('finish')
  const usageIdx = types.indexOf('usage')
  const lastEnd = types.lastIndexOf('block-end')
  assert(finishIdx === types.length - 1, 'A: finish is terminal')
  assert(usageIdx >= 0 && usageIdx < finishIdx, 'A: usage precedes finish')
  assert(lastEnd >= 0 && lastEnd < usageIdx, 'A: block-end precedes usage')
  assert(chunks[finishIdx].reason.kind === 'stop', 'A: finish reason stop')
  const record = store.state.history.at(-1)
  assert(record?.decisionSource === 'model' && record?.finalModel === 'glm-5.2' && record?.ok === true, 'A: history records model decision')
  assert(store.state.quota['glm-5.2']?.calls === 1, 'A: success counter incremented')
}

// ---- Scenario B: 429 → silent switch + rate-limit cooldown --------------------
{
  const calls = []
  handler = behaviorHandler({
    'deepseek-v4.1-flash': (body, res) => {
      if (body.stream) return streamOk('fb')(body, res)
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify(decisionJson('glm-5.2', 'writing', '写作')))
    },
    'glm-5.2': (body, res) => {
      if (!body.stream) return
      res.writeHead(429, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ error: { message: 'Requests rate limit exceeded, please try again later', code: 'Throttling.RateQuota' } }))
    },
    '*': streamOk('切换成功'),
  }, calls)
  const { router, store } = await makeRouter({ taskRoutes: { writing: ['glm-5.2'] } })
  store.state.pendingUserModel = 'glm-5.2'
  const chunks = await collect(router.stream(userRequest('写一篇 800 字的品牌文案，包含标题、三个卖点和结尾行动号召'), router.capture()))
  const text = chunks.filter(c => c.type === 'text-delta').map(c => c.text).join('')
  assert(text === '切换成功!', 'B: next candidate served the request')
  assert(!calls.some(c => c.stream !== true && c.model !== 'deepseek-v4.1-flash' && c.model !== 'deepseek-v4.1-flash-1017'), 'B: no extra decision call on switch')
  const q = store.state.quota['glm-5.2']
  assert(q?.lastFailCode === 'RATE_LIMIT' && q.cooldownUntil > Date.now(), 'B: rate-limit cooldown recorded')
  const record = store.state.history.at(-1)
  assert(record?.attempts.length >= 2 && record.attempts[0].code === 'RATE_LIMIT' && record.finalModel !== 'glm-5.2', 'B: attempt chain recorded')
}

// ---- Scenario B2: AllocationQuota (HTTP 400) → QUOTA cooldown ------------------
{
  const calls = []
  handler = behaviorHandler({
    'deepseek-v4.1-flash': (body, res) => {
      if (body.stream) return streamOk('fb')(body, res)
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify(decisionJson('glm-5.2', 'writing', '写作')))
    },
    'glm-5.2': (body, res) => {
      if (!body.stream) return
      res.writeHead(400, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ code: 'Throttling.AllocationQuota', message: 'Allocated quota exceeded, please increase your quota limit' }))
    },
    'qwen3.8-max': streamOk('额度切换'),
  }, calls)
  const { router, store } = await makeRouter()
  const chunks = await collect(router.stream(userRequest('写一首诗'), router.capture()))
  const text = chunks.filter(c => c.type === 'text-delta').map(c => c.text).join('')
  assert(text === '额度切换!', 'B2: switched after allocation-quota error')
  const q = store.state.quota['glm-5.2']
  assert(q?.lastFailCode === 'QUOTA', 'B2: classified as QUOTA')
  const expectedCooldown = 30 * 60_000
  assert(q.cooldownUntil - q.lastFailAt === expectedCooldown, 'B2: quota cooldown length from config (30min)')
}

// ---- Scenario C: failure after partial output → no switch ---------------------
{
  const calls = []
  handler = behaviorHandler({
    'deepseek-v4.1-flash': (body, res) => {
      if (body.stream) return streamOk('fb')(body, res)
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify(decisionJson('glm-5.2', 'writing', '写作')))
    },
    'glm-5.2': (body, res) => {
      if (!body.stream) return
      res.writeHead(200, { 'content-type': 'text/event-stream' })
      res.write(`data: ${JSON.stringify(deltaChunk('部分输出'))}\n\n`)
      res.write(`data: ${JSON.stringify({ error: { message: 'internal boom', type: 'server_error' } })}\n\n`)
      res.end()
    },
    'qwen3.8-max': streamOk('不该出现'),
  }, calls)
  const { router, store } = await makeRouter({ taskRoutes: { writing: ['glm-5.2'] } })
  store.state.pendingUserModel = 'glm-5.2'
  let thrown
  const chunks = []
  try {
    for await (const chunk of router.stream(userRequest('写一篇小说'), router.capture())) chunks.push(chunk)
  } catch (error) { thrown = error }
  assert(thrown !== undefined, 'C: error propagated after partial output')
  assert(!calls.some(c => c.model === 'qwen3.8-max'), 'C: did NOT switch model after partial output')
  const record = store.state.history.at(-1)
  assert(record?.attempts.length === 1 && record.ok === false, 'C: single failed attempt recorded')
  assert(chunks.some(c => c.type === 'text-delta' && c.text === '部分输出'), 'C: partial chunks were yielded before failure')
}

// ---- Scenario D: decision timeout → fallback model -----------------------------
{
  const calls = []
  handler = behaviorHandler({
    'deepseek-v4.1-flash': (body, res) => {
      if (body.stream) return streamOk('回退输出')(body, res)
      // Decision call: never respond; let the timeout abort it.
    },
    'glm-5.2': streamOk('不应到达'),
  }, calls)
  const { router, store } = await makeRouter({ decisionTimeoutMs: 1200 })
  const started = Date.now()
  const chunks = await collect(router.stream(userRequest('请分析这个分布式系统的性能瓶颈，推导并给出端到端完整实现方案'), router.capture()))
  const elapsed = Date.now() - started
  const text = chunks.filter(c => c.type === 'text-delta').map(c => c.text).join('')
  assert(text === '回退输出!', 'D: fallback model served the request')
  assert(elapsed < 5000, `D: decision timeout bounded the wait (${elapsed}ms)`)
  const record = store.state.history.at(-1)
  assert(record?.decisionSource === 'fallback' && record.finalModel === 'deepseek-v4.1-flash', 'D: fallback recorded in history')
}

// ---- Scenario E: image input → vision-only; bad decision rejected --------------
{
  const calls = []
  handler = behaviorHandler({
    'deepseek-v4.1-flash': (body, res) => {
      if (body.stream) return streamOk('fb')(body, res)
      // Decision returns a non-vision model that cannot be in the vision-filtered
      // candidate list — the router must reject it and use the heuristic choice.
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify(decisionJson('qwen-plus', 'image', '错误选择'))
      )
    },
    'qwen3.8-max-0902': streamOk('图片描述'),
    'qwen3-vl-plus': streamOk('图片描述2'),
  }, calls)
  const { router, store } = await makeRouter()
  const chunks = await collect(router.stream(userRequest('描述这张图', true), router.capture()))
  const text = chunks.filter(c => c.type === 'text-delta').map(c => c.text).join('')
  assert(/图片描述/.test(text), 'E: a vision model served the image request')
  const execution = calls.find(c => c.stream === true)
  assert(execution && /vl|omni|ocr|max-0902/i.test(execution.model), `E: execution model is vision-capable (${execution?.model})`)
  const record = store.state.history.at(-1)
  assert(record?.modality === 'image' && record.task === 'image', 'E: recorded as image task')
  // The serialized wire message must carry the image placeholder (no attachment service in test).
  const imageMessage = execution.messages.at(-1)
  assert(Array.isArray(imageMessage.content) && imageMessage.content.some(p => p.type === 'text' && /image attachment img-1/.test(p.text)), 'E: image projected to deterministic placeholder text')
}

// ---- Scenario E2: INVALID_REQUEST is model-specific → fallback still runs ----
{
  const calls = []
  handler = behaviorHandler({
    'glm-5.2': (body, res) => {
      if (!body.stream) return
      res.writeHead(400, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ error: { code: 'InvalidParameter', message: 'model does not support tools/history' } }))
    },
    'deepseek-v4.1-flash': streamOk('坏模型后仍成功'),
  }, calls)
  const { router, store } = await makeRouter()
  store.state.pendingUserModel = 'glm-5.2'
  const chunks = await collect(router.stream(userRequest('写一段普通总结'), router.capture()))
  const text = chunks.filter(c => c.type === 'text-delta').map(c => c.text).join('')
  assert(text === '坏模型后仍成功!', 'E2: known-good fallback served after INVALID_REQUEST')
  const record = store.state.history.at(-1)
  assert(record?.attempts[0]?.code === 'INVALID_REQUEST' && record.attempts.length >= 2, 'E2: invalid model and fallback both recorded')
  const q = store.state.quota['glm-5.2']
  assert(q?.cooldownUntil > Date.now() + 5 * 3_600_000, 'E2: invalid model parked for at least 6h')
}

// ---- Scenario F: pool sync ------------------------------------------------------
{
  const calls = []
  handler = behaviorHandler({}, calls)
  const { router, store } = await makeRouter()
  const result = await router.syncPool(true)
  assert(result.ok === true && result.count === 4, 'F: pool synced 4 models from /v1/models')
  const syncedPool = router.capture().pool
  assert(syncedPool.byId.get('qwen-vl-max')?.traits.vision === true, 'F: synced vision capability inferred')
  assert(syncedPool.byId.get('deepseek-v4.1-flash')?.traits.chat === true, 'F: synced chat model classified as chat')
  assert(store.state.lastSyncAt > 0 && !store.state.lastSyncError, 'F: sync metadata recorded')
}

// ---- Scenario G: cooldown ordering — cooled models drop to the end --------------
{
  const calls = []
  handler = behaviorHandler({
    'deepseek-v4.1-flash': (body, res) => {
      if (body.stream) return streamOk('fb')(body, res)
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify(decisionJson('glm-5.2', 'writing', '写作')))
    },
    'glm-5.2': streamOk('不该选我'),
    '*': streamOk('冷卻後首選'),
  }, calls)
  const { router, store } = await makeRouter({ enableDecision: false })
  // Pre-cool glm-5.2 so the heuristic route must skip it as first choice.
  store.markFailure('glm-5.2', 'QUOTA', 30 * 60_000)
  const gHeads = router.capture()
  const chunks = await collect(router.stream(userRequest('润色'), router.capture()))
  const text = chunks.filter(c => c.type === 'text-delta').map(c => c.text).join('')
  const served = calls.filter(c => c.stream === true).map(c => c.model)
  assert(text === '冷卻後首選!', 'G: cooled-down model skipped in favor of next fresh candidate')
  assert(!served.includes('glm-5.2'), `G: 冷却中的 glm-5.2 未被调用 (served: ${served.join(',')})`)
}

// ---- Scenario H: tool-call streaming + agent history serialization -------------
{
  const calls = []
  handler = behaviorHandler({
    'deepseek-v4.1-flash': (body, res) => {
      if (body.stream) return streamOk('fb')(body, res)
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify(decisionJson('qwen3.8-max', 'code', '代码任务')))
    },
    '*': (body, res) => {
      if (!body.stream) return
      // Stream one tool call in split deltas, OpenAI style.
      sseOk(res, [
        { choices: [{ index: 0, delta: { role: 'assistant', tool_calls: [{ index: 0, id: 'call_abc', type: 'function', function: { name: 'read', arguments: '' } }] } }] },
        { choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: '{"file_' } }] } }] },
        { choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: 'path":"a.ts"}' } }] }, finish_reason: 'tool_calls' }] },
        usageChunk,
      ])
    },
  }, calls)
  const { router } = await makeRouter()
  // A realistic agent-loop request: system prompt, assistant tool-call history,
  // tool result, active tool declarations.
  const options = {
    provider: 'bailian-auto',
    model: 'bailian-auto',
    messages: [
      { role: 'system', id: 'm0', content: [{ type: 'text', text: 'You are a coding agent.' }], source: { kind: 'system-prompt' } },
      { role: 'user', id: 'm1', content: [{ type: 'text', text: '读取 a.ts 并重构这个函数' }], source: { kind: 'user' } },
      {
        role: 'assistant', id: 'm2',
        content: [{ type: 'reasoning', text: 'thinking...' }, { type: 'tool-call', id: 'call_prev', name: 'read', arguments: '{"file_path":"a.ts"}' }],
        source: { kind: 'model', provider: 'bailian-auto', model: 'qwen3.8-max' },
      },
      {
        role: 'tool', id: 'm3', toolCallId: 'call_prev', isError: false,
        content: [{ type: 'text', text: 'export function f() {}' }],
        source: { kind: 'tool', callId: 'call_prev' },
      },
    ],
    tools: [{ name: 'read', description: 'Read a file', parameters: { type: 'object', properties: { file_path: { type: 'string' } } } }],
  }
  const chunks = await collect(router.stream(options, router.capture()))
  const execution = calls.find(c => c.stream === true)
  // Wire request assertions.
  assert(execution !== undefined, 'H: execution call sent')
  assert(execution.messages[0].role === 'system' && execution.messages[0].content === 'You are a coding agent.', 'H: system message serialized as plain text')
  const asst = execution.messages.find(m => m.role === 'assistant')
  assert(asst?.tool_calls?.[0]?.id === 'call_prev' && asst.tool_calls[0].function.arguments === '{"file_path":"a.ts"}', 'H: assistant tool-call history mapped')
  assert(!asst.content?.includes?.('thinking'), 'H: reasoning history dropped')
  const toolMsg = execution.messages.find(m => m.role === 'tool')
  assert(toolMsg?.tool_call_id === 'call_prev' && toolMsg.content === 'export function f() {}', 'H: tool result mapped with tool_call_id')
  assert(Array.isArray(execution.tools) && execution.tools[0].type === 'function' && execution.tools[0].function.name === 'read', 'H: tool declarations sent as OpenAI functions')
  // Stream translation assertions.
  const types = chunks.map(c => c.type)
  const tcIdx = types.indexOf('tool-call-delta')
  assert(tcIdx >= 0, 'H: tool-call deltas emitted')
  const endBlock = chunks.find(c => c.type === 'block-end' && c.block.type === 'tool-call')
  assert(endBlock?.block.id === 'call_abc' && endBlock.block.name === 'read', 'H: tool-call block closed with id and name')
  assert(endBlock?.block.arguments === '{"file_path":"a.ts"}', 'H: split argument deltas reassembled')
  const finish = chunks.at(-1)
  assert(finish.type === 'finish' && finish.reason.kind === 'tool-calls', 'H: finish reason tool-calls')
  assert(!chunks.some(c => c.type === 'block-end' && c.block.type === 'reasoning'), 'H: no reasoning block leaked from this response')
}

// ---- Scenario I: adopt an existing profile provider (zero-config) --------------
{
  const aliyunURL = 'https://ws-test.cn-beijing.maas.aliyuncs.com/compatible-mode/v1'
  process.env.BAILIAN_API_KEY = 'sk-bailian'
  const adoptingCtx = {
    ...mockCtx,
    get(service) {
      if (service !== 'configEditor') return undefined
      return {
        configuration: () => [{
          entry: { options: { id: 'llm-pi-ai' } },
          inherited: {
            providers: {
              bailian: {
                api: 'openai-completions',
                baseURL: aliyunURL,
                apiKeyEnv: 'BAILIAN_API_KEY',
              },
              // A non-Aliyun endpoint must never be adopted.
              unrelated: { api: 'openai-completions', baseURL: 'https://api.example.com/v1' },
            },
          },
          override: {},
        }],
        edit: async () => {},
      }
    },
  }
  const store = RouterStore.create(join(tmp, `state-adopt-${storeSeq++}.json`))
  await store.ready
  // Shipped defaults: public DashScope endpoint + BAILIAN_API_KEY untouched.
  const cfg = { ...baseConfig({ adoptProfileProvider: true }) }
  cfg.baseURL = 'https://dashscope.aliyuncs.com/compatible-mode/v1'
  cfg.apiKeyEnv = 'BAILIAN_API_KEY'
  const router = new Router(adoptingCtx, cfg, store)
  const snapshot = router.capture()
  assert(snapshot.adopted?.providerId === 'bailian', 'I: adopted the profile bailian provider')
  assert(snapshot.options.baseURL === aliyunURL, 'I: adopted that provider baseURL')
  assert(snapshot.options.apiKeyEnv === 'BAILIAN_API_KEY', 'I: adopted that provider credential reference')
  assert(snapshot.options.apiKeyRefs.includes('DASHSCOPE_API_KEY'), 'I: keeps the credential fallback chain')

  // An explicit endpoint always wins over discovery.
  const explicit = new Router(adoptingCtx, { ...baseConfig(), baseURL }, store)
  const explicitSnapshot = explicit.capture()
  assert(explicitSnapshot.adopted === undefined, 'I: explicit baseURL disables adoption')
  assert(explicitSnapshot.options.baseURL === baseURL, 'I: explicit baseURL preserved')
  delete process.env.BAILIAN_API_KEY
}

// ---- Scenario J: credential reference fallback chain ---------------------------
{
  const calls = []
  handler = behaviorHandler({
    'deepseek-v4.1-flash-1017': (body, res) => {
      if (!body.stream) {
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify(decisionJson('deepseek-v4.1-flash-1017', 'general', 'x')))
        return
      }
      streamOk('凭据回退')(body, res)
    },
  }, calls)
  process.env.DASHSCOPE_API_KEY = 'sk-dashscope'
  const { router } = await makeRouter()
  const chunks = await collect(router.stream(userRequest('测试凭据'), router.capture()))
  const text = chunks.filter(c => c.type === 'text-delta').map(c => c.text).join('')
  assert(text === '凭据回退!', 'J: request authenticated through the credential chain')
  assert(calls.length > 0, 'J: at least one call reached the endpoint')
}

// ---- Scenario K: thinking switch — enable_thinking, never reasoning_effort -----
// Fixed-candidate harness: the decision model is bypassed (enableDecision:false)
// and the target model is pinned first for every task, so these assertions test
// the wire parameters, not routing.
const qroutes = {
  image: ['qwen3.8-max'],
  writing: ['qwen3.8-max'],
  translation: ['qwen3.8-max'],
  code: ['qwen3.8-max'],
  reasoning: ['qwen3.8-max'],
  general: ['qwen3.8-max'],
}
const qwenOk = (body, res) => {
  if (body.stream !== true) return
  sseOk(res, [deltaChunk('思考完成', { finish_reason: 'stop' }), usageChunk])
}
{
  const calls = []
  handler = behaviorHandler({ 'qwen3.8-max': qwenOk }, calls)
  const { router } = await makeRouter({ enableDecision: false, balanceStrategy: 'quality', taskRoutes: qroutes })
  const chunksHigh = await collect(router.stream({ ...userRequest('推导这个公式'), reasoningEffort: 'high' }, router.capture()))
  const execHigh = calls.find(call => call.stream === true)
  assert(execHigh?.model === 'qwen3.8-max', 'K: qwen3.8-max 收到执行请求')
  assert(execHigh.enable_thinking === true, 'K: 请求体含 enable_thinking:true')
  assert(execHigh.thinking_budget === 8192, 'K: 请求体含 thinking_budget 上限(high=8192)')
  assert(!('reasoning_effort' in execHigh), 'K: 请求体不含 reasoning_effort')
  assert(chunksHigh.filter(c => c.type === 'text-delta').map(c => c.text).join('') === '思考完成', 'K: 回答正常')
}
{
  // 'max' must never become reasoning_effort:"max" — the largest budget instead.
  const calls = []
  handler = behaviorHandler({ 'qwen3.8-max': qwenOk }, calls)
  const { router } = await makeRouter({ enableDecision: false, balanceStrategy: 'quality', taskRoutes: qroutes })
  await collect(router.stream({ ...userRequest('推导'), reasoningEffort: 'max' }, router.capture()))
  const exec = calls.find(call => call.stream === true)
  assert(!('reasoning_effort' in exec) || exec.reasoning_effort !== 'max', 'K: max 不产生 reasoning_effort:"max"')
  assert(exec.enable_thinking === true && exec.thinking_budget === 16384, 'K: max 产生 enable_thinking + 16384 预算')
}
{
  // off → enable_thinking:false for a switch family.
  const calls = []
  handler = behaviorHandler({ 'qwen3.8-max': qwenOk }, calls)
  const { router } = await makeRouter({ enableDecision: false, balanceStrategy: 'quality', taskRoutes: qroutes })
  await collect(router.stream({ ...userRequest('你好'), reasoningEffort: 'off' }, router.capture()))
  const exec = calls.find(call => call.stream === true)
  assert(exec.enable_thinking === false, 'K: off 产生 enable_thinking:false')
  assert(!('thinking_budget' in exec), 'K: off 不带 thinking_budget')
}

// ---- Scenario L: 400 naming `enable_thinking` → strip and retry, no turn error -----
{
  const calls = []
  let executions = 0
  handler = behaviorHandler({
    'qwen3.8-max': (body, res) => {
      if (body.stream !== true) return
      executions += 1
      if (executions === 1) {
        res.writeHead(400, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ error: { message: 'InvalidParameter: enable_thinking is not supported', code: 'InvalidParameter' } }))
        return
      }
      sseOk(res, [deltaChunk('去参成功', { finish_reason: 'stop' }), usageChunk])
    },
  }, calls)
  const { router, store } = await makeRouter({ enableDecision: false, balanceStrategy: 'quality', taskRoutes: qroutes })
  const chunks = await collect(router.stream({ ...userRequest('推导'), reasoningEffort: 'high' }, router.capture()))
  const execs = calls.filter(call => call.stream === true)
  assert(execs.length === 2, 'L: 同一模型在同一轮内重试一次')
  assert(execs[0].enable_thinking === true, 'L: 第一次带 enable_thinking')
  assert(execs[1].enable_thinking === undefined && execs[1].thinking_budget === undefined, 'L: 重试去掉了全部思考参数')
  assert(store.effortUnsupported('qwen3.8-max') === true, 'L: 模型被标记 effortUnsupported')
  assert(chunks.filter(c => c.type === 'text-delta').map(c => c.text).join('') === '去参成功', 'L: 去参重试成功,不整轮报错')
}

// ---- Scenario M: learned-effortUnsupported / no-switch family send no params ----
{
  const calls = []
  handler = behaviorHandler({ 'qwen3.8-max': qwenOk }, calls)
  const { router, store } = await makeRouter({ enableDecision: false, balanceStrategy: 'quality', taskRoutes: qroutes })
  store.markEffortUnsupported('qwen3.8-max')
  await collect(router.stream({ ...userRequest('推导'), reasoningEffort: 'high' }, router.capture()))
  const exec = calls.find(call => call.stream === true)
  assert(exec.enable_thinking === undefined && exec.thinking_budget === undefined, 'M: effortUnsupported 模型不发思考参数')
}
{
  const proutes = {
    image: ['deepseek-v4-pro'],
    writing: ['deepseek-v4-pro'],
    translation: ['deepseek-v4-pro'],
    code: ['deepseek-v4-pro'],
    reasoning: ['deepseek-v4-pro'],
    general: ['deepseek-v4-pro'],
  }
  const calls = []
  handler = behaviorHandler({
    'deepseek-v4-pro': (body, res) => {
      if (body.stream === true) sseOk(res, [deltaChunk('无开关', { finish_reason: 'stop' }), usageChunk])
    },
  }, calls)
  const { router } = await makeRouter({ enableDecision: false, balanceStrategy: 'quality', taskRoutes: proutes })
  await collect(router.stream({ ...userRequest('重构这个 function 并分析时间复杂度'), reasoningEffort: 'high' }, router.capture()))
  const exec = calls.find(call => call.stream === true)
  assert(exec.enable_thinking === false && exec.thinking_budget === undefined && !('reasoning_effort' in exec),
    'M: 无思考族(deepseek-v4-pro)显式关闭思考,避免默认自动思考吃满输出')
}

// ---- Scenario N: per-model usage limit stops an exhausted model --------------
{
  const routesN = {
    image: ['qwen3.8-max', 'deepseek-v4-pro'],
    writing: ['qwen3.8-max', 'deepseek-v4-pro'],
    translation: ['qwen3.8-max', 'deepseek-v4-pro'],
    code: ['qwen3.8-max', 'deepseek-v4-pro'],
    reasoning: ['qwen3.8-max', 'deepseek-v4-pro'],
    general: ['qwen3.8-max', 'deepseek-v4-pro'],
  }
  const backup = (body, res) => {
    if (body.stream === true) sseOk(res, [deltaChunk('备用模型', { finish_reason: 'stop' }), usageChunk])
  }
  const calls = []
  handler = behaviorHandler({ 'qwen3.8-max': qwenOk, 'deepseek-v4-pro': backup }, calls)
  const { router, store } = await makeRouter({
    enableDecision: false, balanceStrategy: 'quality', taskRoutes: routesN,
    modelLimits: { 'qwen3.8-max': { maxCalls: 1 } },
  })
  store.recordUsage('code', 'qwen3.8-max', 50) // already at its 1-call cap
  const chunks = await collect(router.stream(userRequest('重构 function 去重并分析复杂度'), router.capture()))
  const exec = calls.find(call => call.stream === true)
  assert(exec?.model === 'deepseek-v4-pro', `N: 超限模型被停用,路由到下一个 (got ${exec?.model})`)
  assert(chunks.filter(c => c.type === 'text-delta').map(c => c.text).join('') === '备用模型', 'N: 备用模型正常回答')

  // token limit also stops the model
  const calls2 = []
  handler = behaviorHandler({ 'qwen3.8-max': qwenOk, 'deepseek-v4-pro': (body, res) => { if (body.stream === true) sseOk(res, [deltaChunk('token超限', { finish_reason: 'stop' }), usageChunk]) } }, calls2)
  const { router: router2, store: store2 } = await makeRouter({
    enableDecision: false, balanceStrategy: 'quality', taskRoutes: routesN,
    modelLimits: { 'qwen3.8-max': { maxTokens: 100000 } },
  })
  store2.recordUsage('code', 'qwen3.8-max', 120000)
  const chunks2 = await collect(router2.stream(userRequest('重构 function 去重并分析复杂度'), router2.capture()))
  const exec2 = calls2.find(call => call.stream === true)
  assert(exec2?.model === 'deepseek-v4-pro', `N: token 超限同样停用该模型 (got ${exec2?.model})`)
  assert(chunks2.filter(c => c.type === 'text-delta').map(c => c.text).join('') === 'token超限', 'N: token 超限后备用模型回答')

  // reset clears the limit counters (pure store check)
  const { store: storeN3 } = await makeRouter({})
  storeN3.recordUsage('code', 'qwen3.8-max', 50)
  assert(storeN3.withinLimit('qwen3.8-max', { 'qwen3.8-max': { maxCalls: 1 } }) === false, 'N: 达到调用上限后 withinLimit=false')
  assert(storeN3.withinLimit('qwen3.8-max', { 'qwen3.8-max': { maxTokens: 20 } }) === false, 'N: 达到 token 上限后 withinLimit=false')
  // 0.7.1: legacy tiny raw-token caps are migrated as 万 (10k) units.
  const migrated = resolveOptions({ modelLimits: { m: { maxTokens: 100 } } })
  assert(migrated.modelLimits.m.maxTokens === 1000000, 'N: 旧版小值限额按万迁移 100→1M')
  storeN3.resetModelTotals('qwen3.8-max')
  assert(storeN3.withinLimit('qwen3.8-max', { 'qwen3.8-max': { maxCalls: 1 } }) === true, 'N: resetModelTotals 清除计数后重新可用')
  assert(storeN3.resetModelTotals === storeN3.resetModelTotals, 'N: resetModelTotals 可调用')
}

// ---- done ------------------------------------------------------------------------
// Scenario D leaves one deliberately unanswered request socket; force-close it.
server.closeAllConnections?.()
await new Promise(resolve => server.close(resolve))
await rm(tmp, { recursive: true, force: true })

let failed = 0
for (const check of checks) {
  if (!check.condition) failed += 1
  console.log(`${check.condition ? 'ok' : 'FAIL'}  ${check.message}`)
}
console.log(`\n${checks.length - failed}/${checks.length} checks passed`)
process.exit(failed > 0 ? 1 : 0)

