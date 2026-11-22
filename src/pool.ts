/**
 * The execution pool: every model id this account can actually reach, plus its
 * inferred traits, and the per-task ranking the decision model chooses from.
 *
 * Membership is the endpoint's own `/models` listing once it has been synced —
 * not a shipped catalog — so routing spans whatever the account really has.
 * The built-in catalog and the user's `models` entries only contribute
 * metadata (names, vision, context window, affinity tags).
 */
import type { CatalogModel, TaskType } from './catalog.js'
import { BUILTIN_CATALOG, catalogEntry } from './catalog.js'
import { classifyModel } from './classify.js'
import type { ModelCategory, ModelTraits } from './classify.js'
import type { ConfigModel, RouterOptions } from './config.js'
import type { PoolModel, RouterStore } from './store.js'

/** One pool entry. */
export interface PoolEntry {
  id: string
  name: string
  /** Where the membership came from. */
  source: 'user' | 'builtin' | 'sync'
  traits: ModelTraits
  contextWindow?: number
  /** Explicit affinity tags from user config or the built-in catalog. */
  tags?: readonly TaskType[]
}

/** One excluded (non-chat) id, for the settings panel. */
export interface ExcludedEntry {
  id: string
  reason: string
}

/** The complete pool view. */
export interface Pool {
  /** Chat-capable entries, in listing order. */
  entries: PoolEntry[]
  /** Non-chat ids kept out of routing. */
  excluded: ExcludedEntry[]
  byId: Map<string, PoolEntry>
  /** Total ids seen before exclusion. */
  total: number
  /**
   * Non-chat endpoints grouped by the surface that serves them, so media tasks
   * (image generation) can route to them instead of discarding the id.
   */
  media: Record<Exclude<ModelCategory, 'chat' | 'agent'>, PoolEntry[]>
}

/** Inputs of one pool build. */
export interface PoolInput {
  /** Models synced from `GET /models`. */
  synced: readonly PoolModel[]
  /** User-declared entries (always chat-capable unless classified otherwise). */
  user: readonly ConfigModel[]
  options: RouterOptions
}

/** Merge explicit metadata over inference. */
function traitsOf(
  id: string,
  source: PoolEntry['source'],
  catalog: CatalogModel | undefined,
  user: ConfigModel | undefined,
  options: RouterOptions,
): ModelTraits {
  const inferred = classifyModel(id, { includeSpecialEndpoints: options.includeSpecialEndpoints })
  const explicitVision = user?.vision ?? catalog?.vision
  const explicitTags = user?.tags !== undefined && user.tags.length > 0 ? user.tags : catalog?.tags
  const traits: ModelTraits = {
    ...inferred,
    ...(explicitVision === undefined ? {} : { vision: explicitVision }),
    visionSource: explicitVision === undefined ? 'inferred' : 'declared',
    ...(explicitTags === undefined ? {} : { tasks: [...new Set([...inferred.tasks, ...explicitTags])] }),
  }
  // A user-declared id is an explicit instruction to route to it even when the
  // id text looks like a special endpoint.
  if (source === 'user' && !traits.chat) {
    return { ...traits, chat: true, excludedReason: undefined }
  }
  return traits
}

/** Whether a user exclusion pattern matches one id. */
function excludedByUser(id: string, patterns: readonly string[]): string | undefined {
  const lower = id.toLowerCase()
  for (const raw of patterns) {
    const pattern = raw.trim().toLowerCase()
    if (pattern.length === 0) continue
    if (pattern.includes('*')) {
      const regex = new RegExp(`^${pattern.split('*').map(part => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*')}$`)
      if (regex.test(lower)) return `已按配置排除 (${raw})`
    } else if (lower === pattern || lower.startsWith(pattern)) {
      return `已按配置排除 (${raw})`
    }
  }
  return undefined
}

/**
 * Build the pool from the synced listing, user entries, and the built-in
 * catalog.
 * @param input - synced models, user entries, and resolved options.
 * @returns chat-capable entries plus excluded ids.
 */
