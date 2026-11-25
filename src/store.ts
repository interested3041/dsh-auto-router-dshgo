/**
 * Persistent router state: the synced model pool, per-model quota/cooldown
 * status, and the recent routing history shown by the status panel.
 *
 * The file lives at `~/.dsh/auto-router/state.json` (honoring
 * `$DSH_HOME`), is written atomically (tmp + rename) with a small debounce,
 * and tolerates partial corruption by falling back to a fresh state.
 */
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

/** One synced-from-endpoint pool entry. */
export interface PoolModel {
  id: string
  name?: string
  vision?: boolean
  contextWindow?: number
  /** Where the entry came from. */
  source: 'sync' | 'user'
  syncedAt?: number
}

/** Per-model quota / cooldown status. */
export interface QuotaState {
  /** Epoch ms until which the model is skipped by the router; absent = available. */
  cooldownUntil?: number
  /** Failure code that started the current cooldown. */
  lastFailCode?: string
  lastFailAt?: number
  lastOkAt?: number
  /** Consecutive failures (reset on success). */
  fails: number
  /** Lifetime routed-call counters since installation. */
  calls: number
}

/** One routing decision record for the status panel. */
export interface RouteRecord {
  at: number
  task: string
  modality: 'text' | 'image'
  /** 'model' = decision model chose; 'heuristic' = rules chose; 'fallback' = decision failed. */
  decisionSource: 'model' | 'heuristic' | 'fallback' | 'media' | 'notice'
  decisionModel?: string
  reasoning?: string
  /** Models tried in order. */
  attempts: { model: string; ok: boolean; code?: string }[]
  finalModel?: string
  ok: boolean
  /** Tokens spent on the decision call for this request. */
  decisionTokens?: number
  /** 'auto' = router chose; 'user' = the user pinned the model in-message. */
  origin?: 'auto' | 'user'
  /** Candidate-ordering strategy in effect for this request. */
  strategy?: string
  /** Local key identity the tokens were charged to. */
  keyId?: string
  /** Conversation/session that produced this record (when the host sends one). */
  sessionId?: string
  /** Execution tokens (input+output) charged for this request. */
  tokens?: number
  /** Non-cached input tokens billed for this request. */
  inputTokens?: number
  /** Output tokens billed for this request. */
  outputTokens?: number
  /** Input tokens served from the provider's prompt cache. */
  cacheReadTokens?: number
  /** Input tokens written into the prompt cache (Anthropic-style providers). */
  cacheWriteTokens?: number
  /** Background title/summary helper: ledger-only, not a user decision. */
  utility?: boolean
}

/** History rows belonging to one key. Records without a keyId are never shown
 * under a concrete key: after switching accounts, an old key's decision must
 * not masquerade as the new key's last decision. */
export function historyForKey(records: readonly RouteRecord[], keyId: string): RouteRecord[] {
  if (keyId === '') return [...records]
  return records.filter(record => record.keyId === keyId)
}

/** Per-model consumption inside one key's ledger. */
export interface KeyLedgerModel {
  tokens: number
  calls: number
  /** Tokens consumed in the current free-quota bucket. */
  bucketTokens: number
  bucketStartedAt: number
  lastUsedAt: number
}

/** One API key's independent token ledger (never mixed across keys). */
export interface KeyLedger {
  keyId: string
  label: string
  providerId?: string
  baseURL: string
  updatedAt: number
  models: Record<string, KeyLedgerModel>
  totalTokens: number
  /** Bucket rotation counter (free-quota mode). */
  cycle: number
}

/** Recent consumption of one model inside one task category. */
export interface UsageEntry {
  /** Routed calls in the balancing window. */
  calls: number
  /** Input+output tokens consumed in the balancing window. */
  tokens: number
  /** Epoch ms of the last routed call. */
  lastAt: number
}

/**
 * One session's sticky model choice. Agent sessions fan out dozens of turns;
 * rotating the model inside one session would destroy the provider's prompt
 * cache and can change tool-call formatting mid-conversation.
 */
export interface SessionBinding {
  model: string
  /** Epoch ms of the last turn served by this session. */
  at: number
  /** Turns served in this session (periodic reselection keeps balance fair). */
  turns: number
  /** Heuristic task type of the last turn; a topic change re-decides. */
  task?: string
}

