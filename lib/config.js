/**
 * Plugin Config schema (schemastery) plus per-request resolution.
 *
 * Every field is `.volatile()` so the settings panel can edit it in place
 * through the config editor without reloading the plugin; `resolveOptions()`
 * re-validates values on each capture because volatile updates bypass schema
 * validation.
 */
import z from '@deepseek-ai/schemastery';
import { API_KEY_REFS, BUILTIN_CATALOG, DEFAULT_API_KEY_ENV, DEFAULT_BASE_URL, DEFAULT_DECISION_MODEL, DEFAULT_FALLBACK_MODEL, DEFAULT_TASK_ROUTES, PROVIDER, TASK_TYPES, VIRTUAL_MODEL, } from './catalog.js';
import { vendorKeyRefs } from './vendors.js';
const taskRoutesSchema = z.object(Object.fromEntries(TASK_TYPES.map(task => [task, z.array(z.string()).default([...DEFAULT_TASK_ROUTES[task]])])));
const modelSchema = z.object({
    id: z.string().required(),
    name: z.string(),
    vision: z.boolean().default(false),
    contextWindow: z.number().step(1).min(1),
    maxTokens: z.number().step(1).min(1),
    tags: z.array(z.union(TASK_TYPES.map(task => z.const(task)))).default([]),
});
const accountSchema = z.object({
    id: z.string().required(),
    name: z.string().required(),
    baseURL: z.string().required(),
    apiKey: z.string().role('secret'),
    apiKeyEnv: z.string().role('credential-ref'),
    providerId: z.string(),
    vendor: z.union(['auto', 'bailian', 'siliconflow', 'openrouter', 'volcengine', 'zhipu', 'moonshot', 'deepseek', 'generic']),
});
/** Loader-validated plugin configuration schema. */
export const Config = z.object({
    baseURL: z.string().default(DEFAULT_BASE_URL).volatile(),
    vendor: z.union(['auto', 'bailian', 'siliconflow', 'openrouter', 'volcengine', 'zhipu', 'moonshot', 'deepseek', 'generic']).default('auto').volatile(),
    apiKeyEnv: z.string().role('credential-ref').default(DEFAULT_API_KEY_ENV).volatile(),
    enableDecision: z.boolean().default(true).volatile(),
    decisionModel: z.string().default(DEFAULT_DECISION_MODEL).volatile(),
    decisionTimeoutMs: z.number().step(1).min(1000).max(120000).default(12000).volatile(),
    decisionInputMaxChars: z.number().step(1).min(200).max(32000).default(6000).volatile(),
    fallbackModel: z.string().default(DEFAULT_FALLBACK_MODEL).volatile(),
    maxAttempts: z.number().step(1).min(1).max(10).default(4).volatile(),
    quotaCooldownMinutes: z.number().step(1).min(1).max(10080).default(30).volatile(),
    rateLimitCooldownSeconds: z.number().step(1).min(5).max(3600).default(120).volatile(),
    streamIdleTimeoutMs: z.number().step(1).min(5000).max(600000).default(180000).volatile(),
    autoSyncPool: z.boolean().default(true).volatile(),
    poolSyncIntervalHours: z.number().min(0).max(168).default(24).volatile(),
    adoptProfileProvider: z.boolean().default(true).volatile(),
    maxCandidatesForDecision: z.number().step(1).min(1).max(60).default(14).volatile(),
    includeSpecialEndpoints: z.boolean().default(false).volatile(),
    excludeModels: z.array(z.string()).default([]).volatile(),
    balanceStrategy: z.union(['balanced', 'quality']).default('balanced').volatile(),
    sortStrategy: z.union(['auto', 'price', 'capability', 'speed', 'free_quota']).default('auto').volatile(),
    bucketTokens: z.number().step(1000).min(1000).max(100_000_000).default(1_000_000).volatile(),
    bucketTolerance: z.number().min(0).max(0.5).default(0.05).volatile(),
    balanceWindow: z.number().step(1).min(1).max(20).default(6).volatile(),
    balanceBand: z.number().min(0).max(60).default(0).volatile(),
    balanceWindowHours: z.number().step(1).min(1).max(720).default(24).volatile(),
    thinkingEffort: z.union(['auto', 'off', 'low', 'medium', 'high', 'max']).default('auto').volatile(),
    enableMediaRouting: z.boolean().default(true).volatile(),
    stickySession: z.boolean().default(true).volatile(),
    sessionTurnLimit: z.number().step(1).min(1).max(200).default(50).volatile(),
    taskRoutes: taskRoutesSchema.volatile(),
    models: z.array(modelSchema).default([]).volatile(),
    accounts: z.array(accountSchema).default([]).volatile(),
    activeAccountId: z.string().default('').volatile(),
    modelLimits: z.dict(z.object({
        maxCalls: z.number().step(1).min(1),
        maxTokens: z.number().step(1).min(1),
    })).default({}).volatile(),
    connectionNames: z.dict(z.string()).default({}).volatile(),
});
/** Unwrap volatile references (tolerates plain values from programmatic use). */
function plain(value) {
    return typeof value?.get === 'function' ? value.get() : value;
}
function positiveInt(value, fallback, min = 1) {
    return Number.isSafeInteger(value) && value >= min ? value : fallback;
}
/**
 * Normalize the per-model usage limits into a detached record. Invalid entries
 * are dropped rather than failing the whole config load.
 * @param raw - whatever the config held (Volatile-unwrapped).
 */