export function buildPool(input: PoolInput): Pool {
  const { synced, user, options } = input
  const userById = new Map(user.map(entry => [entry.id, entry]))
  const syncedById = new Map(synced.map(entry => [entry.id, entry]))

  // Membership: the live listing when available (plus user ids), otherwise the
  // built-in catalog so the plugin still works before the first sync.
  const membership: { id: string; source: PoolEntry['source'] }[] = []
  const seen = new Set<string>()
  const add = (id: string, source: PoolEntry['source']): void => {
    if (seen.has(id) || id.length === 0) return
    seen.add(id)
    membership.push({ id, source })
  }
  for (const entry of user) add(entry.id, 'user')
  if (synced.length > 0) {
    for (const entry of synced) add(entry.id, userById.has(entry.id) ? 'user' : 'sync')
  } else {
    // No sync yet: stand in with the built-in catalog so routing works on the
    // very first request (the next sync replaces this membership).
    for (const entry of BUILTIN_CATALOG) add(entry.id, 'builtin')
    for (const entry of [...userById.values()]) add(entry.id, 'user')
  }

  const entries: PoolEntry[] = []
  const excluded: ExcludedEntry[] = []
  const media: Pool['media'] = {
    image: [], speech: [], asr: [], realtime: [], embedding: [], rerank: [], video: [], music: [],
  }
  for (const { id, source } of membership) {
    const catalog = catalogEntry(id)
    const userEntry = userById.get(id)
    const userExclusion = excludedByUser(id, options.excludeModels)
    if (userExclusion !== undefined) {
      excluded.push({ id, reason: userExclusion })
      continue
    }
    const traits = traitsOf(id, source, catalog, userEntry, options)
    if (!traits.chat) {
      excluded.push({ id, reason: traits.excludedReason ?? '非对话模型' })
      if (traits.category !== 'agent') {
        const entry: PoolEntry = {
          id,
          name: userEntry?.name ?? catalog?.name ?? id,
          source,
          traits,
        }
        ;(media[traits.category as keyof Pool['media']] ??= []).push(entry)
      }
      continue
    }
    const syncedEntry = syncedById.get(id)
    entries.push({
      id,
      name: userEntry?.name ?? catalog?.name ?? syncedEntry?.name ?? id,
      source,
      traits,
      ...(userEntry?.contextWindow ?? catalog?.contextWindow ?? syncedEntry?.contextWindow
        ? { contextWindow: userEntry?.contextWindow ?? catalog?.contextWindow ?? syncedEntry?.contextWindow }
        : {}),
      ...(userEntry?.tags && userEntry.tags.length > 0
        ? { tags: userEntry.tags }
        : catalog?.tags ? { tags: catalog.tags } : {}),
    })
  }
  return {
    entries,
    excluded,
    byId: new Map(entries.map(entry => [entry.id, entry])),
    total: membership.length,
    media,
  }
}

/** Ranking context of one task. */
interface TaskWeights {
  quality: number
  speed: number
  /** Bonus when the trait lists this task. */
  affinity: number
  /** Penalty when the task is specialized and the model lacks it. */
  missing: number
}

const WEIGHTS: Record<TaskType, TaskWeights> = {
  writing: { quality: 0.78, speed: 0.22, affinity: 22, missing: 0 },
  code: { quality: 0.8, speed: 0.2, affinity: 22, missing: 0 },
  reasoning: { quality: 0.86, speed: 0.14, affinity: 22, missing: 0 },
  translation: { quality: 0.45, speed: 0.3, affinity: 40, missing: 22 },
  image: { quality: 0.75, speed: 0.25, affinity: 18, missing: 0 },
  general: { quality: 0.4, speed: 0.6, affinity: 10, missing: 0 },
}

/**
 * Rank the pool for one task.
 *
 * The order is a heuristic pre-ranking, not the decision: the decision model
 * sees the head of this list and may pick any of those candidates, and the
 * fallback chain walks the rest. Models pinned in `taskRoutes` float up, then
 * the task route for that type, then everything else.
 *
 * @param task - task type being routed.
 * @param pool - the built pool.
 * @param options - resolved settings (routes and weights).
 * @param hasImages - when true, only vision-capable entries are eligible.
 * @returns ranked model ids, best first.
 */
export function rankForTask(
  task: TaskType, pool: Pool, options: RouterOptions, hasImages = false,
): string[] {
  const weights = WEIGHTS[task] ?? WEIGHTS.general
  const pinned = new Map<string, number>()
  const route = options.taskRoutes[task] ?? []
  route.forEach((id, index) => pinned.set(id, route.length - index))
  if (task !== 'general') {
    for (const [index, id] of (options.taskRoutes.general ?? []).entries()) {
      if (!pinned.has(id)) pinned.set(id, Math.max(1, 6 - index))
    }
  }

  const scored: { id: string; score: number }[] = []
  for (const entry of pool.entries) {
    if (hasImages && !entry.traits.vision) continue
    const traits = entry.traits
    const affinity = traits.tasks.includes(task) ? weights.affinity : 0
    const missing = weights.missing > 0 && !traits.tasks.includes(task) ? -weights.missing : 0
    let score = traits.quality * weights.quality + traits.speed * weights.speed + affinity + missing
    const pin = pinned.get(entry.id)
    if (pin !== undefined) score += 26 + pin * 2
    if (traits.snapshot) score -= 5
    if (entry.source === 'user') score += 4
    // Prefer the vision-capable flagship for image work.
    if (task === 'image' && traits.vision && !/ocr/i.test(entry.id)) score += 6
    scored.push({ id: entry.id, score })
  }
  scored.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id))
  return scored.map(item => item.id)
}

/**
 * Pick stand-in decision/fallback models from the pool.
 *
 * A different Aliyun account rarely serves the exact ids this profile names, so
 * a configured decision model that is absent must not break routing: the router
 * degrades to the best fast general model (decision) and the best general model
 * (fallback) that the account actually has.
 *
 * @param pool - the built pool.
 * @param options - resolved settings.
 * @returns the effective decision and fallback ids, plus whether each was derived.
 */