/** Complete persisted state. */
export interface RouterState {
  version: 2
  /** Endpoint + credential identity the pool and quota belong to. */
  scope?: string
  pool: PoolModel[]
  lastSyncAt?: number
  lastSyncError?: string
  quota: Record<string, QuotaState>
  history: RouteRecord[]
  /** Token usage per task category per model, for load balancing and rotation. */
  usage: Record<string, Record<string, UsageEntry>>
  /** Models the provider rejected for image input (epoch ms). */
  visionVeto: Record<string, number>
  /** Models that accepted image input (epoch ms). */
  visionOk: Record<string, number>
  /** Models that rejected a reasoning-effort parameter (epoch ms). */
  effortUnsupported: Record<string, number>
  /** Session id -> sticky model, so one conversation keeps one model. */
  sessions: Record<string, SessionBinding>
  /** Per-model cumulative usage (calls + tokens), used for configured limits. */
  modelTotals: Record<string, { calls: number; tokens: number }>
  /** Per-key independent token ledgers (free-quota bucket accounting). */
  ledgers: Record<string, KeyLedger>
  /** Most-recently-used key ids, newest first. */
  keyHistory: string[]
  /** One-shot model override for the next request (user pinned). */
  pendingUserModel?: string
}

const STATE_VERSION = 2 as const
const MAX_HISTORY = 50
/** Session stickiness expires so a reused id cannot pin an obsolete model. */
const SESSION_TTL_MS = 24 * 60 * 60 * 1000
const MAX_SESSIONS = 200

