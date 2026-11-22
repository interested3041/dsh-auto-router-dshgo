/**
 * Capability inference for an arbitrary model id.
 *
 * The Bailian `/models` listing returns only `{ id, object, created, owned_by }`
 * — no modalities, no tier, no task type — and a real account's list mixes chat
 * models with TTS/ASR/embedding/rerank/image-generation endpoints. Routing over
 * "whatever this account can reach" therefore needs two things per id:
 *
 * 1. **Is it a chat-completion model at all?** Non-chat ids are excluded from
 *    the execution pool so a request never lands on `…-tts-flash`.
 * 2. **What is it good at?** Family, generation, parameter scale and tier
 *    keywords give a quality/speed estimate and task affinities, which rank the
 *    pool before the decision model picks.
 *
 * Every rule is a documented heuristic over the id text; explicit catalog
 * entries and user overrides always win over inference (see `pool.ts`).
 */
import type { TaskType } from './catalog.js'

/** What wire surface a model id actually serves. */
export type ModelCategory =
  | 'chat'        // /chat/completions: text (+ optional image input)
  | 'image'       // /images/generations
  | 'speech'      // text-to-speech
  | 'asr'         // speech-to-text
  | 'realtime'    // bidirectional audio streams (websocket)
  | 'embedding'
  | 'rerank'
  | 'video'
  | 'music'
  | 'agent'       // research/planning agent endpoints

/** Everything the router needs to know about one model id. */
export interface ModelTraits {
  /** Whether this id can serve chat completions at all. */
  chat: boolean
  /** Whether it accepts image input. */
  vision: boolean
  /** Where `vision` came from: explicit catalog/config declaration, or id inference. */
  visionSource?: 'declared' | 'inferred'
  /** Why a non-chat id is excluded, for the settings panel. */
  excludedReason?: string
  /** Which endpoint surface serves this id. */
  category: ModelCategory
  /** Vendor family, lower-case (`qwen`, `deepseek`, `glm`, …). */
  family: string
  /** Parsed generation number (3.8, 4.1 …) used to prefer newer models. */
  version: number
  /** Rough capability score, 5–100. */
  quality: number
  /** Rough latency/cost score, 5–100 (higher = cheaper/faster). */
  speed: number
  /** Task affinities inferred from the id. */
  tasks: readonly TaskType[]
  /** Whether the id is a dated/versioned snapshot rather than a moving alias. */
  snapshot: boolean
}

/** Ids served by a non-chat endpoint, with the surface they belong to. */
const CATEGORY_RULES: readonly { pattern: RegExp; category: ModelCategory; reason: string }[] = [
  { pattern: /embedding|embed-/i, category: 'embedding', reason: '向量化模型 (embedding)' },
  { pattern: /rerank/i, category: 'rerank', reason: '重排模型 (rerank)' },
  { pattern: /(^|[-/_])image([-/_]|$)|wan2|wanx|z-image|stable-?diffusion|flux/i, category: 'image', reason: '图像生成 (/images/generations)' },
  { pattern: /(^|[-/_])video([-/_]|$)|wan-?video|kling/i, category: 'video', reason: '视频生成' },
  { pattern: /(^|[-/_])music([-/_]|$)/i, category: 'music', reason: '音乐生成' },
  { pattern: /asr|sensevoice/i, category: 'asr', reason: '语音识别 (ASR)' },
  { pattern: /(^|[-/_])tts([-/_]|$)|speech/i, category: 'speech', reason: '语音合成 (TTS)' },
  { pattern: /s2s/i, category: 'realtime', reason: '语音到语音 (s2s)' },
  { pattern: /livetranslate/i, category: 'realtime', reason: '实时翻译通道' },
  { pattern: /realtime/i, category: 'realtime', reason: '实时/双向流模型' },
]

/** Agent/research endpoints that do not accept an ordinary chat request. */
const SPECIAL_ENDPOINTS = /deep-research|deep-search-planning|deepsearch/i

/** Vision signal in the id text (OCR/VL/Omni/QVQ families read images). */
const VISION_ID = /(^|[-/_.])(vl|omni|ocr|qvq|vision)([-/_.]|$)/i

const CODE_HINT = /coder|code|deepseek-v[34]|deepseek-r1|glm|kimi-k2\.[67]-code/i
const REASONING_HINT = /(^|[-/_.])(r1|think|reason|qwq|qvq)([-/_.]|$)|reasoner|deep-research|step-5|prime/i
const WRITING_HINT = /glm|kimi|minimax|step|ling|qwen-?max|qwen-?plus|qwen3\.[5-8]-(max|plus)/i
const TRANSLATION_HINT = /(^|[-/_.])mt([-/_]|$)|translate/i
const FLASH_HINT = /flash|turbo|lite|mini|small|fast/i
const TOP_HINT = /max|pro|ultra|prime|2\.4t|397b|110b|72b|122b/i

