/**
 * Persisted user preferences (0.8.0).
 *
 * Every host config field is `.volatile()`: the loader never serializes those
 * values, so panel edits (sort order, active account, connection renames,
 * per-model limits, saved accounts...) used to vanish on every host restart.
 * This module keeps a plugin-owned `prefs.json` next to `state.json`, writes
 * the resulting config record on every successful panel edit, and re-hydrates
 * the live volatile refs at activation so user choices survive restarts.
 *
 * Trust note: `prefs.json` lives in the user's DSH home and may contain saved
 * account API keys — the same trust level as the profile config itself. It is
 * never logged, never sent over RPC, and never merged into `state.json`.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

/** Config keys whose user edits survive restarts (the whole panel surface). */
export const PREFS_KEYS = [
  'baseURL', 'vendor', 'apiKeyEnv', 'enableDecision', 'decisionModel', 'decisionTimeoutMs',
  'decisionInputMaxChars', 'fallbackModel', 'maxAttempts', 'quotaCooldownMinutes',
  'rateLimitCooldownSeconds', 'streamIdleTimeoutMs', 'autoSyncPool', 'poolSyncIntervalHours',
  'adoptProfileProvider', 'maxCandidatesForDecision', 'includeSpecialEndpoints', 'excludeModels',
  'balanceStrategy', 'sortStrategy', 'bucketTokens', 'bucketTolerance', 'balanceWindow',
  'balanceBand', 'balanceWindowHours', 'thinkingEffort', 'enableMediaRouting', 'stickySession',
  'sessionTurnLimit', 'taskRoutes', 'models', 'accounts', 'activeAccountId', 'modelLimits',
  'connectionNames',
] as const

/** Saved preference record (subset of the config surface). */
export type Prefs = Record<string, unknown>

/** Shared volatile write protocol (cosmokit); refs are frozen get/write pairs. */
const WRITE = Symbol.for('cosmokit.volatile.write')

/** Read prefs; missing or corrupt file yields an empty record (never throws). */
export function loadPrefs(file: string): Prefs {
  try {
    if (!existsSync(file)) return {}
    const raw = JSON.parse(readFileSync(file, 'utf8')) as unknown
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return {}
    const out: Prefs = {}
    for (const key of PREFS_KEYS) {
      if (key in (raw as Record<string, unknown>)) out[key] = (raw as Record<string, unknown>)[key]
    }
    return out
  } catch {
    return {}
  }
}

/** Merge one config record into prefs (known keys only), atomically. */
export function savePrefs(file: string, record: Prefs): void {
  const next: Prefs = { ...loadPrefs(file) }
  for (const key of PREFS_KEYS) {
    if (key in record && record[key] !== undefined) next[key] = record[key]
  }
  const tmp = join(dirname(file), `.prefs-${process.pid}-${Date.now()}.tmp`)
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(tmp, JSON.stringify(next, null, 2), 'utf8')
  renameSync(tmp, file)
}

/**
 * Write saved prefs back into the live config (volatile refs via the shared
 * write symbol, plain values by assignment). Returns a rollback that restores
 * the pre-hydration values, used when hydrated prefs fail validation.
 */
export function hydrateConfig(config: Record<string, any>, prefs: Prefs): () => void {
  const undo: Array<() => void> = []
  for (const key of PREFS_KEYS) {
    if (!(key in prefs) || !(key in config)) continue
    const ref = config[key]
    const value = prefs[key]
    if (ref !== null && typeof ref === 'object' && typeof ref[WRITE] === 'function') {
      const old = ref.get()
      ref[WRITE](value)
      undo.push(() => ref[WRITE](old))
    } else if (typeof ref?.get !== 'function') {
      const old = config[key]
      config[key] = value
      undo.push(() => { config[key] = old })
    }
  }
  return () => { for (const fn of undo.reverse()) fn() }
}