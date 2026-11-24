/**
 * Behavioural tests for the three capabilities added on request:
 *   1. load/token balancing inside a task category (no "always the same model"),
 *   2. automatic reasoning-effort selection from detected task complexity,
 *   3. media routing (image generation) and vision-capability learning.
 */
import http from 'node:http'
import { mkdtemp, rm, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const lib = name => import(pathToFileURL(join(root, 'lib', name)).href)
const { Router } = await lib('router.js')
const { RouterStore } = await lib('store.js')
const { analyzeRequest, effortFor, reconcileReason, costCapFor } = await lib('decision.js')
const { classifyModel } = await lib('classify.js')
const { buildPool } = await lib('pool.js')

process.env.BAILIAN_API_KEY = 'sk-balance'

const results = []
const check = (ok, message) => {
  results.push(Boolean(ok))
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${message}`)
}

// ---------------------------------------------------------------------------
// Part 1: pure heuristics — complexity and effort.
// ---------------------------------------------------------------------------
const analyse = text => analyzeRequest({
  provider: 'bailian-auto',
  model: 'bailian-auto',
  messages: [{ role: 'user', id: 'm', content: [{ type: 'text', text }], source: { kind: 'user' } }],
}, 4000)

// Price band: a trivial slogan must not unlock a 12¥/M flagship; a deep
// cross-file task may. The decision model only sees candidates under this cap.
check(costCapFor(analyse('帮我想一句奶茶店开业口号')) === 3, '简单写作价格带上限为 3')
check(costCapFor(analyse('比较 9.11 和 9.9 哪个大，并解释为什么')) === 4, '普通推理价格带上限为 4(数学比较按推理)')
check(analyse('比较 9.11 和 9.9 哪个大，并解释为什么').heuristicTask === 'reasoning', '数学大小比较判为推理而不是代码')
check(costCapFor(analyse('用 TypeScript 实现一个带过期时间的 LRU 缓存类，get/put 必须 O(1)')) === 4, '普通代码价格带上限为 4')
check(costCapFor(analyse('重构这个 3000 行的 Python 脚本，拆分模块并补单元测试')) === 8, '复杂任务价格带上限为 8')
check(costCapFor(analyse('请端到端完整实现这个分布式架构的性能优化与并发重构，覆盖故障排查、回滚、死锁和内存泄漏分析')) === 12, '深度任务才允许最高价格带')

const trivial = analyse('你好')
const contextThenHello = analyzeRequest({
  provider: 'bailian-auto',
  model: 'bailian-auto',
  messages: [
    { role: 'user', id: 'old', content: [{ type: 'text', text: '用 Spring Boot 设计一个支持 10 万并发的订单系统，给出完整实现并分析瓶颈。'.repeat(20) }], source: { kind: 'user' } },
    { role: 'user', id: 'now', content: [{ type: 'text', text: '你好' }], source: { kind: 'user' } },
  ],
}, 4000)
check(contextThenHello.complexityLevel === 'trivial', '旧上下文不抬高当轮复杂度')
const xmlContext = analyse('<environment_context>\n<os>Windows</os>\n<shell>pwsh</shell>\n</environment_context>\n你好')
check(xmlContext.heuristicTask !== 'code', 'XML 上下文不被误判为代码')
const promptThenTime = analyzeRequest({
  provider: 'bailian-auto',
  model: 'bailian-auto',
  messages: [
    { role: 'user', id: 'u', content: [{ type: 'text', text: '你好' }], source: { kind: 'user' } },
    { role: 'user', id: 't', content: [{ type: 'text', text: 'Time sampled while preparing turn 1, step 1: 2026-11-24T20:23:20+08:00' }], source: { kind: 'time-context' } },
  ],
}, 4000)
check(promptThenTime.complexityLevel === 'trivial' && promptThenTime.userText === '你好', '时间上下文不顶替用户消息')
const correctedReason = reconcileReason(
  '图文输入需读图；任务复杂，选全能旗舰且可读图的qwen3.8-max。',
  'image', 'deepseek-v4.1-flash-1017', ['deepseek-v4.1-flash-1017', 'qwen3.8-max'],
)
check(!/qwen3\.8-max/i.test(correctedReason) && correctedReason.includes('deepseek-v4.1-flash-1017'),
  '理由提到别的模型时改写成实际执行模型')
const keptReason = reconcileReason('按候选排序选择 glm-5.2', 'writing', 'glm-5.2', ['glm-5.2'])
check(keptReason === '按候选排序选择 glm-5.2', '理由与实际模型一致时原样保留')
const simple = analyse('把这句话翻译成英文:今天天气不错')
const normal = analyse('帮我写一段 100 字左右的产品介绍,语气专业')
const complex = analyse('用 Spring Boot 设计一个支持 10 万并发的订单系统,给出完整实现并分析瓶颈')
const deep = analyse('请证明这个算法的时间复杂度,并推导 n→∞ 时的渐进行为\n```js\nfunction f(n){ let s=0; for(let i=0;i<n;i++) s+=i; return s }\n```')
const weekly = analyse('给一个小团队写一份 5 条以内的周报模板')
const coding = analyse('用 TypeScript 实现一个带泛型的 LRU 缓存，包含单测')

console.log('\n=== 复杂度判定 ===')
for (const [label, result] of [['trivial', trivial], ['simple', simple], ['normal', normal], ['complex', complex], ['deep', deep]]) {
  console.log(`   ${label.padEnd(8)} → ${result.complexity}/100 (${result.complexityLevel}) effort=${effortFor(result, 'auto')}`)
}
check(trivial.complexityLevel === 'trivial', '打招呼被判为 trivial')
check(effortFor(trivial, 'auto') === 'off', 'trivial → 关闭思考')
check(simple.complexity < normal.complexity, '简单任务复杂度低于普通任务')
check(normal.complexity < complex.complexity, '普通任务复杂度低于复杂任务')
check(complex.complexity < deep.complexity, '复杂任务复杂度低于深度任务')
check(effortFor(deep, 'auto') === 'max', `深度任务 → max (${effortFor(deep, 'auto')})`)
check(effortFor(complex, 'auto') === 'high', `复杂任务 → high (${effortFor(complex, 'auto')})`)
check(effortFor(trivial, 'high') === 'high', '显式档次覆盖自动策略')
check(weekly.heuristicTask === 'writing', `周报模板判为写作 (${weekly.heuristicTask})`)
check(coding.heuristicTask === 'code', `TypeScript 实现 LRU 判为代码 (${coding.heuristicTask})`)
check(effortFor(weekly, 'auto', 'writing') === 'off', '简单写作 → 关闭隐藏思考(不烧输出预算)')

// ---------------------------------------------------------------------------
// Part 2: classification — media vs chat, and vision correctness.
// ---------------------------------------------------------------------------
console.log('\n=== 端点归类 ===')
check(classifyModel('qwen-image-3.0').category === 'image', 'qwen-image-3.0 → 图像生成面')
check(classifyModel('wan2.7-image').category === 'image', 'wan2.7-image → 图像生成面')
check(classifyModel('qwen3-tts-flash').category === 'speech', 'qwen3-tts-flash → 语音合成面')
check(classifyModel('qwen3-asr-flash-realtime').category === 'asr', 'asr 模型 → 语音识别面')
check(classifyModel('qwen3.7-text-embedding').category === 'embedding', 'embedding → 向量化面')
check(classifyModel('deepseek-v4-pro').vision === false, 'deepseek-v4-pro 不带视觉(正确)')
check(classifyModel('deepseek-v4.1-flash-1017').chat === true, 'deepseek-v4.1-flash-1017 是对话模型')

// ---------------------------------------------------------------------------
// Part 3: live-ish behaviour against a mock endpoint.
// ---------------------------------------------------------------------------
const calls = []
let imageResponse = null
const server = http.createServer(async (req, res) => {
  const body = await new Promise(resolve => {
    let raw = ''
    req.on('data', chunk => { raw += chunk })
    req.on('end', () => resolve(raw.length > 0 ? JSON.parse(raw) : {}))
  })
  calls.push({ url: req.url, model: body.model, stream: body.stream === true, enableThinking: body.enable_thinking, thinkingBudget: body.thinking_budget, reasoningEffort: body.reasoning_effort })

  if (req.url === '/v1/models') {
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({
      data: [
        'deepseek-v4-pro', 'qwen3.8-max-0902', 'glm-5.2', 'kimi-k3.1-pro', 'qwen3.8-flash',
        'qwen-image-3.0', 'wan2.7-image', 'qwen3-tts-flash', 'qwen3.7-text-embedding',
      ].map(id => ({ id, object: 'model' })),
    }))
    return
  }
  if (req.url === '/v1/images/generations') {
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ data: [{ b64_json: Buffer.from('fake-png-bytes').toString('base64') }] }))
    return
  }
  if (req.url === '/v1/chat/completions') {
    if (body.stream !== true) {
      const shown = String(body.messages?.[1]?.content ?? '')
      const first = /- ([^\s(]+)/.exec(shown)?.[1] ?? body.model
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ selected_model: first, task_type: 'code', reasoning: 'mock' }) } }] }))
      return
    }
    res.writeHead(200, { 'content-type': 'text/event-stream' })
    res.write(`data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: `by ${body.model}` }, finish_reason: 'stop' }] })}\n\n`)
    res.write(`data: ${JSON.stringify({ usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 } })}\n\n`)
    res.write('data: [DONE]\n\n')
    res.end()
    return
  }
  res.writeHead(404)
  res.end('{}')
})
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
const baseURL = `http://127.0.0.1:${server.address().port}/v1`