/** Extract the numeric scale from an id (`397b-a17b` → 397, `2.4t` → 2400). */
function scaleOf(id: string): number {
  const matches = [...id.matchAll(/(\d+(?:\.\d+)?)\s*([bt])/gi)]
  if (matches.length === 0) return 0
  let best = 0
  for (const match of matches) {
    const value = Number(match[1] ?? 0)
    const unit = (match[2] ?? 'b').toLowerCase()
    const size = unit === 't' ? value * 1000 : value
    if (size > best) best = size
  }
  return best
}

/** Family prefix after stripping a `vendor/` segment. */
function familyOf(id: string): string {
  const bare = id.includes('/') ? id.slice(id.lastIndexOf('/') + 1) : id
  const lower = bare.toLowerCase()
  const families = ['deepseek', 'qwen', 'glm', 'zhipu', 'kimi', 'minimax', 'stepfun', 'step', 'ling',
    'unisound', 'tongyi', 'xiaomi', 'mimo', 'gui', 'siliconflow']
  for (const family of families) {
    if (lower.startsWith(family)) return family === 'zhipu' ? 'glm' : family === 'siliconflow' ? 'siliconflow' : family
  }
  return lower.split(/[-_.\d]/)[0] ?? lower
}

/** Generation number following the family token (`qwen3.8-max` → 3.8). */
function versionOf(id: string): number {
  const bare = id.includes('/') ? id.slice(id.lastIndexOf('/') + 1) : id
  const match = /(\d+(?:\.\d+)?)/.exec(bare)
  return match ? Number(match[1]) : 0
}

/** Quality heuristic: scale, tier keywords and generation, clamped to 5–100. */
function qualityOf(id: string, family: string, version: number, tasks: readonly TaskType[]): number {
  let score = 55
  const scale = scaleOf(id)
  if (scale > 0) {
    if (scale >= 1000) score = 95
    else if (scale >= 300) score = 90
    else if (scale >= 100) score = 82
    else if (scale >= 50) score = 74
    else if (scale >= 20) score = 64
    else if (scale >= 7) score = 52
    else score = 38
  }
  if (TOP_HINT.test(id)) score += 10
  if (/ultra|prime/i.test(id)) score += 4
  if (FLASH_HINT.test(id)) score -= 7
  if (/distill/i.test(id)) score -= 22
  if (/preview/i.test(id)) score -= 4
  if (/0\.5b|1\.5b|1\.8b/i.test(id)) score -= 18
  // Flagship families earn a floor, but only for their flagship tiers — a
  // "flash" or "lite" variant keeps its cheap-tier score.
  const cheapTier = FLASH_HINT.test(id) || /lite|small|mini/i.test(id)
  if (!cheapTier) {
    if (family === 'deepseek' && /v4-pro|v3\.2-think|r1$/.test(id)) score = Math.max(score, 86)
    if (family === 'qwen' && version >= 3.7) score = Math.max(score, 78)
    if (family === 'glm' && version >= 5) score = Math.max(score, 80)
    if (family === 'kimi' && version >= 3) score = Math.max(score, 84)
    if (family === 'minimax') score = Math.max(score, 76)
  }
  // Dedicated translation models are purpose-built: they beat generalists for
  // translation even though their raw scale is small.
  if (tasks.includes('translation') && TRANSLATION_HINT.test(id)) score = Math.max(score, 85)
  return Math.max(5, Math.min(100, Math.round(score)))
}

/** Speed/cost heuristic: small or fast-tier models are cheap. */
function speedOf(id: string, quality: number): number {
  let score = Math.max(10, 110 - quality)
  // Translation endpoints are served by small dedicated models.
  if (TRANSLATION_HINT.test(id)) return Math.max(score, 58)
  if (FLASH_HINT.test(id)) score += 22
  if (/turbo|lite/i.test(id)) score += 12
  if (/max|pro|ultra|prime/i.test(id)) score -= 12
  return Math.max(5, Math.min(100, Math.round(score)))
}

/**
 * Classify one model id.
 * @param id - exact model id from the endpoint listing, the catalog, or config.
 * @param options - whether special agent endpoints count as chat models.
 */
