/**
 * Routing FORECAST ONLY — no chat/image request is sent.
 *
 * Feeds the user's prepared message (split into its five work items, plus the
 * whole message as one turn) through the plugin's real analysis, ranking and
 * balancing code, and prints what the router *would* pick and at which
 * reasoning effort. The only network call is the free `GET /models` sync.
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
const { analyzeRequest, buildCandidates, effortFor } = await lib('decision.js')

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

const store = RouterStore.create(join(tmpdir(), `forecast-${Date.now()}.json`))
await store.ready
const ctx = {
  logger: { debug() {}, info() {}, warn() {}, error() {} },
  llm: { fileRequestText: () => '' }, fiber: {},
  effect() {}, on() { return () => {} }, get() { return undefined }, provide() {}, inject() {},
}
const options = {
  baseURL, apiKeyEnv: keyEnv, enableDecision: true, decisionModel: 'deepseek-v4.1-flash-1017',
  decisionTimeoutMs: 20000, decisionInputMaxChars: 6000, fallbackModel: 'deepseek-v4.1-flash-1017',
  maxAttempts: 4, quotaCooldownMinutes: 30, rateLimitCooldownSeconds: 120, streamIdleTimeoutMs: 120000,
  autoSyncPool: true, poolSyncIntervalHours: 24, adoptProfileProvider: false, maxCandidatesForDecision: 14,
  includeSpecialEndpoints: false, excludeModels: [], balanceStrategy: 'balanced', balanceWindow: 6,
  balanceBand: 0, balanceWindowHours: 24, thinkingEffort: 'auto', enableMediaRouting: true,
  taskRoutes: { image: [], writing: [], translation: [], code: [], reasoning: [], general: [] }, models: [],
}
const router = new Router(ctx, options, store)
await router.syncPool(true)
const snapshot = router.capture()

const segments = [
  ['① 功能核对', '确认这个 DSH 插件是否满足我列的功能:决策模型 4.1flash 自动路由、按任务复杂度切换推理强度,并且只在你这个百炼账号的模型之间切换。'],
  ['② 页面设计', '设计插件页面:按分类展示生成图片模型、声音模型、思考模型、代码模型,点开分类再展开模型,支持设置每个模型的优先访问和额度上限,超额就挂掉换下一个。'],
  ['③ 完整性检测', '做一个一键检测插件完整性的按钮,检测在我的电脑上能不能正常用,并且自动修复或者自动配置。'],
  ['④ 发布页文案', '重写 Git 发布页,用大白话介绍功能和作用范围,不要架构图,写清楚先适配百炼、后续适配更多厂商。'],
  ['⑤ dshgo 移植', '把插件移植到 dshgo 0.2.0-rc.1 手机版,先跑通再让它在手机上自己适配修复,并决定要不要新建一个 repository。'],
]

const whole = `我的DSH用到的插件就是最新版吗,有以下我说的功能吗:
1. 一个百炼平台的API账号在DSH发起对话,模型会自动检测4.1flash去思考并且是决策模型,遇到不同的问题转交给不同的模型,还会根据任务复杂度自动切换推理强度
2. 点击插件可以进入页面,显示分类(生成图片模型、声音模型、思考模型、代码模型),点进分类展开对应模型,自动识别账号有啥模型并分类,可以对模型优先访问、设置额度上限,超额就挂,不选就是自动平均访问
3. 插件页面有个一键检测插件完整性按钮,自动修复或者配置
4. Git发布页用大白话写,不要架构图,写清楚作用范围
5. 后续做 dshgo 版本,移植到手机`

function forecast(label, text) {
  const analysis = analyzeRequest({
    provider: 'bailian-auto', model: 'bailian-auto',
    messages: [{ role: 'user', id: 'm', content: [{ type: 'text', text }], source: { kind: 'user' } }],
  }, 6000)
  const built = buildCandidates(analysis, analysis.heuristicTask, snapshot.options, snapshot.pool, store)
  const effort = effortFor(analysis, snapshot.options.thinkingEffort)
  const top = built.ranked.slice(0, 3)
  console.log(`\n${label}`)
  console.log(`  任务判定 : ${analysis.heuristicTask}   复杂度 ${analysis.complexity}/100 (${analysis.complexityLevel})   推理档位 ${effort}`)
  console.log(`  媒体意图 : ${analysis.mediaIntent ?? '无'}`)
  console.log(`  首选模型 : ${built.ranked[0]}`)
  console.log(`  备选链   : ${top.join('  →  ')}`)
  console.log(`  决策模型可见候选: ${built.forDecision.length} 个`)
  return { label, task: analysis.heuristicTask, complexity: analysis.complexity, level: analysis.complexityLevel, effort, chosen: built.ranked[0], chain: top }
}

console.log(`池: 可对话 ${snapshot.pool.entries.length} / 图像 ${snapshot.pool.media.image.length} / 视频 ${snapshot.pool.media.video.length} / 语音 ${snapshot.pool.media.speech.length}`)
console.log('（以下为预测,未发起任何对话请求）')

const results = segments.map(([label, text]) => forecast(label, text))
const wholeResult = forecast('⑥ 整段消息一次性提交', whole)

console.log('\n=== 汇总 ===')
for (const row of [...results, wholeResult]) {
  console.log(`${row.label}\t${row.task}\t复杂度 ${row.complexity}(${row.level})\t档位 ${row.effort}\t${row.chosen}`)
}

// What one turn would cost if the same five items are asked repeatedly: the
// balancing window would rotate the execution model.
console.log('\n=== 若同一段话连续提交 6 次(均衡轮转预测) ===')
const codeText = segments[1][1]
for (let index = 0; index < 6; index += 1) {
  const analysis = analyzeRequest({
    provider: 'bailian-auto', model: 'bailian-auto',
    messages: [{ role: 'user', id: 'm', content: [{ type: 'text', text: codeText }], source: { kind: 'user' } }],
  }, 6000)
  const built = buildCandidates(analysis, analysis.heuristicTask, snapshot.options, snapshot.pool, store)
  console.log(`  #${index + 1} → ${built.ranked[0]}`)
  store.recordUsage(analysis.heuristicTask, built.ranked[0], 4000)
}
await store.dispose()