function resolveModelLimits(raw) {
    const out = {};
    if (typeof raw !== 'object' || raw === null)
        return out;
    for (const [model, value] of Object.entries(raw)) {
        if (typeof value !== 'object' || value === null)
            continue;
        const entry = value;
        const maxCalls = Number(entry.maxCalls);
        const maxTokens = Number(entry.maxTokens);
        const callsOk = Number.isSafeInteger(maxCalls) && maxCalls >= 1;
        const tokensOk = Number.isSafeInteger(maxTokens) && maxTokens >= 1;
        if (!callsOk && !tokensOk)
            continue;
        // 0.7.1: the pre-0.7.1 UI wrote raw tokens; tiny values (<1000) were meant
        // as 万 (10k) tokens by users. Migrate them so a "100" cap becomes 1M.
        const migratedTokens = tokensOk && maxTokens < 1000 ? maxTokens * 10_000 : maxTokens;
        out[model] = {
            ...(callsOk ? { maxCalls } : {}),
            ...(tokensOk ? { maxTokens: migratedTokens } : {}),
        };
    }
    return out;
}
/**
 * Read and re-validate one configuration generation. Volatile updates reach
 * this resolver without schema validation, so bounds are re-judged here.
 * @param config - live plugin configuration.
 * @returns a detached settings snapshot.
 */
