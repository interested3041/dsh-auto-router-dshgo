/**
 * Zero-configuration connection discovery.
 *
 * Users almost always already have an OpenAI-compatible provider pointing at
 * Aliyun (Bailian / DashScope / a workspace endpoint) configured through
 * `llm-pi-ai`. Rather than asking them to retype the endpoint and credential
 * reference, the router reads the profile's own plugin configurations through
 * the `configEditor` service and reuses that connection while its own
 * `baseURL` / `apiKeyEnv` still hold the shipped defaults.
 *
 * This is read-only: nothing is written to any other plugin's configuration,
 * and an explicit value in this plugin's Config always wins.
 */
import type { ConfigEditorLike, HostContext } from './context.js'
import { isRoutableEndpoint } from './vendors.js'

/** One discovered OpenAI-compatible connection (any supported vendor). */
export interface DiscoveredConnection {
  /** Profile plugin entry that supplies it, for display. */
  entryId: string
  /** Provider key inside that plugin's `providers` dictionary. */
  providerId: string
  baseURL: string
  apiKeyEnv?: string
}

/** Cache window: the profile rarely changes while a session runs. */
const CACHE_MS = 60_000

let cache: { at: number; value: DiscoveredConnection | undefined } | undefined

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown> : undefined
}

/** Read every connection candidate from one plugin entry config. */
function connectionsOf(entryId: string, config: Record<string, unknown>): DiscoveredConnection[] {
  const found: DiscoveredConnection[] = []
  const providers = asRecord(config.providers)
  if (providers !== undefined) {
    for (const [providerId, raw] of Object.entries(providers)) {
      const profile = asRecord(raw)
      const baseURL = typeof profile?.baseURL === 'string' ? profile.baseURL : undefined
      if (baseURL === undefined || !isRoutableEndpoint(baseURL)) continue
      found.push({
        entryId,
        providerId,
        baseURL: baseURL.replace(/\/+$/, ''),
        ...(typeof profile?.apiKeyEnv === 'string' ? { apiKeyEnv: profile.apiKeyEnv } : {}),
      })
    }
  }
  // A flat harness-owned provider profile (for example a dedicated Bailian row).
  const baseURL = typeof config.baseURL === 'string' ? config.baseURL : undefined
  if (baseURL !== undefined && isRoutableEndpoint(baseURL)) {
    found.push({
      entryId,
      providerId: entryId,
      baseURL: baseURL.replace(/\/+$/, ''),
      ...(typeof config.apiKeyEnv === 'string' ? { apiKeyEnv: config.apiKeyEnv } : {}),
    })
  }
  return found
}

/**
 * Find the best Aliyun-compatible connection already configured in this
 * profile. Prefers entries that also name a credential reference.
 * @param ctx - host context providing the optional `configEditor` surface.
 * @returns the chosen connection, or `undefined` when the profile has none.
 */
export function discoverConnection(ctx: HostContext): DiscoveredConnection | undefined {
  const now = Date.now()
  if (cache !== undefined && now - cache.at < CACHE_MS) return cache.value
  const editor: ConfigEditorLike | undefined = ctx.get('configEditor')
  let value: DiscoveredConnection | undefined
  if (editor !== undefined && typeof editor.configuration === 'function') {
    const candidates: DiscoveredConnection[] = []
    try {
      for (const row of editor.configuration()) {
        const entryId = String((row.entry as { options?: { id?: string } })?.options?.id ?? '')
        const config = asRecord(row.inherited) ?? {}
        const override = asRecord(row.override) ?? {}
        candidates.push(...connectionsOf(entryId, { ...config, ...override }))
      }
    } catch (_unreadableProfile) {
      // A profile that cannot be enumerated simply yields no candidate.
    }
    value = candidates.find(candidate => candidate.apiKeyEnv !== undefined) ?? candidates[0]
  }
  cache = { at: now, value }
  return value
}

/** Drop the discovery cache so the next read re-enumerates the profile. */
export function invalidateConnectionCache(): void {
  cache = undefined
}

/** Every Aliyun-compatible connection in the profile, for the settings panel. */
export function listConnections(ctx: HostContext): DiscoveredConnection[] {
  const editor: ConfigEditorLike | undefined = ctx.get('configEditor')
  if (editor === undefined || typeof editor.configuration !== 'function') return []
  const found: DiscoveredConnection[] = []
  try {
    for (const row of editor.configuration()) {
      const entryId = String((row.entry as { options?: { id?: string } })?.options?.id ?? '')
      const config = asRecord(row.inherited) ?? {}
      const override = asRecord(row.override) ?? {}
      found.push(...connectionsOf(entryId, { ...config, ...override }))
    }
  } catch (_unreadableProfile) {
    return []
  }
  return found
}