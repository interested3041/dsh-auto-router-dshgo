/**
 * The `bailianRouter` RPC service consumed by the Web panel through the
 * Typert gateway: state reads, configuration edits (persisted through the
 * harness config editor), pool sync, and quota resets.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TASK_TYPES } from './catalog.js';
import { thinkingDispatch } from './classify.js';
import { invalidateConnectionCache, listConnections } from './connection.js';
import { accountKeyId, connectionLabel, dedupeConnections, resolveKeyId } from './identity.js';
import { priceOf } from './strategy.js';
import { BailianClient } from './http.js';
import { apiKeyConfigured, resolveApiKey } from './router.js';
/** Fields the panel may edit, with light type guards before persistence. */
const STRING_FIELDS = ['baseURL', 'apiKeyEnv', 'decisionModel', 'fallbackModel'];
const BOOL_FIELDS = ['enableDecision', 'autoSyncPool', 'includeSpecialEndpoints', 'enableMediaRouting'];
const NUMBER_FIELDS = [
    'decisionTimeoutMs', 'decisionInputMaxChars', 'maxAttempts', 'quotaCooldownMinutes',
    'rateLimitCooldownSeconds', 'streamIdleTimeoutMs', 'poolSyncIntervalHours', 'maxCandidatesForDecision',
    'balanceWindow', 'balanceBand', 'balanceWindowHours',
];
/** Sanitize one incoming patch; throws on unusable values. */
function sanitizePatch(patch) {
    if (typeof patch !== 'object' || patch === null)
        throw new Error('patch must be an object');
    const input = patch;
    const out = {};
    for (const field of STRING_FIELDS) {
        const value = input[field];
        if (value === undefined)
            continue;
        if (typeof value !== 'string' || value.trim().length === 0)
            throw new Error(`${field} must be a non-empty string`);
        out[field] = value.trim();
    }
    for (const field of BOOL_FIELDS) {
        const value = input[field];
        if (value === undefined)
            continue;
        if (typeof value !== 'boolean')
            throw new Error(`${field} must be a boolean`);
        out[field] = value;
    }
    for (const field of NUMBER_FIELDS) {
        const value = input[field];
        if (value === undefined)
            continue;
        if (typeof value !== 'number' || !Number.isFinite(value) || value < 0)
            throw new Error(`${field} must be a non-negative number`);
        out[field] = Math.round(value);
    }
    if (input.balanceStrategy !== undefined) {
        if (input.balanceStrategy !== 'balanced' && input.balanceStrategy !== 'quality') {
            throw new Error('balanceStrategy must be "balanced" or "quality"');
        }
        out.balanceStrategy = input.balanceStrategy;
    }
    if (input.thinkingEffort !== undefined) {
        const allowed = ['auto', 'off', 'low', 'medium', 'high', 'max'];
        if (!allowed.includes(input.thinkingEffort)) {
            throw new Error(`thinkingEffort must be one of ${allowed.join(', ')}`);
        }
        out.thinkingEffort = input.thinkingEffort;
    }
    if (input.vendor !== undefined) {
        const allowed = ['auto', 'bailian', 'siliconflow', 'openrouter', 'volcengine', 'zhipu', 'moonshot', 'deepseek', 'generic'];
        if (!allowed.includes(input.vendor)) {
            throw new Error(`vendor must be one of ${allowed.join(', ')}`);
        }
        out.vendor = input.vendor;
    }
    if (input.sortStrategy !== undefined) {
        const allowed = ['auto', 'price', 'capability', 'speed', 'free_quota'];
        if (!allowed.includes(input.sortStrategy)) {
            throw new Error(`sortStrategy must be one of ${allowed.join(', ')}`);
        }
        out.sortStrategy = input.sortStrategy;
    }
    if (input.bucketTokens !== undefined) {
        if (typeof input.bucketTokens !== 'number' || !Number.isFinite(input.bucketTokens) || input.bucketTokens < 1000) {
            throw new Error('bucketTokens must be a number >= 1000');
        }
        out.bucketTokens = Math.round(input.bucketTokens);
    }
    if (input.bucketTolerance !== undefined) {
        if (typeof input.bucketTolerance !== 'number' || !Number.isFinite(input.bucketTolerance) || input.bucketTolerance < 0 || input.bucketTolerance > 0.5) {
            throw new Error('bucketTolerance must be between 0 and 0.5');
        }
        out.bucketTolerance = input.bucketTolerance;
    }
    if (input.modelLimits !== undefined) {
        const limits = input.modelLimits;
        if (typeof limits !== 'object' || limits === null || Array.isArray(limits)) {
            throw new Error('modelLimits must be an object mapping model id -> { maxCalls?, maxTokens? }');
        }
        const cleaned = {};
        for (const [model, value] of Object.entries(limits)) {
            if (value === null)
                continue; // null clears a model's limit
            if (typeof value !== 'object')
                throw new Error(`modelLimits.${model} must be an object or null`);
            const entry = value;
            const maxCalls = typeof entry.maxCalls === 'number' ? entry.maxCalls : undefined;
            const maxTokens = typeof entry.maxTokens === 'number' ? entry.maxTokens : undefined;
            const callsOk = maxCalls === undefined || (Number.isSafeInteger(maxCalls) && maxCalls >= 1);
            const tokensOk = maxTokens === undefined || (Number.isSafeInteger(maxTokens) && maxTokens >= 1);
            if (!callsOk || !tokensOk)
                throw new Error(`modelLimits.${model} has invalid maxCalls/maxTokens`);
            if (maxCalls === undefined && maxTokens === undefined)
                continue;
            cleaned[model] = {
                ...(maxCalls === undefined ? {} : { maxCalls }),
                ...(maxTokens === undefined ? {} : { maxTokens }),
            };
        }
        out.modelLimits = cleaned;
    }
    if (input.excludeModels !== undefined) {
        if (!Array.isArray(input.excludeModels) || input.excludeModels.some(item => typeof item !== 'string')) {
            throw new Error('excludeModels must be an array of strings');
        }
        out.excludeModels = input.excludeModels.map(item => item.trim()).filter(item => item.length > 0);
    }
    if (input.taskRoutes !== undefined) {
        const routes = input.taskRoutes;
        if (typeof routes !== 'object' || routes === null)
            throw new Error('taskRoutes must be an object');
        const cleaned = {};
        for (const task of TASK_TYPES) {
            const list = routes[task];
            if (list === undefined)
                continue;
            if (!Array.isArray(list) || list.some(id => typeof id !== 'string'))
                throw new Error(`taskRoutes.${task} must be an array of model ids`);
            cleaned[task] = [...new Set(list.map(id => id.trim()).filter(id => id.length > 0))];
        }
        out.taskRoutes = cleaned;
    }
    if (input.models !== undefined) {
        const models = input.models;
        if (!Array.isArray(models))
            throw new Error('models must be an array');
        out.models = models.map((entry) => {
            if (typeof entry !== 'object' || entry === null || typeof entry.id !== 'string') {
                throw new Error('each models entry needs a string id');
            }
            const model = entry;
            return {
                id: model.id.trim(),
                ...(typeof model.name === 'string' ? { name: model.name } : {}),
                ...(typeof model.vision === 'boolean' ? { vision: model.vision } : {}),
                ...(typeof model.contextWindow === 'number' ? { contextWindow: model.contextWindow } : {}),
                ...(typeof model.maxTokens === 'number' ? { maxTokens: model.maxTokens } : {}),
                ...(Array.isArray(model.tags) ? { tags: model.tags.filter(tag => TASK_TYPES.includes(tag)) } : {}),
            };
        });
    }
    if (input.activeAccountId !== undefined) {
        if (typeof input.activeAccountId !== 'string')
            throw new Error('activeAccountId must be a string');
        out.activeAccountId = input.activeAccountId.trim();
    }
    if (input.accounts !== undefined) {
        if (!Array.isArray(input.accounts))
            throw new Error('accounts must be an array');
        const seen = new Set();
        const cleaned = [];
        for (const entry of input.accounts) {
            if (typeof entry !== 'object' || entry === null)
                throw new Error('each account must be an object');
            const account = entry;
            const id = typeof account.id === 'string' ? account.id.trim() : '';
            const name = typeof account.name === 'string' ? account.name.trim() : '';
            const baseURL = typeof account.baseURL === 'string' ? account.baseURL.trim().replace(/\/+$/, '') : '';
            if (id.length === 0 || name.length === 0 || baseURL.length === 0) {
                throw new Error('each account needs a non-empty id, name and baseURL');
            }
            if (seen.has(id))
                continue;
            let url;
            try {
                url = new URL(baseURL);
            }
            catch (_invalid) {
                throw new Error(`account ${id}: baseURL must be a valid URL`);
            }
            if (!['http:', 'https:'].includes(url.protocol))
                throw new Error(`account ${id}: baseURL must be HTTP(S)`);
            seen.add(id);
            const apiKey = typeof account.apiKey === 'string' && account.apiKey.trim().length > 0 ? account.apiKey.trim() : undefined;
            const apiKeyEnv = typeof account.apiKeyEnv === 'string' && account.apiKeyEnv.trim().length > 0 ? account.apiKeyEnv.trim() : undefined;
            cleaned.push({ id, name, baseURL, ...(apiKey === undefined ? {} : { apiKey }), ...(apiKeyEnv === undefined ? {} : { apiKeyEnv }) });
        }
        out.accounts = cleaned;
    }
    if (Object.keys(out).length === 0)
        throw new Error('patch carries no editable field');
    return out;
}
/** Build the panel-facing state snapshot. */
async function stateView(ctx, router, store) {
    await store.ready;
    const snapshot = router.capture();
    const options = snapshot.options;
    const configuredDecision = String(router.configured().decisionModel ?? options.decisionModel);
    const configuredFallback = String(router.configured().fallbackModel ?? options.fallbackModel);
    const now = Date.now();
    const quota = snapshot.entries.map((entry) => {
        const state = store.state.quota[entry.id];
        const cooldownUntil = state?.cooldownUntil !== undefined && state.cooldownUntil > now ? state.cooldownUntil : null;
        return {
            model: entry.id,
            available: cooldownUntil === null,
            cooldownUntil,
            cooldownRemainingMs: cooldownUntil === null ? 0 : cooldownUntil - now,
            fails: state?.fails ?? 0,
            calls: state?.calls ?? 0,
            lastFailCode: state?.lastFailCode ?? null,
            lastFailAt: state?.lastFailAt ?? null,
            lastOkAt: state?.lastOkAt ?? null,
        };
    });
    // Models with recorded quota state but no pool entry stay visible.
    for (const [model, state] of Object.entries(store.state.quota)) {
        if (quota.some(entry => entry.model === model))
            continue;
        const cooldownUntil = state.cooldownUntil !== undefined && state.cooldownUntil > now ? state.cooldownUntil : null;
        quota.push({
            model,
            available: cooldownUntil === null,
            cooldownUntil,
            cooldownRemainingMs: cooldownUntil === null ? 0 : cooldownUntil - now,
            fails: state.fails,
            calls: state.calls,
            lastFailCode: state.lastFailCode ?? null,
            lastFailAt: state.lastFailAt ?? null,
            lastOkAt: state.lastOkAt ?? null,
        });
    }
    const history = [...store.state.history].reverse().map(record => ({
        at: record.at,
        task: record.task,
        modality: record.modality,
        decisionSource: record.decisionSource,
        decisionModel: record.decisionModel ?? null,
        reasoning: record.reasoning ?? null,
        attempts: record.attempts.map(attempt => ({ model: attempt.model, ok: attempt.ok, code: attempt.code ?? null })),
        finalModel: record.finalModel ?? null,
        ok: record.ok,
        decisionTokens: record.decisionTokens ?? 0,
        origin: record.origin ?? 'auto',
        strategy: record.strategy ?? 'auto',
        keyId: record.keyId ?? null,
        tokens: record.tokens ?? 0,
    }));
    const taskRoutes = {};
    for (const task of TASK_TYPES)
        taskRoutes[task] = [...(options.taskRoutes[task] ?? [])];
    const candidates = listConnections(ctx).map(candidate => ({
        entryId: candidate.entryId,
        providerId: candidate.providerId,
        baseURL: candidate.baseURL,
        apiKeyEnv: candidate.apiKeyEnv ?? null,
        current: candidate.baseURL === options.baseURL,
    }));
    // Masked account views: the raw key never leaves the host process.
    const activeKeyId = resolveKeyId({ activeAccountId: options.activeAccountId, baseURL: options.baseURL, apiKeyEnv: options.apiKeyEnv });
    const activeLedger = store.ledgerOf(activeKeyId, { baseURL: options.baseURL });
    const inheritFrom = activeLedger.totalTokens === 0 ? (store.sameEndpointLedger(activeKeyId, options.baseURL) ?? null) : null;
    const accounts = options.accounts.map(account => ({
        id: account.id,
        name: account.name,
        baseURL: account.baseURL,
        hasKey: typeof account.apiKey === 'string' && account.apiKey.length > 0,
        keyHint: typeof account.apiKey === 'string' && account.apiKey.length > 0 ? `••••${account.apiKey.slice(-4)}` : null,
        apiKeyEnv: account.apiKeyEnv ?? null,
        active: account.id === options.activeAccountId,
        providerId: account.providerId ?? null,
        vendor: account.vendor ?? null,
        keyId: accountKeyId(account.id),
    }));
    return {
        provider: 'bailian-auto',
        model: 'bailian-auto',
        modelName: '智能路由 Auto Router',
        config: {
            baseURL: options.baseURL,
            apiKeyEnv: options.apiKeyEnv,
            apiKeyConfigured: await apiKeyConfigured(ctx, options.apiKeyRefs, options.apiKeyDirect),
            enableDecision: options.enableDecision,
            decisionModel: options.decisionModel,
            decisionModelConfigured: configuredDecision,
            decisionTimeoutMs: options.decisionTimeoutMs,
            decisionInputMaxChars: options.decisionInputMaxChars,
            fallbackModel: options.fallbackModel,
            fallbackModelConfigured: configuredFallback,
            maxAttempts: options.maxAttempts,
            quotaCooldownMinutes: Math.round(options.quotaCooldownMs / 60_000),
            rateLimitCooldownSeconds: Math.round(options.rateLimitCooldownMs / 1000),
            streamIdleTimeoutMs: options.streamIdleTimeoutMs,
            autoSyncPool: options.autoSyncPool,
            poolSyncIntervalHours: options.poolSyncIntervalHours,
            balanceStrategy: options.balanceStrategy,
            balanceWindow: options.balanceWindow,
            balanceBand: options.balanceBand,
            balanceWindowHours: options.balanceWindowHours,
            thinkingEffort: options.thinkingEffort,
            vendor: options.vendor,
            enableMediaRouting: options.enableMediaRouting,
            stickySession: options.stickySession,
            sessionTurnLimit: options.sessionTurnLimit,
            maxCandidatesForDecision: options.maxCandidatesForDecision,
            includeSpecialEndpoints: options.includeSpecialEndpoints,
            excludeModels: [...options.excludeModels],
            taskRoutes,
            models: options.models.map(model => ({ ...model })),
            accounts,
            activeAccountId: options.activeAccountId,
            modelLimits: { ...options.modelLimits },
            sortStrategy: options.sortStrategy,
            bucketTokens: options.bucketTokens,
            bucketTolerance: options.bucketTolerance,
        },
        pool: {
            models: snapshot.entries.map(entry => ({
                id: entry.id,
                name: entry.name,
                vision: entry.vision,
                visionKnown: entry.visionKnown,
                contextWindow: entry.contextWindow ?? null,
                source: entry.source,
                category: entry.category,
                tasks: entry.tasks.slice(),
                quality: entry.quality,
                speed: entry.speed,
                quota: options.modelLimits[entry.id] ?? null,
                bucketTokens: activeLedger.models[entry.id]?.bucketTokens ?? 0,
                ledgerTokens: activeLedger.models[entry.id]?.tokens ?? 0,
                price: priceOf(entry.id),
            })),
            count: snapshot.entries.length,
            total: snapshot.pool.total,
            visionCount: snapshot.entries.filter(entry => entry.vision).length,
            lastSyncAt: store.state.lastSyncAt ?? null,
            lastSyncError: store.state.lastSyncError ?? null,
            excluded: snapshot.pool.excluded.map(entry => ({ id: entry.id, reason: entry.reason })),
            media: {
                image: snapshot.pool.media.image.map(entry => entry.id),
                speech: snapshot.pool.media.speech.map(entry => entry.id),
                asr: snapshot.pool.media.asr.map(entry => entry.id),
                realtime: snapshot.pool.media.realtime.map(entry => entry.id),
                embedding: snapshot.pool.media.embedding.map(entry => entry.id),
                rerank: snapshot.pool.media.rerank.map(entry => entry.id),
                video: snapshot.pool.media.video.map(entry => entry.id),
                music: snapshot.pool.media.music.map(entry => entry.id),
            },
        },
        quota,
        history,
        modelUsage: Object.fromEntries(snapshot.entries.map(entry => [entry.id, store.modelTotalsOf(entry.id)])),
        adopted: snapshot.adopted === undefined ? null : {
            entryId: snapshot.adopted.entryId,
            providerId: snapshot.adopted.providerId,
            baseURL: snapshot.adopted.baseURL,
            apiKeyEnv: snapshot.adopted.apiKeyEnv ?? null,
        },
        candidates,
        derived: snapshot.derived ?? null,
        connections: dedupeConnections(candidates.map(candidate => ({
            id: candidate.entryId,
            name: candidate.providerId ?? '',
            providerId: candidate.providerId ?? '',
            baseURL: candidate.baseURL,
            credentialRef: candidate.apiKeyEnv ?? undefined,
            kind: 'discovered',
        }))).map(connection => ({
            id: connection.id, name: connectionLabel(connection), providerId: connection.providerId ?? '',
            baseURL: connection.baseURL, credentialRef: connection.credentialRef ?? null,
        })),
        keyLedger: { keyId: activeKeyId, label: activeLedger.label, totalTokens: activeLedger.totalTokens, cycle: activeLedger.cycle },
        inheritSuggestion: inheritFrom == null ? null : { fromKeyId: inheritFrom.keyId, label: inheritFrom.label, totalTokens: inheritFrom.totalTokens },
    };
}
/** Create the RPC service over the router and store. */
export function createService(ctx, router, store) {
    const persist = async (mutate) => {
        const editor = ctx.get('configEditor');
        const entry = ctx.fiber.entry;
        if (editor === undefined || entry === undefined) {
            throw new Error('当前部署不支持在线保存配置(configEditor 不可用);请直接编辑 profile 的 cordis.patch.yml 中本插件的 config');
        }
        await editor.edit(entry, mutate);
    };
    const editConfig = async (patch) => {
        const sanitized = sanitizePatch(patch);
        await persist((current) => {
            const next = { ...current, ...sanitized };
            // Merge taskRoutes partially so one task edit keeps the others.
            if (sanitized.taskRoutes !== undefined) {
                const base = typeof current.taskRoutes === 'object' && current.taskRoutes !== null
                    ? current.taskRoutes : {};
                next.taskRoutes = { ...base, ...sanitized.taskRoutes };
            }
            return next;
        });
        return stateView(ctx, router, store);
    };
    const readAccounts = (current) => Array.isArray(current.accounts)
        ? current.accounts.filter(account => account && typeof account.id === 'string')
        : [];
    return {
        async getState() {
            return stateView(ctx, router, store);
        },
        async updateConfig(patch) {
            return editConfig(patch);
        },
        async refreshPool() {
            const result = await router.syncPool(true);
            return { ok: result.ok, message: result.message, state: await stateView(ctx, router, store) };
        },
        async switchConnection(entryId, providerId) {
            const target = listConnections(ctx).find(candidate => candidate.entryId === entryId && candidate.providerId === providerId);
            if (target === undefined)
                throw new Error(`未找到连接 ${entryId} → ${providerId}(可能已被移除)`);
            await editConfig({
                baseURL: target.baseURL,
                ...(target.apiKeyEnv === undefined ? {} : { apiKeyEnv: target.apiKeyEnv }),
                // A profile connection supersedes any saved-account selection.
                activeAccountId: '',
            });
            invalidateConnectionCache();
            const result = await router.syncPool(true);
            return { ok: result.ok, message: result.message, state: await stateView(ctx, router, store) };
        },
        async upsertAccount(account) {
            const sanitized = sanitizePatch({ accounts: [account] });
            const incoming = sanitized.accounts[0];
            if (incoming === undefined)
                throw new Error('账号无效:需要 id、名称与接口地址');
            await persist((current) => {
                const existing = readAccounts(current);
                const previous = existing.find(item => item.id === incoming.id);
                const merged = { ...incoming };
                // Editing without re-entering a credential keeps the stored secret;
                // supplying a credential reference switches the account to ref mode.
                if (merged.apiKey === undefined && merged.apiKeyEnv === undefined && previous?.apiKey !== undefined) {
                    merged.apiKey = previous.apiKey;
                }
                return { ...current, accounts: [...existing.filter(item => item.id !== incoming.id), merged] };
            });
            return stateView(ctx, router, store);
        },
        async removeAccount(id) {
            if (typeof id !== 'string' || id.trim().length === 0)
                throw new Error('account id must be a non-empty string');
            const target = id.trim();
            const wasActive = router.settings().activeAccountId === target;
            await persist((current) => {
                const accounts = readAccounts(current).filter(item => item.id !== target);
                return {
                    ...current,
                    accounts,
                    ...(current.activeAccountId === target ? { activeAccountId: '' } : {}),
                };
            });
            invalidateConnectionCache();
            if (wasActive)
                await router.syncPool(true);
            return stateView(ctx, router, store);
        },
        async activateAccount(id) {
            const target = typeof id === 'string' ? id.trim() : '';
            const accounts = router.settings().accounts;
            if (target !== '' && !accounts.some(account => account.id === target)) {
                throw new Error(`未找到账号 ${target}(可能已被删除)`);
            }
            await persist((current) => ({ ...current, activeAccountId: target }));
            invalidateConnectionCache();
            const result = await router.syncPool(true);
            return { ok: result.ok, message: result.message, state: await stateView(ctx, router, store) };
        },
        async resetModelTotals(model) {
            await store.ready;
            store.resetModelTotals(typeof model === 'string' && model.length > 0 ? model : undefined);
            return stateView(ctx, router, store);
        },
        async selfCheck() {
            await store.ready;
            const snapshot = router.capture();
            const items = [];
            // 1. API key resolution
            let apiKey;
            try {
                const resolved = await resolveApiKey(ctx, snapshot.options.apiKeyRefs, snapshot.options.apiKeyDirect);
                apiKey = resolved.key;
                items.push({ name: 'API Key', ok: true, detail: `凭据已解析 (${resolved.ref})` });
            }
            catch (error) {
                items.push({
                    name: 'API Key', ok: false, detail: String(error?.message ?? error).slice(0, 200),
                    hint: '在 DSH 凭据服务或启动环境设置 BAILIAN_API_KEY / DASHSCOPE_API_KEY / ALIYUN_API_KEY,或确保 profile 里有指向阿里云的接入',
                });
            }
            // 2. Endpoint reachability (GET /models)
            if (apiKey !== undefined) {
                try {
                    const client = new BailianClient({ baseURL: snapshot.options.baseURL, apiKey, streamIdleTimeoutMs: 30_000 });
                    const listed = await client.listModels();
                    items.push({ name: '端点连通', ok: true, detail: `GET /models 返回 ${listed.length} 个模型` });
                }
                catch (error) {
                    items.push({
                        name: '端点连通', ok: false, detail: String(error?.message ?? error).slice(0, 200),
                        hint: 'Base URL 必须与 API Key 同一计费方案配套,否则 401;各地域/业务空间 key 不互通',
                    });
                }
            }
            else {
                items.push({ name: '端点连通', ok: false, detail: '无凭据,跳过', hint: '先修复 API Key' });
            }
            // 3. Pool non-empty
            if (snapshot.pool.entries.length > 0) {
                items.push({ name: '模型池', ok: true, detail: `${snapshot.pool.entries.length} 个可对话模型` });
            }
            else {
                items.push({ name: '模型池', ok: false, detail: '模型池为空', hint: '点击「刷新模型列表」,或等待首次自动同步' });
            }
            // 4. client.js classic script
            try {
                const dir = dirname(fileURLToPath(import.meta.url));
                const clientSource = readFileSync(join(dir, 'client.js'), 'utf8');
                const classic = !/^\s*(?:import\s|export\s)/m.test(clientSource);
                items.push({
                    name: 'client.js 经典脚本', ok: classic,
                    detail: classic ? '无 ESM 语法,可被浏览器按经典脚本求值' : '检测到 import/export(浏览器会 SyntaxError)',
                    ...(classic ? {} : { hint: '重新 npm run build(postbuild 会强制校验为经典脚本)' }),
                });
            }
            catch (error) {
                items.push({
                    name: 'client.js', ok: false, detail: String(error?.message ?? error).slice(0, 200),
                    hint: '确认 lib/client.js 存在(先在插件目录跑 npm run build)',
                });
            }
            // 5. state.json writable
            try {
                await store.flush();
                items.push({ name: 'state.json 可写', ok: true, detail: '状态文件可写' });
            }
            catch (error) {
                items.push({
                    name: 'state.json 可写', ok: false, detail: String(error?.message ?? error).slice(0, 200),
                    hint: '检查 ~/.dsh/bailian-auto-router 目录权限',
                });
            }
            // 6. Thinking parameter mapping
            const think = thinkingDispatch('qwen3.8-max', 'high');
            const thinkOk = think?.enableThinking === true && typeof think?.thinkingBudget === 'number';
            items.push({
                name: '思考参数映射', ok: thinkOk,
                detail: thinkOk ? `high → enable_thinking:true + budget ${think?.thinkingBudget}` : '映射异常',
                ...(thinkOk ? {} : { hint: '这是插件 bug,请升级到最新版' }),
            });
            return { ok: items.every(item => item.ok), items, state: await stateView(ctx, router, store) };
        },
        async resetQuota(model) {
            await store.ready;
            store.resetCooldown(typeof model === 'string' && model.length > 0 ? model : undefined);
            return stateView(ctx, router, store);
        },
        async clearHistory() {
            await store.ready;
            store.clearHistory();
            return stateView(ctx, router, store);
        },
        async pinUserModel(model) {
            await store.ready;
            if (typeof model !== 'string' || model.trim().length === 0)
                throw new Error('model must be a non-empty string');
            store.state.pendingUserModel = model.trim();
            store.scheduleWrite();
            return stateView(ctx, router, store);
        },
        async inheritKeyLedger(fromKeyId, toKeyId) {
            await store.ready;
            if (typeof fromKeyId !== 'string' || typeof toKeyId !== 'string')
                throw new Error('key ids must be strings');
            const ok = store.inheritLedger(fromKeyId, toKeyId);
            if (!ok)
                throw new Error('source ledger not found');
            return stateView(ctx, router, store);
        },
    };
}
