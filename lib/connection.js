import { isRoutableEndpoint } from './vendors.js';
/** Cache window: the profile rarely changes while a session runs. */
const CACHE_MS = 60_000;
let cache;
function asRecord(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
        ? value : undefined;
}
/** Read every connection candidate from one plugin entry config. */
function connectionsOf(entryId, config) {
    const found = [];
    const providers = asRecord(config.providers);
    if (providers !== undefined) {
        for (const [providerId, raw] of Object.entries(providers)) {
            const profile = asRecord(raw);
            const baseURL = typeof profile?.baseURL === 'string' ? profile.baseURL : undefined;
            if (baseURL === undefined || !isRoutableEndpoint(baseURL))
                continue;
            found.push({
                entryId,
                providerId,
                baseURL: baseURL.replace(/\/+$/, ''),
                ...(typeof profile?.apiKeyEnv === 'string' ? { apiKeyEnv: profile.apiKeyEnv } : {}),
            });
        }
    }
    // A flat harness-owned provider profile (for example a dedicated Bailian row).
    const baseURL = typeof config.baseURL === 'string' ? config.baseURL : undefined;
    if (baseURL !== undefined && isRoutableEndpoint(baseURL)) {
        found.push({
            entryId,
            providerId: entryId,
            baseURL: baseURL.replace(/\/+$/, ''),
            ...(typeof config.apiKeyEnv === 'string' ? { apiKeyEnv: config.apiKeyEnv } : {}),
        });
    }
    return found;
}
/**
 * Find the best Aliyun-compatible connection already configured in this
 * profile. Prefers entries that also name a credential reference.
 * @param ctx - host context providing the optional `configEditor` surface.
 * @returns the chosen connection, or `undefined` when the profile has none.
 */
export function discoverConnection(ctx) {
    const now = Date.now();
    if (cache !== undefined && now - cache.at < CACHE_MS)
        return cache.value;
    const editor = ctx.get('configEditor');
    let value;
    if (editor !== undefined && typeof editor.configuration === 'function') {
        const candidates = [];
        try {
            for (const row of editor.configuration()) {
                const entryId = String(row.entry?.options?.id ?? '');
                const config = asRecord(row.inherited) ?? {};
                const override = asRecord(row.override) ?? {};
                candidates.push(...connectionsOf(entryId, { ...config, ...override }));
            }
        }
        catch (_unreadableProfile) {
            // A profile that cannot be enumerated simply yields no candidate.
        }
        value = candidates.find(candidate => candidate.apiKeyEnv !== undefined) ?? candidates[0];
    }
    cache = { at: now, value };
    return value;
}
/** Drop the discovery cache so the next read re-enumerates the profile. */
export function invalidateConnectionCache() {
    cache = undefined;
}
/** Every Aliyun-compatible connection in the profile, for the settings panel. */
export function listConnections(ctx) {
    const editor = ctx.get('configEditor');
    if (editor === undefined || typeof editor.configuration !== 'function')
        return [];
    const found = [];
    try {
        for (const row of editor.configuration()) {
            const entryId = String(row.entry?.options?.id ?? '');
            const config = asRecord(row.inherited) ?? {};
            const override = asRecord(row.override) ?? {};
            found.push(...connectionsOf(entryId, { ...config, ...override }));
        }
    }
    catch (_unreadableProfile) {
        return [];
    }
    return found;
}
