/**
 * Classifier + pool unit tests over the real 182-id inventory shape of this
 * account's `/models` endpoint. Verifies that non-chat endpoints are excluded,
 * capability/tier inference is sane, and ranking matches task intent.
 */
import { pathToFileURL } from 'node:url'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const lib = name => import(pathToFileURL(join(root, 'lib', name)).href)
const { classifyModel } = await lib('classify.js')
const { supportsThinkingSwitch, thinkingDispatch } = await lib('classify.js')
const { buildPool, rankForTask } = await lib('pool.js')

const results = []
const check = (ok, message) => {
  results.push(Boolean(ok))
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${message}`)
}

// --- classification -------------------------------------------------------
const nonChat = [
  ['MiniMax/speech-02-hd', 'TTS'],
  ['qwen3-tts-flash', 'TTS'],
  ['qwen-audio-3.0-asr-flash', 'ASR'],
  ['qwen3-asr-flash-realtime', 'ASR'],
  ['fun-asr-flash-2026-06-15', 'ASR'],
  ['qwen3-s2s-flash-realtime-2025-09-22', 's2s'],
  ['qwen3-livetranslate-flash', 'livetranslate'],
  ['qwen3-omni-flash-realtime-2025-09-15', 'realtime'],
  ['qwen3.7-text-embedding', 'embedding'],
  ['qwen3.7-text-rerank', 'rerank'],
  ['qwen-image-3.0-pro', 'image gen'],
  ['wan2.7-image', 'image gen'],
  ['z-image-turbo', 'image gen'],
  ['qwen-deep-research-2025-12-15', 'agent endpoint'],
]
for (const [id, family] of nonChat) {
  const traits = classifyModel(id)
  check(traits.chat === false, `${family} 被排除: ${id} (${traits.excludedReason})`)
}

const chatIds = [
  'deepseek-v4.1-flash-1017', 'deepseek-v4-pro', 'qwen3.8-max-0902', 'qwen3.8-max',
  'glm-5.2', 'kimi-k3.1-pro', 'MiniMax/MiniMax-M3', 'qwen-plus', 'qwen-flash',
  'qwen3-coder-flash', 'qwen-mt-plus', 'qwen3-vl-plus', 'qwen-vl-ocr',
  'qwen3-omni-flash', 'stepfun/step-5-preview', 'vanchin/deepseek-v3.2-think',
  'siliconflow/deepseek-r1-0528', 'qwen3.5-397b-a17b', 'qwen1.5-7b-chat',
  'unisound/unisound-u2', 'gui-plus', 'tongyi-xiaomi-analysis-pro',
]
for (const id of chatIds) {
  check(classifyModel(id).chat === true, `对话模型被保留: ${id}`)
}

// Vision inference
check(classifyModel('qwen3-vl-plus').vision === true, 'qwen3-vl-plus 判为视觉')
check(classifyModel('qwen-vl-ocr').vision === true, 'qwen-vl-ocr 判为视觉')
check(classifyModel('qwen3-omni-flash').vision === true, 'qwen3-omni-flash 判为视觉')
check(classifyModel('qwen-plus').vision === false, 'qwen-plus 判为非视觉')
check(classifyModel('deepseek-v4-pro').vision === false, 'deepseek-v4-pro 判为非视觉')

// Tier inference: the flagship must outrank a tiny chat model.
check(classifyModel('deepseek-v4-pro').quality > classifyModel('qwen1.5-7b-chat').quality,
  'deepseek-v4-pro 质量分高于 qwen1.5-7b-chat')
check(classifyModel('qwen-flash').speed > classifyModel('qwen3.8-max').speed,
  'qwen-flash 速度分高于 qwen3.8-max')
check(classifyModel('deepseek-r1').tasks.includes('reasoning'), 'deepseek-r1 带推理标签')
check(classifyModel('qwen3-coder-flash').tasks.includes('code'), 'qwen3-coder-flash 带代码标签')
check(classifyModel('qwen-mt-plus').tasks.includes('translation'), 'qwen-mt-plus 带翻译标签')

// --- pool + ranking over the real inventory --------------------------------
const INVENTORY = `kimi-k3.1-pro,gui-plus,qwen-plus,qwen-flash,qwen-max,qwen-long,qwen-turbo-0919,
deepseek-v4-pro,deepseek-v4.1-flash-1017,deepseek-v4.1-flash,deepseek-v4-pro-0813,glm-5.2,glm-5.3,
glm-5.3-prime,kimi-k3,kimi-k2.7-code,MiniMax/MiniMax-M3,MiniMax/MiniMax-M3.1-Flash,
stepfun/step-5-preview,qwen3.8-max,qwen3.8-max-0902,qwen3.8-flash,qwen3-vl-plus,qwen-vl-ocr,
qwen3-omni-flash,qwen-mt-plus,qwen-mt-flash,qwen3-coder-flash,qwen3.5-397b-a17b,
qwen3.5-omni-plus,qwen1.5-7b-chat,qwen2.5-0.5b-instruct,qwen-audio-3.0-asr-flash,qwen3-tts-flash,
qwen-image-3.0,qwen3.7-text-embedding,qwen3.7-text-rerank,wan2.7-image,z-image-turbo,
qwen3-livetranslate-flash,qwen3-s2s-flash-realtime-2025-09-22,unisound/unisound-u2,
tongyi-xiaomi-analysis-pro`.split(',').map(id => id.trim())

const options = {
  baseURL: 'https://example.invalid/v1',
  apiKeyEnv: 'X',
  apiKeyRefs: ['X'],
  enableDecision: true,
  decisionModel: 'deepseek-v4.1-flash-1017',
  decisionTimeoutMs: 1000,
  decisionInputMaxChars: 4000,
  fallbackModel: 'deepseek-v4.1-flash-1017',
  maxAttempts: 4,
  quotaCooldownMs: 1000,
  rateLimitCooldownMs: 1000,
  streamIdleTimeoutMs: 1000,
  autoSyncPool: true,
  poolSyncIntervalHours: 24,
  adoptProfileProvider: false,
  maxCandidatesForDecision: 12,
  includeSpecialEndpoints: false,
  excludeModels: [],
  taskRoutes: { image: [], writing: [], translation: [], code: [], reasoning: [], general: [] },
  models: [],
}

const pool = buildPool({ synced: INVENTORY.map(id => ({ id, source: 'sync' })), user: [], options })
check(pool.total === INVENTORY.length, `池统计总数: ${pool.total}`)
check(pool.entries.length < pool.total, `非对话模型被排除: ${pool.total - pool.entries.length} 个`)
check(!pool.entries.some(entry => entry.id === 'qwen3-tts-flash'), 'TTS 不在可路由池中')
check(!pool.entries.some(entry => entry.id === 'qwen-image-3.0'), '图像生成不在可路由池中')
check(pool.entries.some(entry => entry.id === 'glm-5.2'), 'glm-5.2 在可路由池中')

const writing = rankForTask('writing', pool, options)
check(/^(glm|kimi|qwen3\.8-max|MiniMax)/i.test(writing[0]), `写作首选属于写作强家族: ${writing[0]}`)

const code = rankForTask('code', pool, options)
check(/deepseek|glm|qwen3-coder|kimi-k2\.7-code|qwen3\.8-max/i.test(code[0]), `代码首选属于代码强模型: ${code[0]}`)

const reasoning = rankForTask('reasoning', pool, options)
check(/deepseek-r1|deepseek-v4-pro|glm-5\.3-prime|step-5|397b|qwen3\.8-max/i.test(reasoning[0]),
  `推理首选属于推理强模型: ${reasoning[0]}`)

const translation = rankForTask('translation', pool, options)
check(/qwen-mt/.test(translation[0]), `翻译首选是专用翻译模型: ${translation[0]}`)

const image = rankForTask('image', pool, options, true)
check(image.every(id => pool.byId.get(id)?.traits.vision), '图片任务的候选全部可读图片')
check(!image.some(id => /qwen1.5|0.5b/.test(id)), '图片任务不会选到小参数文本模型')

const general = rankForTask('general', pool, options)
check(general.length > 10, `通用任务候选充足: ${general.length} 个`)
check(new Set(general).size === general.length, '排序结果无重复')

// Exclusions from config
const excludedPool = buildPool({
  synced: INVENTORY.map(id => ({ id, source: 'sync' })),
  user: [],
  options: { ...options, excludeModels: ['qwen3.8-max*', 'glm-5.3'] },
})
check(!excludedPool.entries.some(entry => entry.id.startsWith('qwen3.8-max')), '通配排除生效: qwen3.8-max*')
check(!excludedPool.entries.some(entry => entry.id === 'glm-5.3'), '精确排除生效: glm-5.3')
check(excludedPool.excluded.some(entry => entry.id === 'glm-5.3' && /配置/.test(entry.reason)), '排除原因可见')

// User-declared special endpoint is honored
const forced = buildPool({
  synced: [], options,
  user: [{ id: 'qwen-deep-research-2025-12-15' }],
})
check(forced.entries.some(entry => entry.id === 'qwen-deep-research-2025-12-15'),
  '用户显式列出的特殊端点会被纳入')

// Before the first sync the built-in catalog keeps the plugin usable.
const coldStart = buildPool({ synced: [], user: [], options })
check(coldStart.entries.length > 20, `冷启动(未同步)仍有候选: ${coldStart.entries.length} 个`)
check(coldStart.entries.some(entry => entry.id === 'deepseek-v4.1-flash-1017'), '冷启动含默认决策模型')

// --- thinking-parameter mapping (§1) ---------------------------------------
// The Bailian /chat/completions switch is `enable_thinking` + `thinking_budget`,
// never `reasoning_effort`. These assert the family detection and the effort
// ladder the router will send.
check(supportsThinkingSwitch('qwen3.8-max') === true, 'qwen3.8-max 支持思考开关')
check(supportsThinkingSwitch('qwq-plus') === true, 'qwq 系支持思考开关')
check(supportsThinkingSwitch('qvq-max') === true, 'qvq 系支持思考开关')
check(supportsThinkingSwitch('glm-5.2') === true, 'glm-5.2 支持思考开关')
check(supportsThinkingSwitch('kimi-k2.5') === true, 'kimi 系支持思考开关')
check(supportsThinkingSwitch('step-3.7-flash') === true || supportsThinkingSwitch('stepfun/step-5-preview') === true, 'step 系支持思考开关')
check(supportsThinkingSwitch('vanchin/deepseek-v3.2-think') === true, 'deepseek-think 支持思考开关')
check(supportsThinkingSwitch('deepseek-v4-pro') === false, 'deepseek-v4-pro 无思考开关')
check(supportsThinkingSwitch('deepseek-v4.1-flash') === false, 'deepseek-v4.1-flash 无思考开关')
check(supportsThinkingSwitch('MiniMax/MiniMax-M3') === false, 'MiniMax 无思考开关')

// off → qwen receives enable_thinking:false; a no-switch family receives nothing.
const offQwen = thinkingDispatch('qwen3.8-max', 'off')
check(offQwen !== undefined && offQwen.enableThinking === false && offQwen.thinkingBudget === undefined,
  'off 对 qwen 产生 enable_thinking:false(无预算)')
check(thinkingDispatch('deepseek-v4-pro', 'off') === undefined, 'off 对无思考族不产生思考参数')
check(thinkingDispatch('qwen3.8-max', undefined) === undefined, '无档位不产生思考参数')

// low/medium → enable_thinking:true with a small explicit budget; omitting the
// budget lets some providers spend the whole completion on hidden reasoning.
const lowQwen = thinkingDispatch('qwen3.8-max', 'low')
check(lowQwen !== undefined && lowQwen.enableThinking === true && lowQwen.thinkingBudget === 1024,
  'low 产生 enable_thinking:true + 1024 预算')
check(thinkingDispatch('glm-5.2', 'medium')?.thinkingBudget === 2048, 'medium 产生 2048 预算')

// high/max → a budget cap, never a reasoning_effort:"max".
const highQwen = thinkingDispatch('qwen3.8-max', 'high')
const maxQwen = thinkingDispatch('qwen3.8-max', 'max')
check(highQwen?.enableThinking === true && typeof highQwen?.thinkingBudget === 'number' && highQwen.thinkingBudget > 0,
  'high 产生 enable_thinking:true + thinking_budget')
check(maxQwen?.enableThinking === true && maxQwen?.thinkingBudget === 16384, 'max 产生 16384 预算上限')
check(Object.prototype.hasOwnProperty.call(maxQwen ?? {}, 'reasoningEffort') === false,
  'max 不产生 reasoning_effort 字段')

const failed = results.filter(ok => !ok).length
console.log(`\n${results.length - failed}/${results.length} checks passed`)
process.exit(failed === 0 ? 0 : 1)