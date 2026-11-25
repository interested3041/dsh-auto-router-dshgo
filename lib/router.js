/**
 * The router core: per-request execution with decision-model routing,
 * quota-aware candidate ordering, and the silent fallback chain.
 *
 * Failure policy (mirrors the requested dsh-llm-auto-style behavior):
 * - Before any chunk is emitted, retryable failures (QUOTA, RATE_LIMIT,
 *   SERVER, TRANSPORT, TIMEOUT, UNKNOWN_MODEL, INVALID_REQUEST, AUTH,
 *   EMPTY_RESPONSE, MALFORMED_RESPONSE, HTTP_429/5xx) mark the model's
 *   local quota cooldown and silently move to the next candidate.
 * - Once any chunk has been emitted, failures propagate (no duplicate output).
 * - CONTEXT_WINDOW_EXCEEDED is terminal for the whole request: another model
 *   with the same window would fail the same way.
 */
import { LlmError } from '@deepseek-ai/dsh-llm';
import { DEFAULT_BASE_URL, DEFAULT_CONTEXT_WINDOW, inferVision, PROVIDER, VIRTUAL_MODEL, } from './catalog.js';
import { effortToReasoningEffort, supportsThinkingSwitch, thinkingDispatch } from './classify.js';
import { thinkingStyleFor } from './vendors.js';
import { resolveOptions } from './config.js';
import { discoverConnection } from './connection.js';
import { decideRoute, analyzeRequest, effortFor, costCapFor } from './decision.js';
import { buildPool, pickDefaultModels, rankForTask } from './pool.js';
import { priceOf } from './strategy.js';
import { resolveKeyId, parseUserModelDirective } from './identity.js';
import { BailianClient } from './http.js';
import { generateImage } from './media.js';
import { serializeMessages, serializeTools, streamAttempt } from './wire.js';
/** Identity of one connection: endpoint plus the credential in use. */
export function scopeOf(options) {
    const credential = options.activeAccountId ? `acct:${options.activeAccountId}` : options.apiKeyEnv;
    return `${options.baseURL}|${credential}`;
}
/** Codes that justify trying the next candidate model. */
const SWITCHABLE_CODES = new Set([
    'QUOTA', 'RATE_LIMIT', 'SERVER', 'TRANSPORT', 'TIMEOUT', 'UNKNOWN_MODEL',
    // AUTH is often model-specific on MaaS accounts: a bare alias such as
    // deepseek-v4.1-flash can 401 while its dated sibling -1017 works. Parking
    // the bad id and trying the next candidate is safer than failing the turn.
    'AUTH',
    // INVALID_REQUEST is often model-specific on MaaS accounts: a translation
    // endpoint rejects tools/history, an old model rejects the thinking field.
    // Treating it as terminal failed the whole turn without trying a healthy
    // sibling; it is switchable before any output and parked afterwards.
    'INVALID_REQUEST', 'UNSUPPORTED_CONTENT', 'UNSUPPORTED_OPTION',
    'EMPTY_RESPONSE', 'MALFORMED_RESPONSE', 'HTTP_429', 'HTTP_500', 'HTTP_502',
    'HTTP_503', 'HTTP_504',
]);
function isSwitchable(code) {
    return SWITCHABLE_CODES.has(code) || /^HTTP_5\d\d$/.test(code);
}
/**
 * Resolve the Bailian API key: a direct key from the active saved account
 * first, then the configured reference and the other well-known Aliyun
 * references, each through the credentials seam and then the process environment.
 * @param ctx - host context (optional credentials service).
 * @param refs - credential references to try, in order.
 * @param directKey - raw key stored by the active saved account, when present.
 * @returns the key and the reference (or `account`) that supplied it.
 */