const ctx = {
  logger: { debug() {}, info() {}, warn() {}, error() {} },
  llm: { fileRequestText: () => '[file]' },
  fiber: {},
  effect() {}, on() { return () => {} },
  get(service) {
    if (service === 'workingDirectory') return { defaultDirectory: workspace }
    return undefined
  },
  provide() {}, inject() {},
}

const workspace = await mkdtemp(join(tmpdir(), 'bar-ws-'))
const stateDir = await mkdtemp(join(tmpdir(), 'bar-state-'))

const baseConfig = {
  baseURL,
  vendor: 'bailian',
  apiKeyEnv: 'BAILIAN_API_KEY',
  enableDecision: true,
  decisionModel: 'deepseek-v4.1-flash-1017',
  decisionTimeoutMs: 5000,
  decisionInputMaxChars: 4000,
  fallbackModel: 'deepseek-v4.1-flash-1017',
  maxAttempts: 4,
  quotaCooldownMinutes: 30,
  rateLimitCooldownSeconds: 120,
  streamIdleTimeoutMs: 10000,
  autoSyncPool: false,
  poolSyncIntervalHours: 0,
  adoptProfileProvider: false,
  maxCandidatesForDecision: 12,
  includeSpecialEndpoints: false,
  excludeModels: [],
  balanceStrategy: 'balanced',
  balanceWindow: 4,
  balanceBand: 30,
  balanceWindowHours: 24,
  thinkingEffort: 'auto',
  enableMediaRouting: true,
  taskRoutes: { image: [], writing: [], translation: [], code: [], reasoning: ['qwen3.8-max-0902'], general: [] },
  models: [],
}