export function resolveOptions(config) {
    const baseURL = String(plain(config.baseURL) || DEFAULT_BASE_URL).replace(/\/+$/, '');
    const parsed = new URL(baseURL);
    if (!['http:', 'https:'].includes(parsed.protocol)) {
        throw new Error(`${PROVIDER}: baseURL must be an HTTP(S) endpoint`);
    }
    const taskRoutesRaw = plain(config.taskRoutes) ?? {};
    const taskRoutes = {};
    for (const task of TASK_TYPES) {
        const list = taskRoutesRaw[task];
        taskRoutes[task] = Array.isArray(list)
            ? [...new Set(list.filter((id) => typeof id === 'string' && id.trim().length > 0).map(id => id.trim()))]
            : [...DEFAULT_TASK_ROUTES[task]];
        if (taskRoutes[task].length === 0)
            taskRoutes[task] = [...DEFAULT_TASK_ROUTES[task]];
    }
    const modelsRaw = plain(config.models) ?? [];
    const models = [];
    const seen = new Set();
    for (const entry of Array.isArray(modelsRaw) ? modelsRaw : []) {
        const id = typeof entry?.id === 'string' ? entry.id.trim() : '';
        if (id.length === 0 || id === VIRTUAL_MODEL || seen.has(id))
            continue;
        seen.add(id);
        models.push({
            id,
            ...(typeof entry.name === 'string' && entry.name.trim() ? { name: entry.name.trim() } : {}),
            vision: entry.vision === true || (entry.vision === undefined ? undefined : false),
            ...(positiveInt(Number(entry.contextWindow), 0) > 0 ? { contextWindow: Number(entry.contextWindow) } : {}),
            ...(positiveInt(Number(entry.maxTokens), 0) > 0 ? { maxTokens: Number(entry.maxTokens) } : {}),
            ...(Array.isArray(entry.tags) ? { tags: entry.tags.filter((tag) => TASK_TYPES.includes(tag)) } : {}),
        });
    }
    const apiKeyEnv = String(plain(config.apiKeyEnv) || DEFAULT_API_KEY_ENV).trim();
    const accountsRaw = plain(config.accounts) ?? [];
    const accounts = [];
    const seenAccount = new Set();
    for (const entry of Array.isArray(accountsRaw) ? accountsRaw : []) {
        const id = typeof entry?.id === 'string' ? entry.id.trim() : '';
        const name = typeof entry?.name === 'string' ? entry.name.trim() : '';
        const base = typeof entry?.baseURL === 'string' ? entry.baseURL.trim().replace(/\/+$/, '') : '';
        if (id.length === 0 || name.length === 0 || base.length === 0 || seenAccount.has(id))
            continue;
        let parsedBase;
        try {
            parsedBase = new URL(base);
        }
        catch (_invalidEndpoint) {
            continue;
        }
        if (!['http:', 'https:'].includes(parsedBase.protocol))
            continue;
        seenAccount.add(id);
        const apiKey = typeof entry.apiKey === 'string' && entry.apiKey.trim().length > 0 ? entry.apiKey.trim() : undefined;
        const ref = typeof entry.apiKeyEnv === 'string' && entry.apiKeyEnv.trim().length > 0 ? entry.apiKeyEnv.trim() : undefined;
        const providerId = typeof entry.providerId === 'string' && entry.providerId.trim().length > 0 ? entry.providerId.trim() : undefined;
        const accountVendor = ['auto', 'bailian', 'siliconflow', 'openrouter', 'volcengine', 'zhipu', 'moonshot', 'deepseek', 'generic']
            .find(value => value === entry.vendor);
        accounts.push({
            id, name, baseURL: base,
            ...(apiKey === undefined ? {} : { apiKey }),
            ...(ref === undefined ? {} : { apiKeyEnv: ref }),
            ...(providerId === undefined ? {} : { providerId }),
            ...(accountVendor === undefined ? {} : { vendor: accountVendor }),
        });
    }
    const activeAccountId = String(plain(config.activeAccountId) ?? '').trim();
    const vendor = ['auto', 'bailian', 'siliconflow', 'openrouter', 'volcengine', 'zhipu', 'moonshot', 'deepseek', 'generic']
        .find(value => value === plain(config.vendor)) ?? 'auto';
    return {
        baseURL,
        vendor,
        apiKeyEnv,
        apiKeyRefs: [...new Set([apiKeyEnv, ...vendorKeyRefs(vendor, baseURL), ...API_KEY_REFS])],
        enableDecision: plain(config.enableDecision) !== false,
        decisionModel: String(plain(config.decisionModel) || DEFAULT_DECISION_MODEL).trim(),
        decisionTimeoutMs: positiveInt(Number(plain(config.decisionTimeoutMs)), 12000, 1000),
        decisionInputMaxChars: positiveInt(Number(plain(config.decisionInputMaxChars)), 6000, 200),
        fallbackModel: String(plain(config.fallbackModel) || DEFAULT_FALLBACK_MODEL).trim(),
        maxAttempts: positiveInt(Number(plain(config.maxAttempts)), 4, 1),
        quotaCooldownMs: positiveInt(Number(plain(config.quotaCooldownMinutes)), 30) * 60_000,
        rateLimitCooldownMs: positiveInt(Number(plain(config.rateLimitCooldownSeconds)), 120, 5) * 1000,
        streamIdleTimeoutMs: positiveInt(Number(plain(config.streamIdleTimeoutMs)), 180000, 5000),
        autoSyncPool: plain(config.autoSyncPool) !== false,
        poolSyncIntervalHours: Math.max(0, Math.min(168, Number(plain(config.poolSyncIntervalHours)) || 0)),
        adoptProfileProvider: plain(config.adoptProfileProvider) !== false,
        maxCandidatesForDecision: positiveInt(Number(plain(config.maxCandidatesForDecision)), 14, 1),
        includeSpecialEndpoints: plain(config.includeSpecialEndpoints) === true,
        excludeModels: (Array.isArray(plain(config.excludeModels)) ? plain(config.excludeModels) : [])
            .filter((pattern) => typeof pattern === 'string' && pattern.trim().length > 0)
            .map(pattern => pattern.trim()),
        balanceStrategy: plain(config.balanceStrategy) === 'quality' ? 'quality' : 'balanced',
        sortStrategy: ['auto', 'price', 'capability', 'speed', 'free_quota']
            .find(value => value === plain(config.sortStrategy)) ?? 'auto',
        bucketTokens: positiveInt(Number(plain(config.bucketTokens)), 1_000_000, 1000),
        bucketTolerance: Math.max(0, Math.min(0.5, Number(plain(config.bucketTolerance)) || 0.05)),
        balanceWindow: positiveInt(Number(plain(config.balanceWindow)), 6, 1),
        balanceBand: Math.max(0, Math.min(60, Number(plain(config.balanceBand)) || 0)),
        balanceWindowHours: positiveInt(Number(plain(config.balanceWindowHours)), 24, 1),
        thinkingEffort: ['auto', 'off', 'low', 'medium', 'high', 'max']
            .find(value => value === plain(config.thinkingEffort)) ?? 'auto',
        enableMediaRouting: plain(config.enableMediaRouting) !== false,
        stickySession: plain(config.stickySession) !== false,
        sessionTurnLimit: positiveInt(Number(plain(config.sessionTurnLimit)), 50, 1),
        taskRoutes,
        models,
        accounts,
        activeAccountId: accounts.some(account => account.id === activeAccountId) ? activeAccountId : '',
        modelLimits: resolveModelLimits(plain(config.modelLimits)),
        connectionNames: resolveConnectionNames(plain(config.connectionNames)),
    };
}
/** Keep only non-empty string names; anything else is dropped. */
function resolveConnectionNames(raw) {
    const out = {};
    if (typeof raw !== 'object' || raw === null)
        return out;
    for (const [key, value] of Object.entries(raw)) {
        if (typeof value === 'string' && value.trim() !== '')
            out[key] = value.trim();
    }
    return out;
}
/**
 * Merge built-in catalog and user pool entries; user entries win per id.
 * @param options - resolved settings snapshot.
 * @returns catalog entries keyed by model id.
 */
export function mergedCatalog(options) {
    const merged = new Map();
    for (const entry of BUILTIN_CATALOG)
        merged.set(entry.id, entry);
    for (const entry of options.models) {
        merged.set(entry.id, {
            id: entry.id,
            name: entry.name ?? entry.id,
            vision: entry.vision ?? false,
            ...(entry.contextWindow === undefined ? {} : { contextWindow: entry.contextWindow }),
            ...(entry.tags === undefined ? {} : { tags: entry.tags }),
        });
    }
    return merged;
}