export async function resolveApiKey(ctx, refs, directKey) {
    if (directKey !== undefined && directKey.trim().length > 0) {
        const value = directKey.trim();
        // eslint-disable-next-line no-control-regex
        if (/[\u0000-\u001f\u007f]/.test(value)) {
            throw new LlmError(`${PROVIDER}: the API key stored for the active account contains characters no HTTP header can carry`, 'INVALID_CREDENTIAL');
        }
        return { key: value, ref: 'account' };
    }
    const credentials = ctx.get('credentials');
    for (const ref of refs) {
        let value;
        if (credentials !== undefined) {
            try {
                const hit = await credentials.resolve(ref);
                value = hit?.value;
            }
            catch (_credentialStoreFailure) { /* fall through to the environment */ }
        }
        if (value === undefined || value.trim().length === 0)
            value = process.env[ref];
        if (value === undefined || value.trim().length === 0)
            continue;
        // eslint-disable-next-line no-control-regex
        if (/[\u0000-\u001f\u007f]/.test(value)) {
            throw new LlmError(`${PROVIDER}: the API key resolved from ${ref} contains characters no HTTP header can carry`, 'INVALID_CREDENTIAL');
        }
        return { key: value.trim(), ref };
    }
    throw new LlmError(`${PROVIDER}: 未找到 API Key。请设置 ${refs.join(' / ')} 之一(推荐写入 DSH 凭据服务,或在启动环境导出)`
        + ` (no Bailian API key found; set one of ${refs.join(', ')} through the credentials service or the launching environment)`, 'MISSING_CREDENTIAL');
}
/** Whether any configured key reference currently resolves (for panel display). */
export async function apiKeyConfigured(ctx, refs, directKey) {
    try {
        return (await resolveApiKey(ctx, refs, directKey)).key.length > 0;
    }
    catch (_missing) {
        return false;
    }
}
/** The decision-model router over one Bailian endpoint. */
export class Router {
    ctx;
    config;
    store;
    constructor(ctx, config, store) {
        this.ctx = ctx;
        this.config = config;
        this.store = store;
    }
    /** Settles once the persisted state finished loading. */
    whenReady() {
        return this.store.ready;
    }
    /** The raw configured values, before any account-aware substitution. */
    configured() {
        const options = resolveOptions(this.config);
        return { decisionModel: options.decisionModel, fallbackModel: options.fallbackModel };
    }
    /** Resolved settings snapshot (host-internal; never sent to the panel raw). */
    settings() {
        return resolveOptions(this.config);
    }
    /** Capture the current settings generation and pool view. */
    capture() {
        const options = resolveOptions(this.config);
        // Reuse an Aliyun connection the profile already configured (for example
        // the `bailian` provider in llm-pi-ai) while our own endpoint is untouched.
        let effective = options;
        let adopted;
        const activeAccount = options.activeAccountId === ''
            ? undefined
            : options.accounts.find(account => account.id === options.activeAccountId);
        if (activeAccount !== undefined) {
            // An explicitly selected saved account wins over profile auto-adoption.
            const ref = activeAccount.apiKeyEnv ?? options.apiKeyEnv;
            effective = {
                ...options,
                baseURL: activeAccount.baseURL,
                apiKeyEnv: ref,
                apiKeyRefs: [...new Set([ref, ...options.apiKeyRefs])],
                ...(activeAccount.apiKey === undefined ? {} : { apiKeyDirect: activeAccount.apiKey }),
            };
        }
        else if (options.adoptProfileProvider && options.baseURL === DEFAULT_BASE_URL) {
            const discovered = discoverConnection(this.ctx);
            if (discovered !== undefined) {
                adopted = discovered;
                effective = {
                    ...options,
                    baseURL: discovered.baseURL,
                    ...(discovered.apiKeyEnv === undefined
                        ? {}
                        : { apiKeyEnv: discovered.apiKeyEnv, apiKeyRefs: [...new Set([discovered.apiKeyEnv, ...options.apiKeyRefs])] }),
                };
            }
        }
        // Switching account (endpoint or credential reference) invalidates the
        // previous account's model list and cooldowns.
        const switched = this.store.bindScope(scopeOf(effective));
        if (switched) {
            this.ctx.logger.info(`[${PROVIDER}] connection changed; local model pool and cooldowns reset`);
        }
        // Membership is the account's own `/models` listing (the built-in catalog
        // only supplies metadata and stands in before the first sync).
        const pool = buildPool({
            synced: this.store.state.pool,
            user: effective.models,
            options: effective,
        });
        const entries = pool.entries
            .filter(entry => entry.id !== PROVIDER && entry.id !== VIRTUAL_MODEL)
            .map(entry => ({
            id: entry.id,
            name: entry.name,
            vision: entry.traits.vision,
            visionKnown: entry.traits.visionSource === 'declared',
            ...(entry.contextWindow === undefined ? {} : { contextWindow: entry.contextWindow }),
            source: entry.source,
            quality: entry.traits.quality,
            speed: entry.traits.speed,
            tasks: entry.traits.tasks,
            category: entry.traits.category,
        }));
        // A different account may not serve the configured decision/fallback ids;
        // degrade to models it does serve instead of failing every request.
        const derived = pickDefaultModels(pool, effective);
        const withDefaults = {
            ...effective,
            decisionModel: derived.decisionModel,
            fallbackModel: derived.fallbackModel,
            apiKeyRefs: effective.apiKeyRefs,
        };
        return {
            options: withDefaults,
            entries,
            pool,
            keyId: resolveKeyId({ activeAccountId: withDefaults.activeAccountId, baseURL: withDefaults.baseURL, apiKeyEnv: withDefaults.apiKeyEnv }),
            ...(adopted === undefined ? {} : { adopted }),
            ...(derived.decisionDerived || derived.fallbackDerived
                ? { derived: { decisionModel: derived.decisionDerived, fallbackModel: derived.fallbackDerived } }
                : {}),
        };
    }
    /** Attachments-backed image reader for wire serialization. */
    imageReader() {
        const attachments = this.ctx.get('attachments');
        if (attachments === undefined)
            return undefined;
        return {
            read: async (ref, signal) => {
                const version = await attachments.readImageRequest(ref, { width: ref.width, height: ref.height, maxBytes: 4 * 1024 * 1024 }, signal);
                return { data: version.data, mediaType: version.mediaType };
            },
        };
    }
    /** Fetch the endpoint `/models` listing into the local pool store. */
    async syncPool(manual) {
        await this.store.ready;
        const snapshot = this.capture();
        let apiKey;
        try {
            apiKey = (await resolveApiKey(this.ctx, snapshot.options.apiKeyRefs, snapshot.options.apiKeyDirect)).key;
        }
        catch (error) {
            const message = manual ? String(error?.message ?? error) : 'API key not configured; pool sync skipped';
            if (manual)
                this.store.setSyncError(message);
            return { ok: false, message };
        }
        const client = new BailianClient({
            baseURL: snapshot.options.baseURL, apiKey, streamIdleTimeoutMs: 30_000,
        });
        try {
            const listed = await client.listModels();
            const now = Date.now();
            const pool = listed.slice(0, 1000).map(model => ({
                id: model.id,
                ...(model.name === undefined ? {} : { name: model.name }),
                source: 'sync',
                syncedAt: now,
            }));
            this.store.setPool(pool, now);
            return { ok: true, message: `已同步 ${pool.length} 个模型`, count: pool.length };
        }
        catch (error) {
            const message = String(error?.message ?? error).slice(0, 300);
            this.store.setSyncError(message);
            return { ok: false, message };
        }
    }
    /**
     * Resolve a user-pinned model for this request: either the one-shot
     * `pendingUserModel` override or a `/model <id>` / `@model:<id>` prefix on the
     * last user message. The directive is stripped from the outgoing text.
     * Returns undefined when absent or when the id is not routable right now.
     */
    takeUserModel(options, snapshot) {
        let pinned = this.store.state.pendingUserModel;
        if (pinned !== undefined) {
            delete this.store.state.pendingUserModel;
            this.store.scheduleWrite();
        }
        let messages = options.messages;
        if (pinned === undefined) {
            const msgs = options.messages ?? [];
            for (let i = msgs.length - 1; i >= 0; i--) {
                const message = msgs[i];
                if (message?.role !== 'user')
                    continue;
                const text = (message.content ?? []).filter(block => block.type === 'text').map(block => String(block.text ?? '')).join('\n');
                const match = /^\s*(?:\/model\s+|@model:)([A-Za-z0-9._/-]+)/.exec(text);
                if (match !== null) {
                    pinned = match[1];
                    messages = msgs.map((entry, index) => index === i
                        ? { ...entry, content: (entry.content ?? []).map(block => block.type === 'text'
                                ? { ...block, text: String(block.text ?? '').replace(/^\s*(?:\/model\s+|@model:)[A-Za-z0-9._/-]+\s*/, '') }
                                : block) }
                        : entry);
                }
                break;
            }
        }
        if (pinned === undefined)
            return undefined;
        const entry = snapshot.pool.byId.get(pinned);
        if (entry === undefined || !entry.traits.chat || this.store.inCooldown(pinned))
            return undefined;
        return { model: pinned, options: { ...options, messages } };
    }
    /**
     * Stream one request through the virtual model: decide -> execute -> silently
     * fall back across candidates while nothing has been emitted yet.
     */
    async *stream(options, snapshot) {
        await this.store.ready;
        // Direct pass-through: any concrete Bailian model id skips the decision.
        if (options.model !== VIRTUAL_MODEL) {
            yield* this.runSingle(options, snapshot, options.model);
            return;
        }
        const apiKey = (await resolveApiKey(this.ctx, snapshot.options.apiKeyRefs, snapshot.options.apiKeyDirect)).key;
        const client = new BailianClient({
            baseURL: snapshot.options.baseURL, apiKey, streamIdleTimeoutMs: snapshot.options.streamIdleTimeoutMs,
        });
        const requestAnalysis = analyzeRequest(options, snapshot.options.decisionInputMaxChars);
        const userPick = this.takeUserModel(options, snapshot);
        let origin = 'auto';
        let decision;
        const sessionId = options.sessionId;
        if (userPick !== undefined) {
            // User pinned the model: skip the decision call entirely (0 decision tokens).
            origin = 'user';
            options = userPick.options;
            const analysis = analyzeRequest(options, snapshot.options.decisionInputMaxChars);
            const ranked = rankForTask(analysis.heuristicTask, snapshot.pool, snapshot.options, analysis.hasImages);
            decision = {
                candidates: [userPick.model, ...ranked.filter(id => id !== userPick.model)],
                chosen: userPick.model,
                task: analysis.heuristicTask,
                heuristicTask: analysis.heuristicTask,
                decisionSource: 'heuristic',
                reasoning: '用户自己对话中确定的模型',
                decisionTokens: 0,
            };
        }
        else {
            // Cache-first reuse: a fresh binding keeps its model even when the
            // heuristic task label changes (a follow-up like "summarize" often looks
            // like writing). Re-deciding on every task-label drift costs ~1k tokens
            // and forces the new model to re-bill the whole prefix; only a hard
            // capability mismatch (image input without vision) or an unavailable /
            // overloaded model may break the binding.
            const analysis = analyzeRequest(options, snapshot.options.decisionInputMaxChars);
            const binding = sessionId !== undefined && snapshot.options.stickySession
                ? this.store.sessionModel(sessionId)
                : undefined;
            const bound = binding === undefined ? undefined : snapshot.pool.byId.get(binding.model);
            // Cache is only worth keeping when the bound model still fits this
            // request's price band and is strong enough for a complex code/reasoning
            // turn. A mis-selected flagship must be downgraded even though that
            // resets the prefix cache: the 6x price gap dwarfs the cache discount.
            const cap = costCapFor(analysis);
            const boundPrice = binding === undefined ? Infinity : priceOf(binding.model);
            const underpowered = bound !== undefined
                && (analysis.complexityLevel === 'complex' || analysis.complexityLevel === 'deep')
                && (analysis.heuristicTask === 'code' || analysis.heuristicTask === 'reasoning')
                && bound.traits.quality < 75;
            const reusable = binding !== undefined
                && bound !== undefined
                && (!analysis.hasImages || bound.traits.vision)
                && binding.turns % snapshot.options.sessionTurnLimit !== 0
                && !this.store.inCooldown(binding.model)
                && !this.contextOverloaded(binding.model, options, snapshot)
                && boundPrice <= cap
                && !underpowered;
            if (reusable) {
                const ranked = rankForTask(analysis.heuristicTask, snapshot.pool, snapshot.options, analysis.hasImages);
                decision = {
                    candidates: [binding.model, ...ranked.filter(id => id !== binding.model)],
                    chosen: binding.model,
                    task: analysis.heuristicTask,
                    heuristicTask: analysis.heuristicTask,
                    decisionSource: 'heuristic',
                    reasoning: '沿用本会话已选模型，保持提示缓存与工具格式',
                    decisionTokens: 0,
                    // Sticky reuse must still send an explicit thinking switch. Omitting it
                    // lets thinking-by-default models (GLM preview) burn the whole completion
                    // budget on hidden reasoning in follow-up turns.
                    effort: effortFor(analysis, snapshot.options.thinkingEffort, analysis.heuristicTask),
                };
            }
            else {
                decision = await decideRoute(options, snapshot.options, snapshot.pool, this.store, client, options.signal);
            }
        }
        // Deterministic short-circuit (e.g. video intent with no video model): reply
        // without calling any model, so the turn costs zero tokens.
        if (decision.notice !== undefined) {
            const record = {
                at: Date.now(),
                task: decision.task,
                modality: hasImageContent(options) ? 'image' : 'text',
                decisionSource: 'notice',
                ...(sessionId !== undefined ? { sessionId } : {}),
                reasoning: decision.reasoning,
                attempts: [],
                ok: true,
            };
            yield* this.streamText(decision.notice.text, options.signal);
            this.store.recordRoute(record);
            return;
        }
        // Media intent (image generation): the account's image models are served by
        // /images/generations, so this never goes through chat completions.
        if (decision.media !== undefined) {
            const record = {
                at: Date.now(),
                task: 'media',
                modality: 'text',
                decisionSource: 'media',
                ...(sessionId !== undefined ? { sessionId } : {}),
                reasoning: decision.reasoning,
                attempts: [{ model: decision.media.model, ok: false }],
                ok: false,
            };
            try {
                const reply = await this.mediaReply(decision.media, snapshot);
                yield* this.streamText(reply, options.signal);
                this.store.markSuccess(decision.media.model);
                record.attempts[0] = { model: decision.media.model, ok: true };
                record.finalModel = decision.media.model;
                record.ok = true;
            }
            catch (error) {
                if (error instanceof LlmError && isSwitchable(error.code)) {
                    this.store.markFailure(decision.media.model, error.code, snapshot.options.quotaCooldownMs);
                }
                this.store.recordRoute(record);
                throw error;
            }
            this.store.recordRoute(record);
            return;
        }
        this.ctx.logger.info(`[dsh-auto-router] task=${decision.task} modality=${decisionSourceLabel(decision)} -> ${decision.chosen}`
            + (decision.reasoning ? ` | ${decision.reasoning}` : ''));
        // DSH also calls the model for titles, summaries and tool-loop continuations.
        // Those are billed and must stay in the ledger, but they are not the user's
        // decision; mark them so the floating card does not show a helper call as
        // "上次决策".
        const backgroundOnly = !requestAnalysis.hasUserInput
            || (options.maxTokens !== undefined && options.maxTokens > 0 && options.maxTokens <= 128);
        const record = {
            at: Date.now(),
            task: decision.task,
            modality: hasImageContent(options) ? 'image' : 'text',
            decisionSource: decision.decisionSource,
            ...(decision.decisionSource === 'model' ? { decisionModel: snapshot.options.decisionModel } : {}),
            ...(decision.reasoning ? { reasoning: decision.reasoning } : {}),
            ...(decision.decisionTokens ? { decisionTokens: decision.decisionTokens } : {}),
            utility: decision.utility === true || backgroundOnly,
            origin,
            strategy: snapshot.options.sortStrategy,
            keyId: snapshot.keyId,
            ...(sessionId !== undefined ? { sessionId } : {}),
            attempts: [],
            ok: false,
        };
        // An explicit effort from the session overrides the automatic policy.
        const callerEffort = options.reasoningEffort;
        const effort = callerEffort !== undefined && callerEffort !== 'auto' ? callerEffort : decision.effort;
        const attempts = [];
        for (const id of decision.candidates) {
            if (attempts.length >= snapshot.options.maxAttempts)
                break;
            const entry = snapshot.pool.byId.get(id);
            if (entry === undefined || !entry.traits.chat)
                continue;
            if (this.store.inCooldown(id))
                continue;
            if (hasImageContent(options) && !this.visionOf(id, snapshot))
                continue;
            if (this.contextOverloaded(id, options, snapshot))
                continue;
            if (!attempts.includes(id))
                attempts.push(id);
        }
        // The configured fallback must always be the last resort. Previously a
        // shortlist full of account-incompatible ids could consume maxAttempts and
        // the request failed without ever trying the one model known to work.
        const fallback = this.usableFallback(snapshot, hasImageContent(options));
        if (fallback !== undefined && !attempts.includes(fallback))
            attempts.push(fallback);
        if (attempts.length === 0)
            attempts.push(snapshot.options.fallbackModel);
        let lastError;
        for (const model of attempts) {
            let emitted = false;
            let tokens = 0;
            let inputTokens = 0;
            let outputTokens = 0;
            let cacheReadTokens = 0;
            let cacheWriteTokens = 0;
            try {
                for await (const chunk of this.attempt(options, snapshot, client, model, effort)) {
                    emitted = true;
                    if (chunk.type === 'usage') {
                        inputTokens = chunk.usage.inputTokens ?? 0;
                        outputTokens = chunk.usage.outputTokens ?? 0;
                        cacheReadTokens = chunk.usage.cacheReadTokens ?? 0;
                        cacheWriteTokens = chunk.usage.cacheWriteTokens ?? 0;
                        tokens = (chunk.usage.totalTokens ?? 0)
                            || inputTokens + outputTokens + cacheReadTokens + cacheWriteTokens;
                    }
                    yield chunk;
                }
                // Attempt completed (terminal finish already yielded).
                this.store.markSuccess(model);
                if (sessionId !== undefined && snapshot.options.stickySession) {
                    this.store.bindSession(sessionId, model, decision.heuristicTask ?? decision.task);
                }
                // Record under both buckets: ranking/balancing runs on the heuristic
                // task, while history and the panel show the decided task.
                this.store.recordUsage(decision.heuristicTask, model, tokens);
                if (decision.task !== decision.heuristicTask)
                    this.store.recordUsage(decision.task, model, tokens);
                this.store.recordLedgerTokens(snapshot.keyId, model, tokens);
                record.tokens = tokens;
                record.inputTokens = inputTokens;
                record.outputTokens = outputTokens;
                record.cacheReadTokens = cacheReadTokens;
                record.cacheWriteTokens = cacheWriteTokens;
                // Learn capability facts from real outcomes.
                if (hasImageContent(options))
                    this.store.confirmVision(model);
                record.attempts.push({ model, ok: true });
                record.finalModel = model;
                record.ok = true;
                // Keep the visible reason truthful when earlier candidates failed and a
                // silent fallback actually served the answer.
                if (decision.chosen !== model) {
                    record.reasoning = `${record.reasoning ?? '按候选排序路由'}（首选 ${decision.chosen} 未成功，实际执行 ${model}）`;
                }
                this.store.recordRoute(record);
                return;
            }
            catch (error) {
                const failure = error instanceof LlmError ? error : new LlmError(String(error?.message ?? error), 'TRANSPORT');
                const code = failure.code;
                record.attempts.push({ model, ok: false, code });
                if (emitted || !isSwitchable(code) || options.signal?.aborted === true) {
                    // Partial output already visible, terminal failure class, or user
                    // cancellation: never switch models after content was emitted.
                    this.store.recordRoute(record);
                    throw failure;
                }
                if (hasImageContent(options) && (code === 'UNSUPPORTED_CONTENT' || code === 'INVALID_REQUEST')
                    && /image|vision|multimodal|image_url/i.test(failure.message)) {
                    // The provider says this model cannot read images: remember it so the
                    // model stops being offered for image requests.
                    this.store.vetoVision(model);
                }
                // UNKNOWN_MODEL / AUTH mean the account simply cannot call this id, so
                // it is parked for the long cooldown instead of being retried in loop.
                // UNKNOWN_MODEL / INVALID_REQUEST mean this account/model pair is
                // unusable for now. Park it for at least 6h so the same bad id is
                // removed from the decision shortlist instead of being retried every
                // turn; ordinary rate limits keep the configured short cooldown.
                const hardBad = code === 'UNKNOWN_MODEL' || code === 'INVALID_REQUEST'
                    || code === 'UNSUPPORTED_CONTENT' || code === 'UNSUPPORTED_OPTION' || code === 'AUTH';
                const cooldownMs = hardBad
                    ? Math.max(snapshot.options.quotaCooldownMs, 6 * 3_600_000)
                    : code === 'QUOTA'
                        ? snapshot.options.quotaCooldownMs
                        : snapshot.options.rateLimitCooldownMs;
                this.store.markFailure(model, code, cooldownMs);
                if (sessionId !== undefined)
                    this.store.dropSession(sessionId);
                lastError = failure;
                this.ctx.logger.warn(`[dsh-auto-router] ${model} failed (${code}), cooldown ${Math.round(cooldownMs / 1000)}s; trying next candidate`);
            }
        }
        this.store.recordRoute(record);
        throw lastError instanceof LlmError
            ? lastError
            : new LlmError(`${PROVIDER}: every candidate model failed`, 'SERVER');
    }
    /** One execution attempt with no fallback (pass-through mode). */
    async *runSingle(options, snapshot, model) {
        const apiKey = (await resolveApiKey(this.ctx, snapshot.options.apiKeyRefs, snapshot.options.apiKeyDirect)).key;
        const client = new BailianClient({
            baseURL: snapshot.options.baseURL, apiKey, streamIdleTimeoutMs: snapshot.options.streamIdleTimeoutMs,
        });
        try {
            for await (const chunk of this.attempt(options, snapshot, client, model))
                yield chunk;
            this.store.markSuccess(model);
        }
        catch (error) {
            if (error instanceof LlmError && isSwitchable(error.code)) {
                this.store.markFailure(model, error.code, error.code === 'QUOTA' ? snapshot.options.quotaCooldownMs : snapshot.options.rateLimitCooldownMs);
            }
            throw error;
        }
    }
    /** Serialize and dispatch one wire attempt against one execution model. */
    async *attempt(options, snapshot, client, model, effort) {
        const vision = this.visionOf(model, snapshot);
        const messages = await serializeMessages(options.messages, {
            vision,
            ...(this.imageReader() ? { readImage: this.imageReader() } : {}),
            fileText: ref => this.ctx.llm.fileRequestText(ref),
            ...(options.signal ? { signal: options.signal } : {}),
        });
        const tools = serializeTools(options.tools);
        const thinking = this.thinkingFor(model, effort, snapshot);
        // Never let hidden reasoning eat the entire visible answer budget. A 2k
        // completion with a 32k thinking budget otherwise returns one visible token.
        if (thinking?.thinkingBudget !== undefined && options.maxTokens !== undefined && options.maxTokens > 0) {
            thinking.thinkingBudget = Math.min(thinking.thinkingBudget, Math.max(256, Math.floor(options.maxTokens * 0.45)));
        }
        const request = {
            model,
            messages,
            ...(tools ? { tools } : {}),
            ...(options.temperature === undefined ? {} : { temperature: options.temperature }),
            ...(options.maxTokens === undefined ? {} : { maxTokens: options.maxTokens }),
            ...(options.stop === undefined ? {} : { stop: options.stop }),
            ...(thinking === undefined
                ? {}
                : {
                    ...(thinking.enableThinking === undefined ? {} : { enableThinking: thinking.enableThinking }),
                    ...(thinking.thinkingBudget === undefined ? {} : { thinkingBudget: thinking.thinkingBudget }),
                    ...(thinking.reasoningEffort === undefined ? {} : { reasoningEffort: thinking.reasoningEffort }),
                }),
        };
        try {
            yield* streamAttempt(client, request, options.signal);
        }
        catch (error) {
            // A provider that rejects the thinking parameters must not fail the turn:
            // remember the fact and retry the same model with every thinking knob
            // stripped. The match must cover Bailian's own spellings, including
            // Chinese parameter-error text and `counting/thinking_budget` / `reasoning`.
            if (thinking !== undefined && error instanceof LlmError
                && (error.code === 'INVALID_REQUEST' || error.code === 'UNSUPPORTED_OPTION' || error.code === 'HTTP_400')
                && /thinking|effort|budget|reason|参数|思考|推理/i.test(error.message)) {
                this.store.markEffortUnsupported(model);
                yield* streamAttempt(client, {
                    ...request,
                    enableThinking: undefined,
                    thinkingBudget: undefined,
                    reasoningEffort: undefined,
                }, options.signal);
                return;
            }
            throw error;
        }
    }
    /**
     * Last-resort model that is callable right now. Prefer the configured
     * fallback, then the cheapest fresh chat/vision model in the pool. This is
     * appended after the decision shortlist so a bad decision cannot exhaust the
     * retry budget before a known-good model is tried.
     */
    usableFallback(snapshot, needsVision) {
        const usable = (id) => {
            const entry = snapshot.pool.byId.get(id);
            if (entry === undefined || !entry.traits.chat)
                return false;
            if (needsVision && !this.visionOf(id, snapshot))
                return false;
            return !this.store.inCooldown(id);
        };
        const configured = snapshot.options.fallbackModel;
        if (configured.length > 0 && usable(configured))
            return configured;
        const fresh = snapshot.pool.entries
            .filter(entry => usable(entry.id))
            .sort((a, b) => priceOf(a.id) - priceOf(b.id) || b.traits.quality - a.traits.quality);
        return fresh[0]?.id ?? (configured.length > 0 ? configured : undefined);
    }
    /**
     * Whether the current message volume is approaching the bound model's
     * context window. When it is, the sticky binding is dropped so the long
     * session can re-select a roomier model instead of pinning a small-context one.
     */
    contextOverloaded(model, options, snapshot) {
        const window = snapshot.pool.byId.get(model)?.contextWindow;
        if (window === undefined || window <= 0)
            return false;
        let chars = 0;
        for (const message of options.messages ?? []) {
            for (const block of message.content ?? []) {
                if (block.type === 'text')
                    chars += String(block.text ?? '').length;
            }
        }
        // Rough budget: 4 characters per token, keep 20% headroom.
        return chars > window * 0.8 * 4;
    }
    /** Effective image-input capability: explicit config, then learned, then inferred. */
    visionOf(model, snapshot) {
        const entry = snapshot.pool.byId.get(model);
        const declared = entry?.traits.vision ?? inferVision(model);
        if (this.store.visionVetoed(model))
            return false;
        return declared || this.store.visionConfirmed(model);
    }
    /**
     * Resolve the thinking parameters this exact model should receive.
     *
     * Honors the effort the decision (or a caller override) selected, but maps it
     * to the Bailian `enable_thinking` switch — never to `reasoning_effort`. A
     * model that previously rejected thinking parameters is left untouched.
     */
    thinkingFor(model, effort, snapshot) {
        if (this.store.effortUnsupported(model))
            return undefined;
        if (effort !== 'off' && effort !== 'low' && effort !== 'medium' && effort !== 'high' && effort !== 'max')
            return undefined;
        const style = thinkingStyleFor(snapshot.options.vendor, snapshot.options.baseURL);
        if (style === 'enable_thinking') {
            // Families without a documented effort switch may still auto-think by
            // default (DeepSeek flash on Aliyun is one). Sending an explicit `false`
            // keeps the completion budget for the visible answer; providers that
            // reject the field are handled by the strip-and-retry path above.
            if (!supportsThinkingSwitch(model))
                return { enableThinking: false };
            return thinkingDispatch(model, effort);
        }
        if (style === 'reasoning_effort') {
            const reasoningEffort = effortToReasoningEffort(effort);
            return reasoningEffort === undefined ? undefined : { reasoningEffort };
        }
        return undefined;
    }
    /** Emit one complete assistant text reply as a well-formed chunk stream. */
    async *streamText(text, _signal) {
        yield { type: 'block-start', index: 0, blockType: 'text' };
        yield { type: 'text-delta', index: 0, text };
        yield { type: 'block-end', index: 0, block: { type: 'text', text } };
        yield { type: 'finish', reason: { kind: 'stop' } };
    }
    /** Run one media generation and return the reply text. */
    async mediaReply(media, snapshot) {
        const request = media;
        const apiKey = (await resolveApiKey(this.ctx, snapshot.options.apiKeyRefs, snapshot.options.apiKeyDirect)).key;
        const client = new BailianClient({
            baseURL: snapshot.options.baseURL, apiKey,
            streamIdleTimeoutMs: snapshot.options.streamIdleTimeoutMs,
        });
        const result = await generateImage(client, request.model, request.prompt, this.workspaceDirectory());
        return result.markdown;
    }
    /** Workspace directory for saved media (falls back to the process cwd). */
    workspaceDirectory() {
        try {
            const service = this.ctx.get('workingDirectory');
            if (typeof service?.defaultDirectory === 'string' && service.defaultDirectory.length > 0) {
                return service.defaultDirectory;
            }
        }
        catch (_noWorkspace) { /* fall through */ }
        return process.cwd();
    }
}
function decisionSourceLabel(decision) {
    return decision.decisionSource === 'model' ? 'decision-model' : decision.decisionSource;
}
function hasImageContent(options) {
    return options.messages.some(message => (message.content ?? []).some((block) => block.type === 'image'));
}
/** Context window advertised for the virtual model (max over the pool). */
export function virtualContextWindow(snapshot) {
    let max = DEFAULT_CONTEXT_WINDOW;
    for (const entry of snapshot.entries) {
        if (entry.contextWindow !== undefined && entry.contextWindow > max && entry.contextWindow < 5_000_000) {
            max = entry.contextWindow;
        }
    }
    return max;
}
/** Task-route view for panel display (ensures every task key exists). */
export function taskRoutesOf(options) {
    return options.taskRoutes;
}