export function classifyModel(id: string, options: { includeSpecialEndpoints?: boolean } = {}): ModelTraits {
  const family = familyOf(id)
  const version = versionOf(id)
  const vision = VISION_ID.test(id)

  for (const rule of CATEGORY_RULES) {
    if (!rule.pattern.test(id)) continue
    return {
      chat: false,
      vision,
      excludedReason: rule.reason,
      category: rule.category,
      family,
      version,
      quality: 0,
      speed: 0,
      tasks: [],
      snapshot: isSnapshot(id),
    }
  }
  if (SPECIAL_ENDPOINTS.test(id) && options.includeSpecialEndpoints !== true) {
    return {
      chat: false, vision, excludedReason: '智能体/研究类端点', category: 'agent', family, version,
      quality: 0, speed: 0, tasks: [], snapshot: isSnapshot(id),
    }
  }

  const tasks: TaskType[] = ['general']
  if (TRANSLATION_HINT.test(id)) tasks.push('translation')
  if (CODE_HINT.test(id)) tasks.push('code')
  if (REASONING_HINT.test(id)) tasks.push('reasoning')
  if (WRITING_HINT.test(id)) tasks.push('writing')
  if (vision) tasks.push('image')

  const quality = qualityOf(id, family, version, tasks)
  return {
    chat: true,
    vision,
    category: 'chat',
    family,
    version,
    quality,
    speed: speedOf(id, quality),
    tasks,
    snapshot: isSnapshot(id),
  }
}

/** Dated/versioned snapshot ids (`-2025-11-05`, `-0107`, `…-0902`). */
export function isSnapshot(id: string): boolean {
  return /-\d{4}(?:-\d{2}){0,2}$|-\d{3,4}$/.test(id) && !/qwen\d|glm-\d/i.test(id.slice(-6))
}

/** Reasoning-effort ladder the harness hands the router (after `auto` is resolved). */
export type ThinkingEffort = 'off' | 'low' | 'medium' | 'high' | 'max'

/** Wire thinking parameters for one OpenAI-compatible model. */
export interface ThinkingDispatch {
  /** The `enable_thinking` boolean sent to the provider (Bailian-style vendors). */
  enableThinking?: boolean
  /** The `thinking_budget` cap sent alongside `enable_thinking: true`. */
  thinkingBudget?: number
  /** The `reasoning_effort` level sent to reasoning-effort-style vendors. */
  reasoningEffort?: 'low' | 'medium' | 'high'
}

/**
 * Map a resolved effort onto a valid OpenAI `reasoning_effort` value.
 * `off` sends nothing; `max` clamps to `high` (there is no `max` effort value).
 */
export function effortToReasoningEffort(effort: ThinkingEffort | undefined): 'low' | 'medium' | 'high' | undefined {
  switch (effort) {
    case 'low': return 'low'
    case 'medium': return 'medium'
    case 'high':
    case 'max': return 'high'
    default: return undefined
  }
}

/**
 * Whether one model id is served by a family whose OpenAI-compatible endpoint
 * honors the Bailian thinking switch (`enable_thinking` + `thinking_budget`).
 *
 * The families that do — qwen / qwq / qvq, deepseek-think/reasoner, glm 4.5+,
 * kimi, step — must NOT receive `reasoning_effort`; they toggle thinking with
 * `enable_thinking`. Plain deepseek chat variants (v4-pro, v4-flash), minimax,
 * ling and the rest are "no-thinking-switch" families: sending `enable_thinking`
 * is either ignored or rejected, so the router sends nothing for them.
 */
export function supportsThinkingSwitch(id: string): boolean {
  const lower = id.toLowerCase()
  if (/qwen|qwq|qvq/.test(lower)) return true
  if (/deepseek/.test(lower)) return /think|r1|reasoner/i.test(lower)
  if (/glm/.test(lower)) return /glm[-_.]?(?:4\.(?:[5-9]|[1-9]\d)|[5-9])/i.test(lower)
  if (/\bkimi\b/.test(lower)) return true
  // stepfun / step-3.7 / step-5 …; "step" must be a standalone family token.
  return /(?:^|[/_.-])step(?:fun)?([-_.]|\d)/i.test(id)
}

/**
 * Map one effort level onto the Bailian thinking switch for a specific model.
 * Never emits `reasoning_effort`; `max` maps to the largest budget, not a
 * non-existent effort value.
 *
 * @param id - exact model id from the account listing or config.
 * @param effort - resolved effort level (low/medium/high/max/off).
 * @returns the parameters to send, or `undefined` when the provider must not
 *   receive any thinking parameter (absent effort, unsupported family, or the
 *   model already learned that it rejects them).
 */
export function thinkingDispatch(id: string, effort: ThinkingEffort | undefined): ThinkingDispatch | undefined {
  if (effort === undefined) return undefined
  if (!supportsThinkingSwitch(id)) return undefined
  switch (effort) {
    case 'off': return { enableThinking: false }
    case 'low':
    case 'medium': return { enableThinking: true }
    case 'high': return { enableThinking: true, thinkingBudget: 32768 }
    case 'max': return { enableThinking: true, thinkingBudget: 65536 }
  }
}