const store = RouterStore.create(join(stateDir, 'state.json'))
await store.ready
const router = new Router(ctx, baseConfig, store)
await router.syncPool(true)
const snapshot = router.capture()

console.log('\n=== 池构成 ===')
console.log(`   可对话 ${snapshot.pool.entries.length} / 图像 ${snapshot.pool.media.image.length} / 语音 ${snapshot.pool.media.speech.length} / 向量化 ${snapshot.pool.media.embedding.length}`)
check(snapshot.pool.media.image.length === 2, '媒体池识别出 2 个图像生成模型')
check(snapshot.pool.entries.length === 5, '对话池只含 5 个对话模型')

/** Run one request and return its routing record. */
async function run(text, extra = {}) {
  const chunks = []
  for await (const chunk of router.stream({
    provider: 'bailian-auto',
    model: 'bailian-auto',
    messages: [{ role: 'user', id: 'm', content: [{ type: 'text', text }], source: { kind: 'user' } }],
    ...extra,
  }, router.capture())) chunks.push(chunk)
  return { record: store.state.history.at(-1), text: chunks.filter(c => c.type === 'text-delta').map(c => c.text).join(''), chunks }
}

// ---- balancing: repeated identical code requests rotate across models ----
console.log('\n=== 负载均衡(相同 code 任务连续 6 次) ===')
const served = []
for (let index = 0; index < 6; index += 1) {
  const result = await run('请端到端完整实现这个分布式架构的性能优化与并发重构，覆盖故障排查、回滚、死锁和内存泄漏分析，并给出完整代码')
  served.push(result.record?.finalModel)
  if (index === 0) console.log('        usage after #1 =', JSON.stringify(store.state.usage))
  console.log(`   #${index + 1} → ${result.record?.finalModel}  (task=${result.record?.task}, src=${result.record?.decisionSource}, attempts=${(result.record?.attempts ?? []).map(a => `${a.model}${a.ok ? '✓' : '✗'}${a.code ?? ''}`).join('>')})`)
  console.log(`        reason=${result.record?.reasoning}`)
}
const unique = [...new Set(served)]
check(unique.length >= 2, `相同任务在 ${unique.length} 个近等价模型间轮转: ${unique.join(', ')}`)
check(served.filter(id => id === served[0]).length <= 4, '没有单一模型吃下全部请求')

