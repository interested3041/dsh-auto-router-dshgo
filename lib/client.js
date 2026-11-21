"use strict";
/**
 * Web client half of dsh-bailian-auto-router.
 *
 * Compiled to a plain script that registers into the browser module loader:
 * - a configuration + quota-status panel on the Plugin Manager bundle page
 *   (`plugins.bundle.config`, keyed by the package name), and
 * - a compact status card at the foot of Settings → Models
 *   (`settings.models.footer`).
 *
 * Talks to the host through the `bailianRouter` Typert RPC namespace, mounted
 * with a hand-written client contribution (the pattern proven by installed
 * community bundles). No Harness Client package is imported; controls and
 * styles are self-contained and use `--dsw-alias-*` theme tokens.
 *
 * This file must stay a non-module (no top-level import/export) so tsc emits a
 * plain script the module loader can evaluate.
 */
{
    const g = globalThis;
    const PACKAGE = 'dsh-bailian-auto-router';
    const NS = 'bailianRouter';
    /** Unwrap one RPC result envelope ({ok,value|error} or a plain value). */
    const unwrap = (result) => {
        if (result && typeof result === 'object' && 'ok' in result) {
            if (result.ok === true)
                return result.value;
            throw new Error(String(result.error?.message ?? result.error ?? 'RPC failed'));
        }
        return result;
    };
    g.__ModuleLoader__.load({
        id: PACKAGE,
        factory(require) {
            const React = require('react');
            const h = React.createElement;
            // Typed façades over the untyped module-table React.
            const useState = React.useState;
            const useEffect = React.useEffect;
            const useCallback = React.useCallback;
            const useMemo = React.useMemo;
            const useRef = React.useRef;
            // ---- i18n (panel-local dictionary; zh default, en fallback) ------------
            const zh = String(g.navigator?.language ?? 'zh').toLowerCase().startsWith('zh');
            const T = (zho, eng) => (zh ? zho : eng);
            // ---- client-side Typert contribution ----------------------------------
            // The Host half exposes its service through source markers only (SRC),
            // so the Gateway derives each endpoint's wire names from the Host
            // method's parameter list. Every descriptor below must repeat those names
            // exactly and carry the namespace, or the mount installs the wrong one.
            const schema = (parse) => ({ parse });
            const codec = (name, parse) => ({
                mode: 'strict', typeSymbol: `${PACKAGE}#${name}`, schema: schema(parse), create: () => schema(parse),
            });
            const asObject = (value) => {
                if (typeof value !== 'object' || value === null)
                    throw new Error('expected an object');
                return value;
            };
            const anyValue = (value) => value;
            /** One JSON wire parameter, named exactly like the Host method parameter. */
            const param = (wire, type, parse, optional = false) => ({
                name: wire, wire, source: 'json', codec: codec(type, parse), ...(optional ? { acceptsUndefined: true } : {}),
            });
            /** Endpoint identity every descriptor of this namespace shares. */
            const endpoint = (method) => ({
                id: `${PACKAGE}#${NS}/${method}`,
                service: NS,
                namespace: NS,
                method,
                invocation: { kind: 'direct' },
            });
            const contribution = {
                package: PACKAGE,
                descriptors: [
                    { ...endpoint('getState'), parameters: [], result: codec('RouterState', asObject) },
                    { ...endpoint('updateConfig'), parameters: [param('patch', 'ConfigPatch', asObject)], result: codec('RouterState', asObject) },
                    { ...endpoint('refreshPool'), parameters: [], result: codec('RefreshResult', asObject) },
                    { ...endpoint('resetQuota'), parameters: [param('model', 'ModelId', anyValue, true)], result: codec('RouterState', asObject) },
                    { ...endpoint('resetModelTotals'), parameters: [param('model', 'ModelId', anyValue, true)], result: codec('RouterState', asObject) },
                    { ...endpoint('clearHistory'), parameters: [], result: codec('RouterState', asObject) },
                    { ...endpoint('selfCheck'), parameters: [], result: codec('SelfCheckResult', asObject) },
                    {
                        ...endpoint('switchConnection'),
                        parameters: [param('entryId', 'String', anyValue), param('providerId', 'String', anyValue)],
                        result: codec('RefreshResult', asObject),
                    },
                    { ...endpoint('upsertAccount'), parameters: [param('account', 'AccountInput', asObject)], result: codec('RouterState', asObject) },
                    { ...endpoint('removeAccount'), parameters: [param('id', 'String', anyValue)], result: codec('RouterState', asObject) },
                    { ...endpoint('activateAccount'), parameters: [param('id', 'String', anyValue)], result: codec('RefreshResult', asObject) },
                ],
            };
            // ---- styles -------------------------------------------------------------
            const CSS = `
.bar-root { display:flex; flex-direction:column; gap:16px; color:var(--dsw-alias-label-primary); font-size:13px; line-height:1.5; }
.bar-card { border:1px solid var(--dsw-alias-border-l1); border-radius:10px; background:var(--dsw-alias-bg-layer-1); padding:14px 16px; display:flex; flex-direction:column; gap:10px; }
.bar-card > h4 { margin:0; font-size:13px; font-weight:600; color:var(--dsw-alias-label-primary); }
.bar-muted { color:var(--dsw-alias-label-secondary); }
.bar-row { display:flex; flex-wrap:wrap; gap:10px 16px; align-items:center; }
.bar-field { display:flex; flex-direction:column; gap:4px; min-width:180px; flex:1 1 180px; }
.bar-field > label { font-size:12px; color:var(--dsw-alias-label-secondary); }
.bar-input, .bar-textarea { background:var(--dsw-alias-bg-layer-2); color:var(--dsw-alias-label-primary); border:1px solid var(--dsw-alias-border-l1); border-radius:6px; padding:5px 8px; font-size:12px; font-family:inherit; box-sizing:border-box; width:100%; }
.bar-input:focus, .bar-textarea:focus { outline:1px solid var(--dsw-alias-brand-primary); }
.bar-textarea { min-height:64px; resize:vertical; font-family:ui-monospace, Consolas, monospace; }
.bar-btn { background:var(--dsw-alias-bg-layer-2); color:var(--dsw-alias-label-primary); border:1px solid var(--dsw-alias-border-l2); border-radius:6px; padding:5px 12px; font-size:12px; cursor:pointer; user-select:none; }
.bar-btn:hover { border-color:var(--dsw-alias-brand-primary); color:var(--dsw-alias-brand-primary); }
.bar-btn-primary { background:var(--dsw-alias-brand-primary); border-color:var(--dsw-alias-brand-primary); color:#fff; }
.bar-btn-primary:hover { color:#fff; opacity:.9; }
.bar-badge { display:inline-block; padding:1px 8px; border-radius:999px; font-size:11px; border:1px solid var(--dsw-alias-border-l2); color:var(--dsw-alias-label-secondary); }
.bar-badge-ok { color:var(--dsw-alias-state-success-primary); border-color:var(--dsw-alias-state-success-primary); }
.bar-badge-warn { color:var(--dsw-alias-state-warn-primary); border-color:var(--dsw-alias-state-warn-primary); }
.bar-badge-err { color:var(--dsw-alias-state-error-primary); border-color:var(--dsw-alias-state-error-primary); }
.bar-table { width:100%; border-collapse:collapse; font-size:12px; }
.bar-table th, .bar-table td { text-align:left; padding:4px 8px; border-bottom:1px solid var(--dsw-alias-border-l1); vertical-align:top; }
.bar-table th { color:var(--dsw-alias-label-secondary); font-weight:500; }
.bar-mono { font-family:ui-monospace, Consolas, monospace; }
.bar-error { color:var(--dsw-alias-state-error-primary); font-size:12px; white-space:pre-wrap; }
.bar-ok { color:var(--dsw-alias-state-success-primary); font-size:12px; }
.bar-history-item { border:1px solid var(--dsw-alias-border-l1); border-radius:8px; padding:8px 10px; display:flex; flex-direction:column; gap:4px; background:var(--dsw-alias-bg-layer-2); }
.bar-check { display:flex; align-items:center; gap:6px; }
.bar-footer-card { display:flex; align-items:center; gap:10px; border:1px solid var(--dsw-alias-border-l1); border-radius:10px; background:var(--dsw-alias-bg-layer-1); padding:10px 14px; font-size:12px; color:var(--dsw-alias-label-secondary); }
.bar-dot { width:8px; height:8px; border-radius:50%; display:inline-block; flex:none; }
`;
            // ---- small helpers -------------------------------------------------------
            const fmtTime = (ms) => (ms ? new Date(ms).toLocaleString() : '—');
            /** Panel label for a routing record's source; 'notice' means no model ran. */
            const decisionSourceLabel = (source) => {
                switch (source) {
                    case 'model': return T('决策模型', 'decision model');
                    case 'heuristic': return T('规则', 'heuristic');
                    case 'fallback': return T('回退', 'fallback');
                    case 'media': return T('媒体', 'media');
                    case 'notice': return T('未调用模型(能力闸门)', 'no model call (capability gate)');
                    default: return source ?? '—';
                }
            };
            const fmtDuration = (ms) => {
                if (ms <= 0)
                    return '—';
                const total = Math.ceil(ms / 1000);
                const m = Math.floor(total / 60);
                const s = total % 60;
                return m > 0 ? `${m}m${String(s).padStart(2, '0')}s` : `${s}s`;
            };
            function useRemote(ctx) {
                return useMemo(() => {
                    try {
                        return ctx?.get?.(`remote.${NS}`);
                    }
                    catch (_e) {
                        return undefined;
                    }
                }, [ctx]);
            }
            function Badge(props) {
                const cls = props.tone === 'ok' ? 'bar-badge bar-badge-ok'
                    : props.tone === 'warn' ? 'bar-badge bar-badge-warn'
                        : props.tone === 'err' ? 'bar-badge bar-badge-err' : 'bar-badge';
                return h('span', { className: cls }, props.text);
            }
            // ---- main panel -----------------------------------------------------------
            function Panel(props) {
                const ctx = props.ctx;
                const remote = useRemote(ctx);
                const [state, setState] = useState(null);
                const [draft, setDraft] = useState(null);
                const [busy, setBusy] = useState(false);
                const [error, setError] = useState(null);
                const [notice, setNotice] = useState(null);
                const [selfCheck, setSelfCheck] = useState(null);
                const [acctForm, setAcctForm] = useState({ id: '', name: '', baseURL: '', apiKey: '', apiKeyEnv: '' });
                const alive = useRef(true);
                useEffect(() => () => { alive.current = false; }, []);
                const applyState = useCallback((next) => {
                    if (!alive.current || !next)
                        return;
                    setState(next);
                    setDraft({
                        decisionModel: next.config?.decisionModel ?? '',
                        fallbackModel: next.config?.fallbackModel ?? '',
                        enableDecision: next.config?.enableDecision !== false,
                        decisionTimeoutMs: String(next.config?.decisionTimeoutMs ?? 12000),
                        maxAttempts: String(next.config?.maxAttempts ?? 4),
                        quotaCooldownMinutes: String(next.config?.quotaCooldownMinutes ?? 30),
                        rateLimitCooldownSeconds: String(next.config?.rateLimitCooldownSeconds ?? 120),
                        taskRoutesText: Object.fromEntries(Object.entries(next.config?.taskRoutes ?? {}).map(([k, v]) => [k, v.join(', ')])),
                        modelsText: JSON.stringify(next.config?.models ?? [], null, 1),
                        modelLimitsText: JSON.stringify(next.config?.modelLimits ?? {}, null, 1),
                        maxCandidatesForDecision: String(next.config?.maxCandidatesForDecision ?? 14),
                        includeSpecialEndpoints: next.config?.includeSpecialEndpoints === true,
                        excludeModelsText: (next.config?.excludeModels ?? []).join('\n'),
                        balanceStrategy: next.config?.balanceStrategy ?? 'balanced',
                        balanceWindow: String(next.config?.balanceWindow ?? 6),
                        balanceBand: String(next.config?.balanceBand ?? 0),
                        thinkingEffort: next.config?.thinkingEffort ?? 'auto',
                        vendor: next.config?.vendor ?? 'auto',
                        enableMediaRouting: next.config?.enableMediaRouting !== false,
                    });
                }, []);
                const load = useCallback(async () => {
                    if (!remote)
                        return;
                    setBusy(true);
                    setError(null);
                    try {
                        applyState(unwrap(await remote.getState()));
                    }
                    catch (e) {
                        setError(String(e?.message ?? e));
                    }
                    if (alive.current)
                        setBusy(false);
                }, [remote, applyState]);
                useEffect(() => { void load(); }, [load]);
                useEffect(() => {
                    if (!ctx?.remote?.$on)
                        return undefined;
                    try {
                        return ctx.remote.$on('settings/document-updated', () => { void load(); });
                    }
                    catch (_e) {
                        return undefined;
                    }
                }, [ctx, load]);
                const runSelfCheck = useCallback(async () => {
                    if (!remote)
                        return;
                    setBusy(true);
                    setError(null);
                    setSelfCheck(null);
                    try {
                        const result = unwrap(await remote.selfCheck());
                        if (alive.current)
                            setSelfCheck(result);
                        if (result?.state)
                            applyState(result.state);
                    }
                    catch (e) {
                        setError(String(e?.message ?? e));
                    }
                    if (alive.current)
                        setBusy(false);
                }, [remote, applyState]);
                const mutate = useCallback(async (fn, okMessage) => {
                    if (!remote)
                        return;
                    setBusy(true);
                    setError(null);
                    setNotice(null);
                    try {
                        const result = unwrap(await fn());
                        applyState(result?.state ?? result);
                        if (okMessage)
                            setNotice(okMessage);
                    }
                    catch (e) {
                        setError(String(e?.message ?? e));
                    }
                    if (alive.current)
                        setBusy(false);
                }, [remote, applyState]);
                if (!remote) {
                    return h('div', { className: 'bar-root' }, h('style', null, CSS), h('div', { className: 'bar-card' }, h('h4', null, T('百炼智能路由', 'Bailian auto router')), h('div', { className: 'bar-error' }, T('RPC 通道不可用:请确认插件已启用且 DSH 已重启,然后刷新本页。', 'RPC unavailable: make sure the plugin is enabled and DSH was restarted, then reload this page.'))));
                }
                if (!state || !draft) {
                    return h('div', { className: 'bar-root' }, h('style', null, CSS), h('div', { className: 'bar-card' }, h('span', { className: 'bar-muted' }, busy ? T('加载中…', 'Loading…') : T('等待状态…', 'Waiting for state…')), error ? h('div', { className: 'bar-error' }, error) : null));
                }
                const cfg = state.config;
                const saveConfig = () => {
                    const taskRoutes = {};
                    for (const [task, text] of Object.entries(draft.taskRoutesText ?? {})) {
                        taskRoutes[task] = String(text).split(/[\n,，]/).map((s) => s.trim()).filter((s) => s.length > 0);
                    }
                    let models;
                    try {
                        models = JSON.parse(draft.modelsText || '[]');
                        if (!Array.isArray(models))
                            throw new Error(T('models 必须是数组', 'models must be an array'));
                    }
                    catch (e) {
                        setError(T('自定义模型池 JSON 无效: ', 'Invalid models JSON: ') + String(e?.message ?? e));
                        return;
                    }
                    let modelLimits;
                    try {
                        modelLimits = JSON.parse(draft.modelLimitsText || '{}');
                        if (typeof modelLimits !== 'object' || modelLimits === null || Array.isArray(modelLimits)) {
                            throw new Error(T('额度上限必须是对象', 'model limits must be an object'));
                        }
                    }
                    catch (e) {
                        setError(T('额度上限 JSON 无效: ', 'Invalid model limits JSON: ') + String(e?.message ?? e));
                        return;
                    }
                    const patch = {
                        decisionModel: String(draft.decisionModel ?? '').trim(),
                        fallbackModel: String(draft.fallbackModel ?? '').trim(),
                        enableDecision: draft.enableDecision === true,
                        decisionTimeoutMs: Number(draft.decisionTimeoutMs),
                        maxAttempts: Number(draft.maxAttempts),
                        quotaCooldownMinutes: Number(draft.quotaCooldownMinutes),
                        rateLimitCooldownSeconds: Number(draft.rateLimitCooldownSeconds),
                        maxCandidatesForDecision: Number(draft.maxCandidatesForDecision ?? cfg.maxCandidatesForDecision ?? 14),
                        balanceStrategy: draft.balanceStrategy ?? cfg.balanceStrategy ?? 'balanced',
                        balanceWindow: Number(draft.balanceWindow ?? cfg.balanceWindow ?? 6),
                        balanceBand: Number(draft.balanceBand ?? cfg.balanceBand ?? 0),
                        thinkingEffort: draft.thinkingEffort ?? cfg.thinkingEffort ?? 'auto',
                        vendor: draft.vendor ?? cfg.vendor ?? 'auto',
                        enableMediaRouting: draft.enableMediaRouting !== false,
                        includeSpecialEndpoints: draft.includeSpecialEndpoints === true,
                        excludeModels: String(draft.excludeModelsText ?? (cfg.excludeModels ?? []).join('\n'))
                            .split(/[\n,，]/).map((s) => s.trim()).filter((s) => s.length > 0),
                        taskRoutes,
                        models,
                        modelLimits,
                    };
                    if (!patch.decisionModel || !patch.fallbackModel) {
                        setError(T('决策模型与回退模型不能为空', 'Decision and fallback models cannot be empty'));
                        return;
                    }
                    for (const key of ['decisionTimeoutMs', 'maxAttempts', 'quotaCooldownMinutes', 'rateLimitCooldownSeconds']) {
                        if (!Number.isFinite(patch[key]) || patch[key] <= 0) {
                            setError(T(`字段 ${key} 必须是正数`, `Field ${key} must be a positive number`));
                            return;
                        }
                    }
                    void mutate(() => remote.updateConfig(patch), T('配置已保存(volatile 字段即时生效)', 'Configuration saved (volatile fields apply immediately)'));
                };
                const field = (label, value, onChange) => h('div', { className: 'bar-field' }, h('label', null, label), h('input', { className: 'bar-input bar-mono', value: String(value ?? ''), onChange: (e) => onChange(e.target.value) }));
                const TASK_LABELS = {
                    image: T('图片分析', 'Image analysis'),
                    writing: T('中文写作/润色', 'Writing / polish'),
                    translation: T('翻译', 'Translation'),
                    code: T('代码', 'Code'),
                    reasoning: T('复杂逻辑/推理', 'Reasoning'),
                    general: T('通用', 'General'),
                };
                // ---- API account selection & management --------------------------------
                const accounts = cfg.accounts ?? [];
                const activeAccountId = cfg.activeAccountId ?? '';
                const accountSelectValue = activeAccountId !== ''
                    ? `acct:${activeAccountId}`
                    : state.adopted ? `conn:${state.adopted.entryId}|${state.adopted.providerId}` : '';
                const onAccountSelect = (value) => {
                    if (value.startsWith('acct:')) {
                        void mutate(() => remote.activateAccount(value.slice(5)), T('已切换账号并重新同步模型池', 'Account switched and pool resynced'));
                    }
                    else if (value.startsWith('conn:')) {
                        const sep = value.indexOf('|');
                        const entryId = value.slice(5, sep);
                        const providerId = value.slice(sep + 1);
                        void mutate(() => remote.switchConnection(entryId, providerId), T('已切换连接并重新同步模型池', 'Connection switched and pool resynced'));
                    }
                    else {
                        void mutate(() => remote.activateAccount(''), T('已回到默认接口/自动沿用', 'Back to default endpoint / auto-adopt'));
                    }
                };
                const resetAcctForm = () => setAcctForm({ id: '', name: '', baseURL: '', apiKey: '', apiKeyEnv: '' });
                const saveAccount = () => {
                    const name = String(acctForm.name ?? '').trim();
                    const baseURL = String(acctForm.baseURL ?? '').trim();
                    const apiKey = String(acctForm.apiKey ?? '').trim();
                    const apiKeyEnv = String(acctForm.apiKeyEnv ?? '').trim();
                    if (!name || !baseURL) {
                        setError(T('账号名称与接口地址不能为空', 'Account name and endpoint are required'));
                        return;
                    }
                    if (!apiKey && !apiKeyEnv && !acctForm.id) {
                        setError(T('请填写 API Key 或凭据引用', 'Provide an API key or a credential reference'));
                        return;
                    }
                    const id = acctForm.id || ('a' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6));
                    const account = { id, name, baseURL };
                    if (apiKey)
                        account.apiKey = apiKey;
                    if (apiKeyEnv)
                        account.apiKeyEnv = apiKeyEnv;
                    void mutate(() => remote.upsertAccount(account), T('账号已保存', 'Account saved'));
                    resetAcctForm();
                };
                return h('div', { className: 'bar-root' }, h('style', null, CSS), 
                // ---- overview ----
                h('div', { className: 'bar-card' }, h('div', { className: 'bar-row' }, h('h4', null, T('百炼智能路由 · 状态', 'Bailian auto router · status')), h(Badge, { tone: cfg.apiKeyConfigured ? 'ok' : 'err', text: cfg.apiKeyConfigured ? T('API Key 已配置', 'API key set') : T('API Key 未配置', 'API key missing') }), h(Badge, { tone: cfg.enableDecision ? 'ok' : 'warn', text: cfg.enableDecision ? T('决策模型开启', 'decision on') : T('决策模型关闭(启发式)', 'decision off (heuristic)') }), h('span', { className: 'bar-muted bar-mono' }, `${state.provider}/${state.model}`)), h('div', { className: 'bar-row' }, h('label', { className: 'bar-muted' }, T('当前 API 账号', 'Active API account')), h('select', {
                    className: 'bar-input',
                    style: { maxWidth: '460px' },
                    value: accountSelectValue,
                    onChange: (e) => onAccountSelect(e.target.value),
                }, h('option', { value: '' }, T('默认接口 / 自动沿用', 'Default endpoint / auto-adopt')), ...accounts.map((a) => h('option', { key: a.id, value: `acct:${a.id}` }, a.name)), ...(state.candidates ?? []).map((c) => h('option', {
                    key: `${c.entryId}|${c.providerId}`,
                    value: `conn:${c.entryId}|${c.providerId}`,
                }, T('profile 连接: ', 'Profile: ') + `${c.entryId} → ${c.providerId}`))), h('span', { className: 'bar-muted', style: { fontSize: '11px' } }, T('切换后自动重新同步模型池并重置冷却', 'Switching resyncs the pool and resets cooldowns'))), h('div', { className: 'bar-row bar-muted' }, h('span', null, T('接口: ', 'Endpoint: '), h('span', { className: 'bar-mono' }, cfg.baseURL)), h('span', null, T('凭据引用: ', 'Credential ref: '), h('span', { className: 'bar-mono' }, cfg.apiKeyEnv)), h('span', null, T('最近同步: ', 'Last sync: '), fmtTime(state.pool?.lastSyncAt ?? null))), h('div', { className: 'bar-row' }, h(Badge, { tone: 'ok', text: T(`账号可用 ${state.pool?.total ?? 0} 个 → 可对话 ${state.pool?.count ?? 0} 个`, `${state.pool?.total ?? 0} reachable → ${state.pool?.count ?? 0} chat models`) }), h(Badge, { tone: 'ok', text: T(`视觉模型 ${state.pool?.visionCount ?? 0} 个`, `${state.pool?.visionCount ?? 0} vision`) }), h(Badge, { tone: 'none', text: T(`已排除非对话模型 ${(state.pool?.excluded ?? []).length} 个`, `${(state.pool?.excluded ?? []).length} non-chat excluded`) })), state.derived && (state.derived.decisionModel || state.derived.fallbackModel)
                    ? h('div', { className: 'bar-muted' }, T(`当前账号不提供配置的模型,已自动替代: 决策=${cfg.decisionModel}(原 ${cfg.decisionModelConfigured}),回退=${cfg.fallbackModel}(原 ${cfg.fallbackModelConfigured})。换账号后无需改动配置。`, `This account does not serve the configured models; substituted decision=${cfg.decisionModel} (was ${cfg.decisionModelConfigured}), fallback=${cfg.fallbackModel} (was ${cfg.fallbackModelConfigured}).`))
                    : null, state.adopted
                    ? h('div', { className: 'bar-muted' }, T(`已自动沿用 profile 中 ${state.adopted.entryId} → ${state.adopted.providerId} 的接口与凭据(无需重复配置)。`, `Reusing the endpoint and credential of ${state.adopted.entryId} → ${state.adopted.providerId} from this profile.`))
                    : (state.candidates ?? []).length > 0
                        ? h('div', { className: 'bar-muted' }, T(`检测到 ${state.candidates.length} 个阿里云兼容连接;把「接口」设为默认值可自动沿用。`, `${state.candidates.length} Aliyun-compatible connection(s) found; keep the shipped endpoint to reuse one.`))
                        : null, state.pool?.lastSyncError ? h('div', { className: 'bar-error' }, T('同步失败: ', 'Sync failed: '), state.pool.lastSyncError) : null, notice ? h('div', { className: 'bar-ok' }, notice) : null, error ? h('div', { className: 'bar-error' }, error) : null), 
                // ---- API account management ----
                h('div', { className: 'bar-card' }, h('h4', null, T('API 账号管理(添加 / 切换多个百炼账号)', 'API accounts (add / switch Bailian accounts)')), h('div', { className: 'bar-muted', style: { fontSize: '11px' } }, T('Key 以 secret 形式存于本机配置,面板打码显示,绝不写入 state.json 或日志;也可只填凭据引用(环境变量名)。', 'Keys are stored as secrets in local config, masked here, never in state.json or logs; a credential ref (env name) also works.')), accounts.length === 0
                    ? h('div', { className: 'bar-muted' }, T('还没有保存的账号。在下方添加,或继续使用默认接口/自动沿用。', 'No saved accounts yet. Add one below, or keep the default endpoint / auto-adopt.'))
                    : h('div', { style: { display: 'flex', flexDirection: 'column', gap: '8px' } }, ...accounts.map((a) => h('div', { key: a.id, className: 'bar-history-item' }, h('div', { className: 'bar-row' }, h('strong', null, a.name), a.active ? h(Badge, { tone: 'ok', text: T('使用中', 'active') }) : null, h('span', { className: 'bar-muted bar-mono', style: { fontSize: '11px', wordBreak: 'break-all' } }, a.baseURL)), h('div', { className: 'bar-row bar-muted', style: { fontSize: '11px' } }, h('span', null, a.hasKey
                        ? T('Key: ', 'Key: ') + (a.keyHint ?? '••••')
                        : T('凭据引用: ', 'Credential ref: ') + (a.apiKeyEnv ?? '—')), h('div', { className: 'bar-btn', role: 'button', onClick: () => setAcctForm({ id: a.id, name: a.name, baseURL: a.baseURL, apiKey: '', apiKeyEnv: a.apiKeyEnv ?? '' }) }, T('编辑', 'Edit')), a.active ? null : h('div', { className: 'bar-btn', role: 'button', onClick: () => void mutate(() => remote.activateAccount(a.id), T('已切换账号并重新同步模型池', 'Account switched and pool resynced')) }, T('启用', 'Use')), h('div', { className: 'bar-btn', role: 'button', onClick: () => void mutate(() => remote.removeAccount(a.id), T('账号已删除', 'Account removed')) }, T('删除', 'Delete')))))), h('div', { className: 'bar-row' }, field(T('账号名称', 'Account name'), acctForm.name, (v) => setAcctForm({ ...acctForm, name: v })), field(T('接口地址 baseURL', 'Endpoint baseURL'), acctForm.baseURL, (v) => setAcctForm({ ...acctForm, baseURL: v }))), h('div', { className: 'bar-row' }, h('div', { className: 'bar-field' }, h('label', null, T('API Key(编辑时留空=保留原 Key)', 'API key (blank when editing = keep stored key)')), h('input', {
                    className: 'bar-input bar-mono', type: 'password', value: acctForm.apiKey, placeholder: 'sk-…',
                    onChange: (e) => setAcctForm({ ...acctForm, apiKey: e.target.value }),
                })), field(T('或凭据引用(环境变量名,可选)', 'Or credential ref (env name, optional)'), acctForm.apiKeyEnv, (v) => setAcctForm({ ...acctForm, apiKeyEnv: v }))), h('div', { className: 'bar-row' }, h('div', { className: 'bar-btn bar-btn-primary', role: 'button', onClick: saveAccount }, acctForm.id ? T('保存修改', 'Save changes') : T('添加账号', 'Add account')), acctForm.id ? h('div', { className: 'bar-btn', role: 'button', onClick: resetAcctForm }, T('取消编辑', 'Cancel edit')) : null)), 
                // ---- routing configuration ----
                h('div', { className: 'bar-card' }, h('h4', null, T('路由与容灾配置', 'Routing & failover')), h('div', { className: 'bar-row' }, h('label', { className: 'bar-check' }, h('input', { type: 'checkbox', checked: draft.enableDecision !== false, onChange: (e) => setDraft({ ...draft, enableDecision: e.target.checked }) }), T('启用决策模型(关闭后仅按启发式规则路由)', 'Enable decision model (heuristics only when off)'))), h('div', { className: 'bar-row' }, field(T('决策模型', 'Decision model'), draft.decisionModel, (v) => setDraft({ ...draft, decisionModel: v })), field(T('回退模型(决策失败时)', 'Fallback model'), draft.fallbackModel, (v) => setDraft({ ...draft, fallbackModel: v })), field(T('决策超时 ms', 'Decision timeout (ms)'), draft.decisionTimeoutMs, (v) => setDraft({ ...draft, decisionTimeoutMs: v })), field(T('单请求最多尝试模型数', 'Max attempts per request'), draft.maxAttempts, (v) => setDraft({ ...draft, maxAttempts: v }))), h('div', { className: 'bar-row' }, field(T('额度耗尽冷却(分钟)', 'Quota cooldown (minutes)'), draft.quotaCooldownMinutes, (v) => setDraft({ ...draft, quotaCooldownMinutes: v })), field(T('限流/网络冷却(秒)', 'Rate-limit cooldown (seconds)'), draft.rateLimitCooldownSeconds, (v) => setDraft({ ...draft, rateLimitCooldownSeconds: v }))), h('div', { className: 'bar-row' }, h('div', { className: 'bar-btn bar-btn-primary', role: 'button', onClick: saveConfig }, T('保存配置', 'Save')), h('div', { className: 'bar-btn', role: 'button', onClick: () => void load() }, T('重新载入', 'Reload')), h('span', { className: 'bar-muted' }, T('保存写入 profile 的 cordis.patch.yml;volatile 字段即时生效', 'Saves into the profile cordis.patch.yml; volatile fields apply live')))), 
                // ---- task routes ----
                h('div', { className: 'bar-card' }, h('h4', null, T('各任务类型候选模型(逗号/换行分隔,按优先级排序)', 'Task candidate lists (comma/newline separated, priority order)')), h('div', { className: 'bar-row' }, ...['image', 'writing', 'translation', 'code', 'reasoning', 'general'].map(task => h('div', { className: 'bar-field', key: task }, h('label', null, TASK_LABELS[task]), h('textarea', {
                    className: 'bar-textarea',
                    value: draft.taskRoutesText?.[task] ?? '',
                    onChange: (e) => setDraft({ ...draft, taskRoutesText: { ...draft.taskRoutesText, [task]: e.target.value } }),
                })))), h('div', { className: 'bar-field' }, h('label', null, T('自定义模型池(JSON 数组,覆盖内置目录;字段: id,name,vision,contextWindow,maxTokens,tags)', 'Custom pool (JSON array; fields: id,name,vision,contextWindow,maxTokens,tags)')), h('textarea', {
                    className: 'bar-textarea', style: { minHeight: '96px' }, value: draft.modelsText ?? '[]',
                    onChange: (e) => setDraft({ ...draft, modelsText: e.target.value }),
                }))), (() => {
                    const models = state.pool?.models ?? [];
                    const media = state.pool?.media ?? {};
                    const quota = state.quota ?? [];
                    const quotaBy = new Map(quota.map((q) => [q.model, q]));
                    const byId = new Map(models.map((m) => [m.id, m]));
                    const pick = (ids) => [...new Set(ids)];
                    const withTask = (task) => models.filter((m) => (m.tasks ?? []).includes(task)).map((m) => m.id);
                    const GROUPS = [
                        { key: 'image', label: T('图像', 'Image'), ids: pick([...(media.image ?? []), ...withTask('image')]) },
                        { key: 'speech', label: T('语音', 'Speech'), ids: pick([...(media.speech ?? []), ...(media.asr ?? []), ...(media.realtime ?? [])]) },
                        { key: 'reasoning', label: T('推理', 'Reasoning'), ids: pick(withTask('reasoning')) },
                        { key: 'code', label: T('代码', 'Code'), ids: pick(withTask('code')) },
                        { key: 'writing', label: T('写作', 'Writing'), ids: pick(withTask('writing')) },
                        { key: 'translation', label: T('翻译', 'Translation'), ids: pick(withTask('translation')) },
                        { key: 'general', label: T('通用', 'General'), ids: pick(withTask('general')) },
                    ];
                    const modelRow = (id) => {
                        const meta = byId.get(id);
                        const q = quotaBy.get(id);
                        const available = q?.available ?? true;
                        return h('tr', { key: id }, h('td', { className: 'bar-mono', style: { wordBreak: 'break-all' } }, id, meta?.name && meta.name !== id ? h('span', { className: 'bar-muted' }, ` (${meta.name})`) : null), h('td', null, meta?.source ?? '—'), h('td', null, meta?.vision ? '✓' : '—'), h('td', null, available
                            ? h(Badge, { tone: 'ok', text: T('可用', 'available') })
                            : h(Badge, { tone: 'warn', text: `${T('冷却中', 'cooldown')} ${fmtDuration(q?.cooldownRemainingMs ?? 0)}` })), h('td', null, String(q?.fails ?? 0)), h('td', null, String(q?.calls ?? 0)), h('td', { className: 'bar-muted' }, q?.lastFailCode ?? '—'), h('td', null, available ? null : h('div', {
                            className: 'bar-btn', role: 'button',
                            onClick: () => void mutate(() => remote.resetQuota(id), T('已解除冷却: ', 'Cooldown cleared: ') + id),
                        }, T('解除', 'Clear'))));
                    };
                    return h('div', { className: 'bar-card' }, h('div', { className: 'bar-row' }, h('h4', null, T('模型池(按分类展开)', 'Model pool (collapsible by category)')), h('div', {
                        className: 'bar-btn', role: 'button',
                        onClick: () => void mutate(() => remote.refreshPool(), T('已从百炼拉取模型列表', 'Model list refreshed from Bailian')),
                    }, T('刷新模型列表', 'Refresh pool')), h('div', {
                        className: 'bar-btn', role: 'button',
                        onClick: () => void mutate(() => remote.resetQuota(), T('已解除全部冷却', 'All cooldowns cleared')),
                    }, T('全部解除冷却', 'Clear all cooldowns'))), GROUPS.map((g) => {
                        if (g.ids.length === 0)
                            return null;
                        return h('details', { key: g.key, style: { borderTop: '1px solid var(--dsw-alias-border-l1)', padding: '6px 0' } }, h('summary', { className: 'bar-muted', style: { cursor: 'pointer', userSelect: 'none' } }, `${g.label} · ${g.ids.length} 个`), h('div', { style: { maxHeight: '240px', overflow: 'auto', marginTop: '4px' } }, h('table', { className: 'bar-table' }, h('thead', null, h('tr', null, h('th', null, T('模型', 'Model')), h('th', null, T('来源', 'Source')), h('th', null, T('视觉', 'Vision')), h('th', null, T('冷却', 'Cooldown')), h('th', null, T('连败', 'Fails')), h('th', null, T('调用', 'Calls')), h('th', null, T('错误', 'Error')), h('th', null, ''))), h('tbody', null, g.ids.slice(0, 300).map((id) => modelRow(id))))));
                    }));
                })(), 
                // ---- per-model usage limits ----
                h('div', { className: 'bar-card' }, h('div', { className: 'bar-row' }, h('h4', null, T('每模型额度上限', 'Per-model usage limits')), h('div', {
                    className: 'bar-btn', role: 'button',
                    onClick: () => void mutate(() => remote.resetModelTotals(), T('已重置全部用量', 'All usage reset')),
                }, T('重置全部用量', 'Reset all usage'))), h('div', { className: 'bar-muted' }, T('给单个模型设用量上限(token 和/或调用次数),达到上限就停用它并路由下一个;不设=自动均衡。JSON: { "模型id": { "maxCalls": 100, "maxTokens": 1000000 } },把某模型的值设为 null 即清除它的上限。', 'Set a per-model cap (tokens and/or calls). Reaching it stops the model and routing moves on; unset = auto-balance. JSON: { "model-id": { "maxCalls": 100, "maxTokens": 1000000 } }; null clears a model\'s limit.')), h('textarea', {
                    className: 'bar-textarea', style: { minHeight: '80px' },
                    value: draft.modelLimitsText ?? '{}',
                    onChange: (e) => setDraft({ ...draft, modelLimitsText: e.target.value }),
                }), h('div', { style: { maxHeight: '200px', overflow: 'auto', marginTop: '4px' } }, h('table', { className: 'bar-table' }, h('thead', null, h('tr', null, h('th', null, T('模型', 'Model')), h('th', null, T('调用', 'Calls')), h('th', null, T('token', 'Tokens')), h('th', null, T('上限', 'Limit')), h('th', null, T('状态', 'Status')), h('th', null, ''))), h('tbody', null, (state.pool?.models ?? []).map((m) => {
                    const usage = state.modelUsage?.[m.id] ?? { calls: 0, tokens: 0 };
                    const limit = state.config?.modelLimits?.[m.id];
                    const overCalls = typeof limit?.maxCalls === 'number' && usage.calls >= limit.maxCalls;
                    const overTokens = typeof limit?.maxTokens === 'number' && usage.tokens >= limit.maxTokens;
                    const over = overCalls || overTokens;
                    const limitText = limit === undefined ? '—'
                        : [typeof limit.maxCalls === 'number' ? `${limit.maxCalls} 次` : '', typeof limit.maxTokens === 'number' ? `${limit.maxTokens} tok` : ''].filter(Boolean).join(' / ');
                    return h('tr', { key: m.id }, h('td', { className: 'bar-mono', style: { wordBreak: 'break-all' } }, m.id), h('td', null, String(usage.calls)), h('td', null, String(usage.tokens)), h('td', { className: 'bar-muted' }, limitText), h('td', null, limit === undefined
                        ? h(Badge, { tone: 'none', text: T('未设限', 'unlimited') })
                        : over
                            ? h(Badge, { tone: 'err', text: T('超限', 'exhausted') })
                            : h(Badge, { tone: 'ok', text: T('额度内', 'within') })), h('td', null, (usage.calls > 0 || usage.tokens > 0) ? h('div', {
                        className: 'bar-btn', role: 'button',
                        onClick: () => void mutate(() => remote.resetModelTotals(m.id), T('已重置用量: ', 'Usage reset: ') + m.id),
                    }, T('重置', 'Reset')) : null));
                }))))), 
                // ---- integrity self-check ----
                h('div', { className: 'bar-card' }, h('div', { className: 'bar-row' }, h('h4', null, T('一键检测完整性', 'One-click integrity check')), h('div', { className: 'bar-btn bar-btn-primary', role: 'button', onClick: () => void runSelfCheck() }, busy ? T('检测中…', 'Checking…') : T('开始检测', 'Run check'))), selfCheck === null ? null : h('div', { style: { display: 'flex', flexDirection: 'column', gap: '4px' } }, h('div', { className: selfCheck.ok ? 'bar-ok' : 'bar-error' }, selfCheck.ok
                    ? T('✓ 全部通过,插件可在本机正常使用', 'All checks passed — the plugin works on this machine')
                    : T('✗ 存在未通过项,按下面的提示修复后重试', 'Some checks failed — follow the hints below and retry')), (selfCheck.items ?? []).map((item, index) => h('div', { key: `${item.name}-${index}`, className: 'bar-row', style: { alignItems: 'flex-start' } }, h('span', { style: { color: item.ok ? 'var(--dsw-alias-state-success-primary)' : 'var(--dsw-alias-state-error-primary)', width: '18px', flex: 'none' } }, item.ok ? '✓' : '✗'), h('span', { style: { minWidth: '130px', flex: 'none' } }, item.name), h('span', { className: 'bar-muted', style: { flex: '1 1 auto' } }, item.detail), item.hint ? h('span', { className: 'bar-muted', style: { display: 'block', width: '100%' } }, T('→ ', '→ ') + item.hint) : null)))), 
                // ---- connection switcher ----
                h('div', { className: 'bar-card' }, h('h4', null, T('阿里云连接(换账号时在这里切换)', 'Aliyun connection (switch accounts here)')), (state.candidates ?? []).length === 0
                    ? h('div', { className: 'bar-muted' }, T('本 profile 未发现其他阿里云兼容 provider;可直接编辑上方接口与凭据引用,或继续自动沿用当前值。', 'No other Aliyun-compatible provider in this profile; edit the endpoint and credential above.'))
                    : h('div', { className: 'bar-row' }, ...(state.candidates ?? []).map((candidate) => h('div', {
                        key: `${candidate.entryId}#${candidate.providerId}`,
                        className: 'bar-card',
                        style: { padding: '8px 10px', minWidth: '260px' },
                    }, h('div', { className: 'bar-row' }, h('span', { className: 'bar-mono' }, `${candidate.entryId} → ${candidate.providerId}`), candidate.current ? h(Badge, { tone: 'ok', text: T('当前使用', 'in use') }) : null), h('div', { className: 'bar-muted bar-mono', style: { fontSize: '11px', wordBreak: 'break-all' } }, candidate.baseURL), h('div', { className: 'bar-muted', style: { fontSize: '11px' } }, T('凭据: ', 'credential: ') + (candidate.apiKeyEnv ?? '—')), candidate.current ? null : h('div', {
                        className: 'bar-btn', role: 'button', style: { marginTop: '6px' },
                        onClick: () => void mutate(() => remote.switchConnection(candidate.entryId, candidate.providerId), T('已切换连接并重新同步模型池', 'Connection switched and pool resynced')),
                    }, T('切到这个账号', 'Switch to this account')))))), 
                // ---- balancing & thinking ----
                h('div', { className: 'bar-card' }, h('h4', null, T('负载均衡与思考档位', 'Load balancing & thinking effort')), h('div', { className: 'bar-row' }, h('div', { className: 'bar-field' }, h('label', null, T('均衡策略', 'Balancing strategy')), h('select', {
                    className: 'bar-input',
                    value: draft.balanceStrategy ?? 'balanced',
                    onChange: (e) => setDraft({ ...draft, balanceStrategy: e.target.value }),
                }, h('option', { value: 'balanced' }, T('按 token 消耗均衡(推荐)', 'Balance by token usage')), h('option', { value: 'quality' }, T('始终用最优模型', 'Always use the best model')))), field(T('轮转候选个数', 'Rotation window'), draft.balanceWindow, (v) => setDraft({ ...draft, balanceWindow: v })), field(T('分数保护带(0=关闭)', 'Score guard band (0 = off)'), draft.balanceBand, (v) => setDraft({ ...draft, balanceBand: v })), h('div', { className: 'bar-field' }, h('label', null, T('厂商预设', 'Vendor preset')), h('select', {
                    className: 'bar-input',
                    value: draft.vendor ?? 'auto',
                    onChange: (e) => setDraft({ ...draft, vendor: e.target.value }),
                }, h('option', { value: 'auto' }, T('自动(按接口地址识别)', 'Auto (detect from endpoint)')), h('option', { value: 'bailian' }, T('阿里云百炼', 'Aliyun Bailian')), h('option', { value: 'siliconflow' }, T('硅基流动', 'SiliconFlow')), h('option', { value: 'openrouter' }, 'OpenRouter'), h('option', { value: 'volcengine' }, T('火山方舟', 'Volcengine Ark')), h('option', { value: 'zhipu' }, T('智谱开放平台', 'Zhipu')), h('option', { value: 'moonshot' }, 'Moonshot'), h('option', { value: 'deepseek' }, T('DeepSeek 官方', 'DeepSeek official')), h('option', { value: 'generic' }, T('通用 OpenAI 兼容', 'Generic OpenAI-compatible')))), h('div', { className: 'bar-field' }, h('label', null, T('思考档位策略', 'Thinking effort policy')), h('select', {
                    className: 'bar-input',
                    value: draft.thinkingEffort ?? 'auto',
                    onChange: (e) => setDraft({ ...draft, thinkingEffort: e.target.value }),
                }, h('option', { value: 'auto' }, T('自动(按任务复杂度)', 'Auto (by task complexity)')), h('option', { value: 'off' }, T('关闭', 'Off')), h('option', { value: 'low' }, 'low'), h('option', { value: 'medium' }, 'medium'), h('option', { value: 'high' }, 'high'), h('option', { value: 'max' }, 'max')))), h('div', { className: 'bar-muted' }, T('均衡: 同一任务在排名前 N 的同类模型之间按近期 token 消耗轮转,避免每次都用同一个旗舰。思考档位: auto 会按输入长度、代码密度、推理词汇、已执行工具步数估算复杂度并下发对应档位(trivial→off, simple→low, normal→medium, complex→high, deep→max)。', 'Balancing rotates among the top-N task candidates by recent token usage. Auto effort estimates complexity from length, code density, reasoning vocabulary and tool steps.')), h('div', { className: 'bar-row' }, h('label', { className: 'bar-check' }, h('input', {
                    type: 'checkbox',
                    checked: draft.enableMediaRouting !== false,
                    onChange: (e) => setDraft({ ...draft, enableMediaRouting: e.target.checked }),
                }), T('启用媒体路由(图像生成走 /images/generations)', 'Enable media routing (image generation)')), h('span', { className: 'bar-muted' }, T(`可路由媒体: 图像 ${(state.pool?.media?.image ?? []).length} 个 · 语音 ${(state.pool?.media?.speech ?? []).length} 个 · 识别 ${(state.pool?.media?.asr ?? []).length} 个`, `Media: image ${(state.pool?.media?.image ?? []).length}, speech ${(state.pool?.media?.speech ?? []).length}, asr ${(state.pool?.media?.asr ?? []).length}`)))), 
                // ---- pool composition ----
                h('div', { className: 'bar-card' }, h('div', { className: 'bar-row' }, h('h4', null, T('模型池构成(来自本账号 /models 列表)', 'Pool composition (this account\'s /models)')), h('div', {
                    className: 'bar-btn', role: 'button',
                    onClick: () => void mutate(() => remote.refreshPool(), T('已重新拉取模型列表', 'Model list refreshed')),
                }, T('重新拉取', 'Resync'))), h('div', { className: 'bar-muted' }, T(`可对话 ${state.pool?.count ?? 0} 个 / 共 ${state.pool?.total ?? 0} 个;排除 ${(state.pool?.excluded ?? []).length} 个(TTS、语音识别、向量化、重排、图像/视频生成、实时流等不走 chat 接口)。`, `${state.pool?.count ?? 0} chat-capable of ${state.pool?.total ?? 0}; ${(state.pool?.excluded ?? []).length} excluded (TTS/ASR/embedding/rerank/image/video/realtime endpoints).`)), h('div', { className: 'bar-row' }, h('div', { className: 'bar-field' }, h('label', null, T('排除规则(每行一个 id 或前缀*)', 'Exclude patterns (one per line)')), h('textarea', {
                    className: 'bar-textarea',
                    value: (cfg.excludeModels ?? []).join('\n'),
                    onChange: (e) => setDraft({ ...draft, excludeModelsText: e.target.value }),
                })), h('div', { className: 'bar-field' }, h('label', null, T('决策模型看到的候选数量(其余作为回退链)', 'Candidates shown to the decision model')), h('input', {
                    className: 'bar-input bar-mono',
                    value: String(draft.maxCandidatesForDecision ?? cfg.maxCandidatesForDecision ?? 14),
                    onChange: (e) => setDraft({ ...draft, maxCandidatesForDecision: e.target.value }),
                }))), h('div', { className: 'bar-row' }, h('label', { className: 'bar-check' }, h('input', {
                    type: 'checkbox',
                    checked: draft.includeSpecialEndpoints === true || (draft.includeSpecialEndpoints === undefined && cfg.includeSpecialEndpoints === true),
                    onChange: (e) => setDraft({ ...draft, includeSpecialEndpoints: e.target.checked }),
                }), T('把 deep-research / deep-search-planning 等特殊端点也纳入候选', 'Include agent/research-only endpoints as candidates'))), (state.pool?.excluded ?? []).length === 0 ? null : h('details', null, h('summary', { className: 'bar-muted' }, T('查看被排除的模型', 'Show excluded models')), h('div', { style: { maxHeight: '160px', overflow: 'auto', marginTop: '6px' } }, h('table', { className: 'bar-table' }, h('tbody', null, (state.pool?.excluded ?? []).slice(0, 200).map((row) => h('tr', { key: row.id }, h('td', { className: 'bar-mono' }, row.id), h('td', { className: 'bar-muted' }, row.reason)))))))), 
                // ---- history ----
                h('div', { className: 'bar-card' }, h('div', { className: 'bar-row' }, h('h4', null, T('最近路由决策(最多 50 条)', 'Recent routing decisions (last 50)')), h('div', {
                    className: 'bar-btn', role: 'button',
                    onClick: () => void mutate(() => remote.clearHistory(), T('历史已清空', 'History cleared')),
                }, T('清空', 'Clear'))), (state.history ?? []).length === 0
                    ? h('div', { className: 'bar-muted' }, T('暂无记录;在会话中把模型切到「百炼智能路由」发起对话后回到这里查看。', 'No records yet; pick the "bailian-auto" model in a session and come back.'))
                    : h('div', { style: { display: 'flex', flexDirection: 'column', gap: '8px', maxHeight: '360px', overflow: 'auto' } }, (state.history ?? []).map((r, i) => h('div', { className: 'bar-history-item', key: `${r.at}-${i}` }, h('div', { className: 'bar-row' }, h(Badge, { tone: r.ok ? 'ok' : 'err', text: r.ok ? T('成功', 'ok') : T('失败', 'failed') }), h('span', { className: 'bar-mono' }, r.finalModel ?? '—'), h('span', { className: 'bar-muted' }, `${fmtTime(r.at)} · ${r.task} · ${r.modality} · ${decisionSourceLabel(r.decisionSource)}`
                        + (r.decisionTokens ? ` · 决策 ${r.decisionTokens} tok` : ''))), r.reasoning ? h('div', { className: 'bar-muted' }, r.reasoning) : null, (r.attempts ?? []).length > 1
                        ? h('div', { className: 'bar-muted bar-mono' }, T('尝试链: ', 'attempts: ') + r.attempts.map((a) => `${a.model}${a.ok ? '✓' : `✗(${a.code ?? '?'})`}`).join(' → '))
                        : null)))));
            }
            // ---- Settings → Models footer card ---------------------------------------
            // The footer card needs the client ctx; capture it from apply().
            let clientCtx = null;
            /** Why the Remote contribution did not mount, shown in the footer card. */
            let mountFailure = null;
            function FooterCard() {
                const [line, setLine] = useState(null);
                useEffect(() => {
                    let disposed = false;
                    let missing = false;
                    const run = async () => {
                        try {
                            const remote = clientCtx?.get?.(`remote.${NS}`);
                            if (!remote) {
                                // Say so instead of leaving the card on "loading" forever: a
                                // failed mount is the one failure the panel cannot show.
                                if (!disposed && !missing) {
                                    missing = true;
                                    const detail = mountFailure === null ? '' : `: ${mountFailure}`;
                                    setLine(T(`百炼智能路由:远程通道未挂载 · 改用内置配置表单${detail}`, `Bailian auto router: remote channel not mounted · using the built-in form${detail}`));
                                }
                                return;
                            }
                            const state = unwrap(await remote.getState());
                            if (disposed || !state)
                                return;
                            const cooling = (state.quota ?? []).filter((q) => !q.available).length;
                            setLine(`${state.modelName} (bailian-auto) · ${T('决策模型', 'decision')} ${state.config?.decisionModel ?? '?'} · ${T('模型池', 'pool')} ${state.pool?.count ?? 0} · ${T('冷却中', 'cooling')} ${cooling}`);
                        }
                        catch (_e) { /* stay silent in the footer */ }
                    };
                    void run();
                    const timer = setInterval(() => { void run(); }, 30_000);
                    return () => { disposed = true; clearInterval(timer); };
                }, []);
                return h('div', { className: 'bar-footer-card' }, h('style', null, CSS), h('span', { className: 'bar-dot', style: { background: line ? 'var(--dsw-alias-state-success-primary)' : 'var(--dsw-alias-state-idle-primary)' } }), h('span', null, line ?? T('百炼智能路由:状态载入中…', 'Bailian auto router: loading…')));
            }
            // ---- plugin entry ----------------------------------------------------------
            return {
                inject: ['slots', 'remote'],
                async apply(ctx) {
                    clientCtx = ctx;
                    let unmount;
                    try {
                        if (typeof ctx.remote?.$mount === 'function') {
                            const result = await ctx.remote.$mount(contribution);
                            unmount = typeof result === 'function' ? result : () => { void result; };
                        }
                    }
                    catch (error) {
                        mountFailure = String(error?.message ?? error);
                        ctx.logger?.warn?.(`${PACKAGE}: remote contribution mount failed: ${mountFailure}`);
                    }
                    ctx.effect(() => () => { try {
                        unmount?.();
                    }
                    catch (_e) { /* already gone */ } }, `${PACKAGE}: remote contribution`);
                    ctx.slots.inject('settings.models.footer', () => ctx.slots.register({
                        name: 'settings.models.footer', id: 'bailian-auto-router-status', order: 50,
                    }, FooterCard));
                    // Register the rich panel only when the Remote namespace really
                    // mounted: its key would otherwise replace the built-in
                    // configuration form with a dead error card.
                    let mounted = false;
                    try {
                        mounted = ctx.get?.(`remote.${NS}`) !== undefined;
                    }
                    catch (_e) {
                        mounted = false;
                    }
                    if (!mounted) {
                        ctx.logger?.warn?.(`${PACKAGE}: remote.${NS} unavailable — the built-in configuration form is used instead`);
                        return;
                    }
                    ctx.slots.inject('plugins.bundle.config', () => ctx.slots.register({
                        name: 'plugins.bundle.config', key: PACKAGE, inject: () => ({ ctx }),
                    }, (props) => h(Panel, { ...props, ctx })));
                },
            };
        },
    });
}