/** Strip credential-shaped substrings before anything is persisted. */
export function redactSecrets(text: string): string {
  return text
    .replace(/sk-[A-Za-z0-9_-]{6,}/g, '[redacted]')
    .replace(/ghp_[A-Za-z0-9]{10,}/g, '[redacted]')
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]{8,}/gi, 'Bearer [redacted]')
    .replace(/(?:api[_-]?key|apikey|access[_-]?token|secret)\s*[:=]\s*[^\s"',;]{6,}/gi, '[redacted]')
}

function freshState(): RouterState {
  return {
    version: STATE_VERSION,
    pool: [],
    quota: {},
    history: [],
    usage: {},
    visionVeto: {},
    visionOk: {},
    effortUnsupported: {},
    sessions: {},
    modelTotals: {},
    ledgers: {},
    keyHistory: [],
  }
}

function sanitize(raw: unknown): RouterState {
  const state = freshState()
  if (typeof raw !== 'object' || raw === null) return state
  const data = raw as Partial<RouterState>
  if (Array.isArray(data.pool)) {
    state.pool = data.pool.filter((entry): entry is PoolModel =>
      typeof entry?.id === 'string' && entry.id.length > 0)
  }
  if (typeof data.scope === 'string') state.scope = data.scope
  if (typeof data.lastSyncAt === 'number') state.lastSyncAt = data.lastSyncAt
  if (typeof data.lastSyncError === 'string') state.lastSyncError = redactSecrets(data.lastSyncError)
  if (typeof data.quota === 'object' && data.quota !== null) {
    for (const [id, entry] of Object.entries(data.quota)) {
      if (typeof entry !== 'object' || entry === null) continue
      state.quota[id] = {
        fails: Number.isFinite(entry.fails) ? entry.fails : 0,
        calls: Number.isFinite(entry.calls) ? entry.calls : 0,
        ...(typeof entry.cooldownUntil === 'number' ? { cooldownUntil: entry.cooldownUntil } : {}),
        ...(typeof entry.lastFailCode === 'string' ? { lastFailCode: entry.lastFailCode } : {}),
        ...(typeof entry.lastFailAt === 'number' ? { lastFailAt: entry.lastFailAt } : {}),
        ...(typeof entry.lastOkAt === 'number' ? { lastOkAt: entry.lastOkAt } : {}),
      }
    }
  }
  if (typeof data.usage === 'object' && data.usage !== null) {
    for (const [task, models] of Object.entries(data.usage)) {
      if (typeof models !== 'object' || models === null) continue
      const row: Record<string, UsageEntry> = {}
      for (const [model, entry] of Object.entries(models)) {
        if (typeof entry !== 'object' || entry === null) continue
        row[model] = {
          calls: Number.isFinite(entry.calls) ? entry.calls : 0,
          tokens: Number.isFinite(entry.tokens) ? entry.tokens : 0,
          lastAt: Number.isFinite(entry.lastAt) ? entry.lastAt : 0,
        }
      }
      state.usage[task] = row
    }
  }
  for (const key of ['visionVeto', 'visionOk', 'effortUnsupported'] as const) {
    const raw = data[key]
    if (typeof raw !== 'object' || raw === null) continue
    for (const [id, at] of Object.entries(raw)) {
      if (typeof at === 'number' && Number.isFinite(at)) state[key][id] = at
    }
  }
  if (typeof data.modelTotals === 'object' && data.modelTotals !== null) {
    for (const [model, entry] of Object.entries(data.modelTotals)) {
      if (typeof entry !== 'object' || entry === null) continue
      state.modelTotals[model] = {
        calls: Number.isFinite(entry.calls) ? entry.calls : 0,
        tokens: Number.isFinite(entry.tokens) ? entry.tokens : 0,
      }
    }
  }
  if (Array.isArray(data.history)) {
    state.history = data.history
      .filter((entry): entry is RouteRecord => typeof entry?.at === 'number' && Array.isArray(entry.attempts))
      .slice(-MAX_HISTORY)
      .map((entry) => ({
        ...entry,
        // Whitelist: only the model, the outcome and the failure class are
        // persisted - never a provider error message or a request body.
        attempts: entry.attempts.map((attempt) => ({
          model: String(attempt?.model ?? ''),
          ok: attempt?.ok === true,
          ...(typeof attempt?.code === 'string' ? { code: attempt.code } : {}),
        })),
      }))
  }
  if (typeof data.sessions === 'object' && data.sessions !== null) {
    for (const [id, entry] of Object.entries(data.sessions)) {
      if (typeof entry?.model !== 'string' || entry.model.length === 0) continue
      state.sessions[id] = {
        model: entry.model,
        at: Number.isFinite(entry.at) ? entry.at : 0,
        turns: Number.isFinite(entry.turns) ? entry.turns : 0,
        ...(typeof entry.task === 'string' && entry.task.length > 0 ? { task: entry.task } : {}),
      }
    }
  }
  if (typeof data.ledgers === 'object' && data.ledgers !== null) {
    for (const [keyId, ledger] of Object.entries(data.ledgers)) {
      if (typeof ledger !== 'object' || ledger === null) continue
      const models: Record<string, KeyLedgerModel> = {}
      if (typeof ledger.models === 'object' && ledger.models !== null) {
        for (const [model, entry] of Object.entries(ledger.models)) {
          if (typeof entry !== 'object' || entry === null) continue
          models[model] = {
            tokens: Number.isFinite(entry.tokens) ? entry.tokens : 0,
            calls: Number.isFinite(entry.calls) ? entry.calls : 0,
            bucketTokens: Number.isFinite(entry.bucketTokens) ? entry.bucketTokens : 0,
            bucketStartedAt: Number.isFinite(entry.bucketStartedAt) ? entry.bucketStartedAt : 0,
            lastUsedAt: Number.isFinite(entry.lastUsedAt) ? entry.lastUsedAt : 0,
          }
        }
      }
      state.ledgers[keyId] = {
        keyId,
        label: typeof ledger.label === 'string' ? ledger.label : keyId,
        ...(typeof ledger.providerId === 'string' ? { providerId: ledger.providerId } : {}),
        baseURL: typeof ledger.baseURL === 'string' ? ledger.baseURL : '',
        updatedAt: Number.isFinite(ledger.updatedAt) ? ledger.updatedAt : 0,
        models,
        totalTokens: Number.isFinite(ledger.totalTokens) ? ledger.totalTokens : 0,
        cycle: Number.isFinite(ledger.cycle) ? ledger.cycle : 0,
      }
    }
  }
  if (Array.isArray(data.keyHistory)) {
    state.keyHistory = data.keyHistory.filter((id): id is string => typeof id === 'string').slice(0, 50)
  }
  if (typeof data.pendingUserModel === 'string' && data.pendingUserModel.length > 0) {
    state.pendingUserModel = data.pendingUserModel
  }
  return state
}

/** Live state handle over one JSON file. */
export class RouterStore {
  /** Current state; mutate through the methods below, then `scheduleWrite()`. */
  state: RouterState = freshState()
  /** Settles once the initial file load completed (successfully or not). */
  readonly ready: Promise<void>
  private writeTimer: ReturnType<typeof setTimeout> | undefined
  private writing: Promise<void> = Promise.resolve()
  private disposed = false

  private constructor(readonly file: string) {
    this.ready = this.load()
  }

  /** Create the handle and start loading in the background (see `ready`). */
  static create(file: string): RouterStore {
    return new RouterStore(file)
  }

  /** Load (or create) the state file. Corrupt content falls back to fresh state. */
  static async open(file: string): Promise<RouterStore> {
    const store = new RouterStore(file)
    await store.ready
    return store
  }

  private async load(): Promise<void> {
    try {
      const text = await readFile(this.file, 'utf8')
      const raw = JSON.parse(text) as Record<string, unknown>
      // v1 -> v2: keep a one-time backup before the additive ledger fields land.
      if (raw && typeof raw === 'object' && !('ledgers' in raw)) {
        try { await writeFile(`${this.file}.v1.bak`, text, 'utf8') } catch (_backupFailed) { /* best effort */ }
      }
      this.state = sanitize(raw)
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code !== 'ENOENT') {
        console.warn(`[dsh-auto-router] state file unreadable, starting fresh: ${String((error as Error)?.message ?? error)}`)
      }
    }
  }

  /** Quota entry of one model, created on demand. */
  quotaOf(model: string): QuotaState {
    return this.state.quota[model] ??= { fails: 0, calls: 0 }
  }

  /** Whether the model is in cooldown at the given time. */
  inCooldown(model: string, now = Date.now()): boolean {
    const until = this.state.quota[model]?.cooldownUntil
    return typeof until === 'number' && until > now
  }

  /** Put one model into cooldown after a classified failure. */
  markFailure(model: string, code: string, cooldownMs: number, now = Date.now()): void {
    const quota = this.quotaOf(model)
    quota.fails += 1
    quota.lastFailCode = code
    quota.lastFailAt = now
    quota.cooldownUntil = now + cooldownMs
    this.scheduleWrite()
  }

  /** Record a successful routed call. */
  markSuccess(model: string, now = Date.now()): void {
    const quota = this.quotaOf(model)
    quota.fails = 0
    quota.calls += 1
    quota.lastOkAt = now
    delete quota.cooldownUntil
    delete quota.lastFailCode
    this.scheduleWrite()
  }

  /** Clear cooldown of one model, or of every model when omitted. */
  resetCooldown(model?: string): void {
    if (model === undefined) {
      for (const entry of Object.values(this.state.quota)) {
        delete entry.cooldownUntil
        delete entry.lastFailCode
        entry.fails = 0
      }
    } else {
      const entry = this.state.quota[model]
      if (entry) {
        delete entry.cooldownUntil
        delete entry.lastFailCode
        entry.fails = 0
      }
    }
    this.scheduleWrite()
  }

  /** Append one routing record, capped to the most recent 50. */
  recordRoute(record: RouteRecord): void {
    this.state.history.push(record)
    if (this.state.history.length > MAX_HISTORY) {
      this.state.history.splice(0, this.state.history.length - MAX_HISTORY)
    }
    this.scheduleWrite()
  }

  clearHistory(): void {
    this.state.history = []
    this.scheduleWrite()
  }

  /**
   * Bind the stored pool/quota to one connection identity. Switching accounts
   * (a different endpoint or credential reference) invalidates the previous
   * account's model list and cooldowns, which would otherwise suppress or
   * resurrect models that no longer exist there.
   * @param scope - `baseURL|credentialRef` of the connection in use.
   * @returns whether the scope changed (callers then resync).
   */
  bindScope(scope: string): boolean {
    if (this.state.scope === scope) return false
    const first = this.state.scope === undefined
    this.state.scope = scope
    if (!first) {
      this.state.pool = []
      this.state.quota = {}
      this.state.usage = {}
      this.state.modelTotals = {}
      this.state.visionVeto = {}
      this.state.visionOk = {}
      this.state.effortUnsupported = {}
      this.state.sessions = {}
      delete this.state.lastSyncAt
      delete this.state.lastSyncError
    }
    this.scheduleWrite()
    return !first
  }

  /** Replace the synced pool listing. */
  setPool(models: PoolModel[], now = Date.now()): void {
    this.state.pool = models
    this.state.lastSyncAt = now
    delete this.state.lastSyncError
    this.scheduleWrite()
  }

  setSyncError(message: string): void {
    this.state.lastSyncError = redactSecrets(message).slice(0, 500)
    this.scheduleWrite()
  }

  /** Sticky model of one session, when the binding is still fresh. */
  sessionModel(sessionId: string, now = Date.now()): SessionBinding | undefined {
    const binding = this.state.sessions[sessionId]
    if (binding === undefined) return undefined
    if (binding.at > 0 && now - binding.at > SESSION_TTL_MS) {
      delete this.state.sessions[sessionId]
      return undefined
    }
    return binding
  }

  /** Pin (or refresh) the model of one session and count the served turn. */
  bindSession(sessionId: string, model: string, task?: string, now = Date.now()): SessionBinding {
    const binding = this.state.sessions[sessionId] ?? { model, at: now, turns: 0 }
    binding.model = model
    binding.at = now
    binding.turns += 1
    if (task !== undefined) binding.task = task
    this.state.sessions[sessionId] = binding
    const ids = Object.keys(this.state.sessions)
    if (ids.length > MAX_SESSIONS) {
      ids
        .sort((a, b) => (this.state.sessions[a]?.at ?? 0) - (this.state.sessions[b]?.at ?? 0))
        .slice(0, ids.length - MAX_SESSIONS)
        .forEach((id) => { delete this.state.sessions[id] })
    }
    this.scheduleWrite()
    return binding
  }

  /** Forget one session binding (stale or failed model). */
  dropSession(sessionId: string): void {
    if (this.state.sessions[sessionId] !== undefined) {
      delete this.state.sessions[sessionId]
      this.scheduleWrite()
    }
  }

  /** Record one routed call and its token use for balancing. */
  recordUsage(task: string, model: string, tokens: number, now = Date.now()): void {
    const row = this.state.usage[task] ??= {}
    const entry = row[model] ??= { calls: 0, tokens: 0, lastAt: 0 }
    entry.calls += 1
    entry.tokens += Math.max(0, Math.round(tokens))
    entry.lastAt = now
    const total = this.state.modelTotals[model] ??= { calls: 0, tokens: 0 }
    total.calls += 1
    total.tokens += Math.max(0, Math.round(tokens))
    this.scheduleWrite()
  }

  /**
   * Decayed usage of one model inside one task, used to rotate load.
   * Entries older than the window contribute nothing, so the balancing state
   * follows "recent" consumption rather than a lifetime total.
   */
  recentUsage(task: string, model: string, windowMs: number, now = Date.now()): UsageEntry {
    const entry = this.state.usage[task]?.[model]
    if (entry === undefined) return { calls: 0, tokens: 0, lastAt: 0 }
    if (now - entry.lastAt > windowMs) return { calls: 0, tokens: 0, lastAt: entry.lastAt }
    return entry
  }

  /** Per-model lifetime usage, for configured limits. */
  modelTotalsOf(model: string): { calls: number; tokens: number } {
    return this.state.modelTotals[model] ?? { calls: 0, tokens: 0 }
  }

  /**
   * Whether one model is still inside its configured limit. A model without a
   * limit, or whose limit fields are all unset, is always within limit.
   * @param model - model id.
   * @param limits - `Record<model, { maxCalls?, maxTokens? }>`.
   */
  withinLimit(model: string, limits: Readonly<Record<string, { maxCalls?: number; maxTokens?: number }>>): boolean {
    const limit = limits[model]
    if (limit === undefined) return true
    const total = this.modelTotalsOf(model)
    if (typeof limit.maxCalls === 'number' && total.calls >= limit.maxCalls) return false
    if (typeof limit.maxTokens === 'number' && total.tokens >= limit.maxTokens) return false
    return true
  }

  /** Clear one model's lifetime usage, or every model's when omitted. */
  resetModelTotals(model?: string): void {
    if (model === undefined) this.state.modelTotals = {}
    else delete this.state.modelTotals[model]
    this.scheduleWrite()
  }

  /** Ledger of one key, created on demand (empty = brand-new key). */
  ledgerOf(keyId: string, meta?: { label?: string; providerId?: string; baseURL?: string }): KeyLedger {
    const existing = this.state.ledgers[keyId]
    if (existing !== undefined) {
      // Display names can change after the ledger was first created (account
      // rename, provider switch); keep the ledger's label human-readable.
      if (meta?.label !== undefined && existing.label !== meta.label) {
        existing.label = meta.label
        this.scheduleWrite()
      }
      return existing
    }
    const ledger: KeyLedger = {
      keyId,
      label: meta?.label ?? keyId,
      ...(meta?.providerId === undefined ? {} : { providerId: meta.providerId }),
      baseURL: meta?.baseURL ?? '',
      updatedAt: Date.now(),
      models: {},
      totalTokens: 0,
      cycle: 0,
    }
    this.state.ledgers[keyId] = ledger
    this.touchKey(keyId)
    this.scheduleWrite()
    return ledger
  }

  /** Charge execution tokens to one key's ledger and its current bucket. */
  recordLedgerTokens(keyId: string, model: string, tokens: number, now = Date.now()): void {
    const ledger = this.ledgerOf(keyId)
    const entry = ledger.models[model] ??= { tokens: 0, calls: 0, bucketTokens: 0, bucketStartedAt: now, lastUsedAt: 0 }
    const amount = Math.max(0, Math.round(tokens))
    entry.tokens += amount
    entry.calls += 1
    entry.bucketTokens += amount
    entry.lastUsedAt = now
    ledger.totalTokens += amount
    ledger.updatedAt = now
    this.touchKey(keyId)
    this.scheduleWrite()
  }

  /** Reset one model's bucket, or every bucket of a key (new rotation cycle). */
  resetBucket(keyId: string, model?: string): void {
    const ledger = this.state.ledgers[keyId]
    if (ledger === undefined) return
    if (model === undefined) {
      for (const entry of Object.values(ledger.models)) {
        entry.bucketTokens = 0
        entry.bucketStartedAt = Date.now()
      }
      ledger.cycle += 1
    } else {
      const entry = ledger.models[model]
      if (entry !== undefined) {
        entry.bucketTokens = 0
        entry.bucketStartedAt = Date.now()
      }
    }
    ledger.updatedAt = Date.now()
    this.scheduleWrite()
  }

  /** Move a key to the front of the recency list. */
  private touchKey(keyId: string): void {
    this.state.keyHistory = [keyId, ...this.state.keyHistory.filter(id => id !== keyId)].slice(0, 50)
  }

  /** Remember that a model rejected image input. */
  vetoVision(model: string, now = Date.now()): void {
    this.state.visionVeto[model] = now
    delete this.state.visionOk[model]
    this.scheduleWrite()
  }

  /** Remember that a model accepted image input. */
  confirmVision(model: string, now = Date.now()): void {
    this.state.visionOk[model] = now
    delete this.state.visionVeto[model]
    this.scheduleWrite()
  }

  /** Whether the provider has proven this model cannot read images. */
  visionVetoed(model: string): boolean {
    return this.state.visionVeto[model] !== undefined
  }

  /** Whether the provider has proven this model reads images. */
  visionConfirmed(model: string): boolean {
    return this.state.visionOk[model] !== undefined
  }

  /** Remember that a model rejects the reasoning-effort parameter. */
  markEffortUnsupported(model: string, now = Date.now()): void {
    this.state.effortUnsupported[model] = now
    this.scheduleWrite()
  }

  /** Whether a reasoning-effort parameter must be omitted for this model. */
  effortUnsupported(model: string): boolean {
    return this.state.effortUnsupported[model] !== undefined
  }

  /** Debounced atomic persistence. */
  scheduleWrite(): void {
    if (this.disposed || this.writeTimer !== undefined) return
    this.writeTimer = setTimeout(() => {
      this.writeTimer = undefined
      this.writing = this.flush()
    }, 400)
    this.writeTimer.unref?.()
  }

  /** Write immediately and wait for completion. */
  async flush(): Promise<void> {
    if (this.writeTimer !== undefined) {
      clearTimeout(this.writeTimer)
      this.writeTimer = undefined
    }
    const tmp = join(dirname(this.file), `.state-${process.pid}-${Date.now()}.tmp`)
    try {
      await mkdir(dirname(this.file), { recursive: true })
      await writeFile(tmp, JSON.stringify(this.state, null, 2), 'utf8')
      await rename(tmp, this.file)
    } catch (error) {
      const code = (error as NodeJS.ErrnoException)?.code
      if (code !== 'ENOENT') {
        console.warn(`[dsh-auto-router] state write failed: ${String((error as Error)?.message ?? error)}`)
      }
    }
  }

  /** Stop timers and persist one final time. */
  async dispose(): Promise<void> {
    this.disposed = true
    if (this.writeTimer !== undefined) {
      clearTimeout(this.writeTimer)
      this.writeTimer = undefined
    }
    await this.writing.catch(() => {})
    await this.flush()
  }
}