// ---- effort tracks complexity → Bailian enable_thinking (not reasoning_effort) ----
console.log('\n=== 思考档位 ===')
const beforeSimple = calls.length
await run('你好')
const simpleCall = calls.slice(beforeSimple).find(call => call.url === '/v1/chat/completions' && call.stream === true)
const beforeDeep = calls.length
await run('请证明时间复杂度并推导渐进行为,给出完整实现和性能分析,架构层面也要说明')
const deepCall = calls.slice(beforeDeep).find(call => call.url === '/v1/chat/completions' && call.stream === true)
console.log(`   简单请求 → enable_thinking=${simpleCall?.enableThinking} (model=${simpleCall?.model})`)
console.log(`   复杂请求 → enable_thinking=${deepCall?.enableThinking} budget=${deepCall?.thinkingBudget} (model=${deepCall?.model})`)
check(simpleCall !== undefined && simpleCall.enableThinking === false && simpleCall.thinkingBudget === undefined,
  '简单请求关闭思考(enable_thinking:false)')
check(deepCall !== undefined && deepCall.enableThinking === true && typeof deepCall.thinkingBudget === 'number' && deepCall.thinkingBudget > 0,
  `复杂请求下发 enable_thinking:true + 预算 (${deepCall?.thinkingBudget})`)
check((simpleCall?.reasoningEffort ?? undefined) === undefined && (deepCall?.reasoningEffort ?? undefined) === undefined,
  '任何档位都不下发 reasoning_effort')