export function pickDefaultModels(
  pool: Pool, options: RouterOptions,
): { decisionModel: string; fallbackModel: string; decisionDerived: boolean; fallbackDerived: boolean } {
  const generalRanked = rankForTask('general', pool, options)
  const configuredDecision = pool.byId.get(options.decisionModel)
  const configuredFallback = pool.byId.get(options.fallbackModel)
  const cheapest = [...pool.entries]
    .filter(entry => entry.traits.quality >= 50)
    .sort((a, b) => b.traits.speed - a.traits.speed || b.traits.quality - a.traits.quality)[0]
  const decision = configuredDecision?.id
    ?? cheapest?.id
    ?? generalRanked[0]
    ?? options.decisionModel
  const fallback = configuredFallback?.id ?? generalRanked[0] ?? decision
  return {
    decisionModel: decision,
    fallbackModel: fallback,
    decisionDerived: configuredDecision === undefined,
    fallbackDerived: configuredFallback === undefined,
  }
}

/**
 * Choose one model for a task while spreading load.
 *
 * The heuristic ranking decides *which models are good enough*; inside that band
 * the pick rotates toward whatever has consumed the least tokens recently. That
 * is what keeps a repeated "write code" request from always landing on the same
 * flagship model: candidates within `band` points of the best are treated as
 * interchangeable and drained evenly.
 *
 * @param ranked - ids from {@link rankForTask}, best first.
 * @param task - task category whose usage counters drive the rotation.
 * @param pool - the built pool.
 * @param options - resolved settings (band, window, strategy, window hours).
 * @param store - usage store.
 * @returns the chosen id plus the pool it was chosen from.
 */
export function chooseBalanced(
  ranked: readonly string[],
  task: TaskType,
  pool: Pool,
  options: RouterOptions,
  store: RouterStore,
): { chosen: string | undefined; band: string[]; balanced: boolean } {
  if (ranked.length === 0) return { chosen: undefined, band: [], balanced: false }
  const scored = scoreForTask(task, pool, options)
  const window = Math.max(1, options.balanceWindow)
  // The rotation set is the task's top-N candidates. `balanceBand`, when set,
  // additionally drops candidates whose score is too far below the best, so a
  // user can forbid mixing a flagship with a cheap model.
  const head = ranked.slice(0, window)
  const best = scored.get(head[0] ?? '') ?? 0
  const band = options.balanceBand > 0
    ? head.filter(id => (scored.get(id) ?? 0) >= best - options.balanceBand)
    : head
  const rotation = band.length > 0 ? band : head
  if (options.balanceStrategy !== 'balanced' || rotation.length <= 1) {
    return { chosen: ranked[0], band: head, balanced: false }
  }
  const windowMs = Math.max(1, options.balanceWindowHours) * 3_600_000
  const now = Date.now()
  let chosen = rotation[0] ?? ranked[0]!
  let lowest = Number.POSITIVE_INFINITY
  for (const id of rotation) {
    const usage = store.recentUsage(task, id, windowMs, now)
    // Tokens dominate, calls break ties, and an exact tie keeps the incoming
    // order — that order already encodes freshness (cooled models last).
    const load = usage.tokens + usage.calls * 1000
    if (load < lowest) {
      lowest = load
      chosen = id
    }
  }
  return { chosen, band: rotation, balanced: true }
}

/** Scores keyed by id for one task (same formula as {@link rankForTask}). */
function scoreForTask(task: TaskType, pool: Pool, options: RouterOptions): Map<string, number> {
  const weights = WEIGHTS[task] ?? WEIGHTS.general
  const scored = new Map<string, number>()
  const route = options.taskRoutes[task] ?? []
  for (const entry of pool.entries) {
    const traits = entry.traits
    const affinity = traits.tasks.includes(task) ? weights.affinity : 0
    const missing = weights.missing > 0 && !traits.tasks.includes(task) ? -weights.missing : 0
    let score = traits.quality * weights.quality + traits.speed * weights.speed + affinity + missing
    const pin = route.indexOf(entry.id)
    if (pin >= 0) score += 26 + (route.length - pin) * 2
    if (traits.snapshot) score -= 5
    if (entry.source === 'user') score += 4
    if (task === 'image' && traits.vision && !/ocr/i.test(entry.id)) score += 6
    scored.set(entry.id, score)
  }
  return scored
}

/** Short capability note shown beside one candidate in the decision prompt. */
export function describeTraits(entry: PoolEntry, task: TaskType): string {
  const notes: string[] = []
  if (entry.traits.vision) notes.push('可读图片')
  if (entry.traits.tasks.includes('code')) notes.push('代码强')
  if (entry.traits.tasks.includes('reasoning')) notes.push('推理强')
  if (entry.traits.tasks.includes('writing')) notes.push('写作强')
  if (entry.traits.tasks.includes('translation')) notes.push('翻译专用')
  if (entry.traits.speed >= 70) notes.push('快/便宜')
  else if (entry.traits.quality >= 85) notes.push('能力旗舰')
  const scale = entry.contextWindow === undefined ? '' : ` · 上下文 ${Math.round(entry.contextWindow / 1024)}K`
  return [notes.join('、'), task === 'image' && entry.traits.vision ? '' : ''].filter(Boolean).join(' · ') + scale
}