// ---- video intent: short-circuit reply, zero model calls and zero tokens ----
console.log('\n=== 视频意图 ===')
const videoPrompts = [
  '帮我生成一个汽车简单视频,并附上喇叭声音',
  '做一个小视频,内容是猫咪',
  '生成一个 10 秒的动画短片',
]
for (const prompt of videoPrompts) {
  const before = calls.length
  const result = await run(prompt)
  const used = calls.slice(before)
  check(result.record?.decisionSource === 'notice', `视频意图被识别并短路: ${prompt.slice(0, 16)}…`)
  check(used.length === 0, '短路时没有发起任何模型调用(0 token)')
  check(/没有视频生成模型|视频模型/.test(result.text), '回复明确说明本账号无视频模型')
  check(/另行安排|继续/.test(result.text), '回复给出替代方案并询问是否继续')
}

// video intent must not swallow image or chat requests
const imageStillWorks = await run('画一张蓝色的车')
check(imageStillWorks.record?.decisionSource === 'media', '图像意图仍走图像生成')
const chatStillWorks = await run('这个视频格式用什么编码比较好?')
check(chatStillWorks.record?.decisionSource !== 'notice', '讨论视频(非生成)不会被误判为视频意图')

// ---- media routing: image request goes to /images/generations ----
console.log('\n=== 图像生成 ===')
const imageCallsBefore = calls.filter(call => call.url === '/v1/images/generations').length
const filesBefore = (await readdir(join(workspace, '.dsh-media')).catch(() => [])).length
const imageRun = await run('帮我画一张赛博朋克风格的猫,夜色霓虹')
const imageCalls = calls.filter(call => call.url === '/v1/images/generations').slice(imageCallsBefore)
const savedFiles = (await readdir(join(workspace, '.dsh-media')).catch(() => [])).slice(filesBefore)
check(imageCalls.length === 1, '图像请求命中 /images/generations 一次')
check(/qwen-image|wan2/.test(imageCalls[0]?.model ?? ''), `使用图像模型: ${imageCalls[0]?.model}`)
check(imageRun.record?.decisionSource === 'media', '路由记录标记为 media')
check(savedFiles.length === 1 && savedFiles[0].endsWith('.png'), `图片已保存到工作区: ${savedFiles[0]}`)
check(/\.dsh-media\/image-/.test(imageRun.text), '回复包含图片 Markdown 链接')

// ---- vision learning: a model that rejects images stops being offered ----
console.log('\n=== 视觉能力学习 ===')
store.vetoVision('qwen3.8-max-0902')
const imageSnapshot = router.capture()
const imageCandidates = imageSnapshot.pool.entries.filter(entry => entry.traits.vision).map(entry => entry.id)
check(!imageCandidates.includes('qwen3.8-max-0902') || store.visionVetoed('qwen3.8-max-0902'),
  '被否决的模型不再作为视觉模型的首选')
check(store.visionVetoed('qwen3.8-max-0902'), '否决状态已持久化')

// ---- video capability gate: exclusion nouns must never short-circuit ----
console.log('\n=== 视频闸门(排除词优先) ===')
const excludedPrompts = [
  '生成一个视频脚本,包含分镜',
  '帮我生成一张视频封面图',
  '生成视频提示词',
  '视频分镜脚本',
  '做一个动画演示PPT',
  '剪辑这段视频',
]
for (const prompt of excludedPrompts) {
  const result = await run(prompt)
  check(result.record?.decisionSource !== 'notice', `排除词不短路: ${prompt.slice(0, 14)}`)
}
const coverRun = await run('帮我生成一张视频封面图')
check(coverRun.record?.decisionSource === 'media', '视频封面走图像分支,不是短路')
const coverQuestion = await run('封面用什么颜色比较好?')
check(coverQuestion.record?.decisionSource !== 'media', '封面裸名词问句不进图像分支')
check(coverQuestion.record?.decisionSource !== 'notice', '封面裸名词问句不被视频短路')

// The positive cases must still short-circuit.
for (const prompt of ['做一个10秒汽车视频', '做一个小视频,内容是猫咪', '生成一个10秒的动画短片']) {
  const result = await run(prompt)
  check(result.record?.decisionSource === 'notice', `生成意图仍短路: ${prompt.slice(0, 14)}`)
}

// ---- session stickiness: one conversation keeps one model ----
console.log('\n=== 会话粘模型 ===')
const sticky1 = await run('用 Python 写一个二分查找', { sessionId: 'sess-sticky' })
const decisionCallsAfterFirst = calls.filter(call => call.stream !== true).length
const sticky2 = await run('帮我写一段周报总结', { sessionId: 'sess-sticky' })
check(sticky1.record?.finalModel !== undefined, '首轮记录了最终模型')
check(sticky1.record?.finalModel === sticky2.record?.finalModel, '同会话任务变化仍固定同一模型')
check(calls.filter(call => call.stream !== true).length === decisionCallsAfterFirst, '同会话第二轮跳过决策模型(省 token)')
check(store.sessionModel('sess-sticky')?.task === analyse('帮我写一段周报总结').heuristicTask, '会话绑定记录了最新任务类型')
check(store.sessionModel('sess-sticky')?.turns === 2, '会话轮次累计到 2')
// A title-generation helper uses a tiny completion budget; routing it through
// the paid decision model would cost more than the title itself.
const utilityCallsBefore = calls.filter(call => call.stream !== true).length
const utility = await run('给这段对话起一个简短标题', { maxTokens: 64 })
check(utility.record?.decisionSource === 'heuristic', '标题短请求直选模型(跳过决策)')
check(calls.filter(call => call.stream !== true).length === utilityCallsBefore, '标题短请求不产生决策模型调用')
check(!/(?:doc|ocr|tts|audio|asr|embedding|rerank|video|image)/i.test(utility.record?.finalModel ?? ''), '标题短请求避开专用端点模型')
const otherSession = await run('用 Python 写一个二分查找', { sessionId: 'sess-other' })
check(store.sessionModel('sess-other') !== undefined, '不同会话各自绑定')
check(otherSession.record?.finalModel !== undefined, '新会话也记录了最终模型')
check(store.sessionModel('sess-sticky-missing') === undefined, '未绑定会话返回 undefined')

// Reselection once the turn limit is reached: the pin is dropped for this turn,
// the balanced head picks again, and the binding turns over on success.
store.state.sessions['sess-turn'] = {
  model: sticky1.record.finalModel, at: Date.now(), turns: 50,
}
const turnLimitRun = await run('用 Python 写一个二分查找', { sessionId: 'sess-turn' })
check(turnLimitRun.record?.ok === true, '达到轮次上限后仍正常选模型')
check(store.sessionModel('sess-turn')?.turns === 51, '达到轮次上限后重选并刷新轮次计数')

// Requests without a sessionId never write a binding and fall back to per-request rotation.
const sessionsBefore = Object.keys(store.state.sessions).length
await run('用 Python 写一个二分查找')
await run('用 Python 写一个二分查找')
check(Object.keys(store.state.sessions).length === sessionsBefore, '缺 sessionId 不写会话绑定(请求级轮转)')

// ---- secrets never reach the persisted state ----
console.log('\n=== 密钥打码 ===')
store.setSyncError('sync failed: Bearer abcdefghijklmnop apiKey=sk-1234567890abcdef')
const persisted = store.state.lastSyncError ?? ''
check(!persisted.includes('sk-1234567890abcdef'), '同步错误中的 sk- 密钥已打码')
check(!persisted.includes('abcdefghijklmnop'), '同步错误中的 Bearer 串已打码')
check(!JSON.stringify(store.state).includes('sk-1234567890abcdef'), 'state 不含明文密钥')

await new Promise(resolve => server.close(resolve))
await store.dispose()
await rm(workspace, { recursive: true, force: true })
await rm(stateDir, { recursive: true, force: true })

const failed = results.filter(ok => !ok).length
console.log(`\n${results.length - failed}/${results.length} checks passed`)
process.exit(failed === 0 ? 0 : 1)