"use strict";
/**
 * Web client half of dsh-auto-router.
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
    const PACKAGE = 'dsh-auto-router-dshgo';
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
            // 0.7.2: 界面固定中文(用户要求)。宿主 webview 的 navigator.language 常为
            // en-US,跟随它会把整个面板变成英文,故不再探测。
            const zh = true;
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
                    { ...endpoint('pinUserModel'), parameters: [param('model', 'ModelId', anyValue)], result: codec('RouterState', asObject) },
                    { ...endpoint('checkUpdate'), parameters: [], result: codec('UpdateInfo', asObject) },
                    { ...endpoint('applyUpdate'), parameters: [param('tag', 'String', anyValue)], result: codec('UpdateResult', asObject) },
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
            /** Connection label: "显示名: providerId" — never the credential reference. */
            const connKeyOf = (c) => `${c.id}|${c.providerId}`;
            const connLabelOf = (c, names) => {
                const custom = names?.[connKeyOf(c)];
                const name = String(custom ?? c?.name ?? c?.providerId ?? c?.id ?? '').trim();
                const pid = String(c?.providerId ?? '').trim();
                if (name === '' && pid === '')
                    return String(c?.id ?? '');
                return pid !== '' && name !== pid ? `${name}: ${pid}` : (name || pid);
            };
            /** Which connection the router actually points at, even after an explicit switch. */
            const selectedConnOf = (st, cfg) => {
                if (st?.adopted)
                    return st.adopted;
                const base = String(cfg?.baseURL ?? '').replace(/\/+$/, '');
                const baseMatch = (st?.connections ?? []).filter((c) => String(c?.baseURL ?? '').replace(/\/+$/, '') === base);
                if (baseMatch.length === 0)
                    return undefined;
                // Same endpoint can host several keys: prefer the one whose credential
                // matches the live config, otherwise fall back to the first.
                const key = String(cfg?.apiKeyEnv ?? '');
                const keyed = baseMatch.find((c) => key !== '' && String(c?.apiKeyEnv ?? '') === key);
                const match = keyed ?? baseMatch[0];
                return { ...match, entryId: match.id };
            };
            // Panel and chat float are two views of one router. A tiny in-memory bus
            // makes a switch in either place land in the other immediately, instead of
            // each component keeping its own sticky selection.
            let sharedState = null;
            const stateSubs = new Set();
            const publishState = (next) => {
                if (!next)
                    return;
                sharedState = next;
                for (const fn of Array.from(stateSubs)) {
                    try {
                        fn(next);
                    }
                    catch (_e) { /* a dead view must not break routing */ }
                }
            };
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
            /** Searchable dropdown (0.7): type to filter, click to pick. Shows labels, not raw ids. */
            function Combobox(props) {
                const [open, setOpen] = useState(false);
                const [q, setQ] = useState('');
                const cur = props.options.find(o => o.value === props.value);
                const list = props.options.filter(o => `${o.label} ${o.value}`.toLowerCase().includes(q.toLowerCase()));
                return h('div', { style: { position: 'relative', minWidth: '200px', flex: '1 1 200px' } }, h('input', {
                    className: 'bar-input', placeholder: props.placeholder,
                    value: open ? q : (cur ? cur.label : props.value),
                    onFocus: () => { setOpen(true); setQ(''); },
                    onChange: (e) => { setQ(e.target.value); setOpen(true); },
                    onBlur: () => { setTimeout(() => setOpen(false), 150); },
                }), open ? h('div', { style: { position: 'absolute', zIndex: 60, left: 0, right: 0, maxHeight: '220px', overflow: 'auto', background: 'var(--dsw-alias-bg-layer-2)', border: '1px solid var(--dsw-alias-border-l2)', borderRadius: '6px', marginTop: '2px' } }, list.length === 0 ? h('div', { className: 'bar-muted', style: { padding: '6px 8px' } }, T('无匹配', 'No match'))
                    : list.slice(0, 100).map(o => h('div', {
                        key: o.value, style: { padding: '5px 8px', cursor: 'pointer' },
                        onMouseDown: () => { props.onChange(o.value); setOpen(false); setQ(''); },
                    }, o.label))) : null);
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
                const [renKey, setRenKey] = useState(null);
                const [renVal, setRenVal] = useState('');
                const [tab, setTab] = useState('account');
                const show = (name) => tab === name;
                const [upd, setUpd] = useState(null);
                const [updBusy, setUpdBusy] = useState(false);
                const [updMsg, setUpdMsg] = useState(null);
                const checkUpdate = useCallback(async () => {
                    if (!remote)
                        return;
                    setUpdBusy(true);
                    try {
                        const info = unwrap(await remote.checkUpdate());
                        setUpd(info);
                        if (info?.error)
                            setUpdMsg(String(info.error));
                    }
                    catch (_e) { /* offline: keep the previous state */ }
                    if (alive.current)
                        setUpdBusy(false);
                }, [remote]);
                useEffect(() => { void checkUpdate(); }, [checkUpdate]);
                const alive = useRef(true);
                useEffect(() => () => { alive.current = false; }, []);
                const applyUpdateNow = useCallback(async () => {
                    if (!remote || !upd?.latest)
                        return;
                    setUpdBusy(true);
                    setUpdMsg(null);
                    try {
                        const result = unwrap(await remote.applyUpdate(upd.latest));
                        setUpdMsg(String(result?.message ?? `v${upd.latest} 更新已启动`));
                    }
                    catch (error) {
                        setUpdMsg(`更新失败:${String(error?.message ?? error)}`);
                    }
                    finally {
                        if (alive.current)
                            setUpdBusy(false);
                    }
                }, [remote, upd?.latest]);
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
                        sortStrategy: next.config?.sortStrategy ?? 'auto',
                        bucketTokens: String(next.config?.bucketTokens ?? 1000000),
                        bucketTolerance: String(next.config?.bucketTolerance ?? 0.05),
                        balanceWindow: String(next.config?.balanceWindow ?? 6),
                        balanceBand: String(next.config?.balanceBand ?? 0),
                        thinkingEffort: next.config?.thinkingEffort ?? 'auto',
                        vendor: next.config?.vendor ?? 'auto',
                        enableMediaRouting: next.config?.enableMediaRouting !== false,
                    });
                    publishState(next);
                }, []);
                // Follow live router state without overwriting an unsaved draft. The
                // old implementation reapplied `sortStrategy` from the last server
                // snapshot on every chat-float refresh, so a choice made in this panel
                // could silently snap back to "auto" before the user pressed Save.
                useEffect(() => {
                    const fn = (next) => {
                        if (!alive.current || !next)
                            return;
                        setState(next);
                    };
                    stateSubs.add(fn);
                    if (sharedState !== null)
                        fn(sharedState);
                    return () => { stateSubs.delete(fn); };
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
                    return h('div', { className: 'bar-root' }, h('style', null, CSS), h('div', { className: 'bar-card' }, h('h4', null, T('智能路由 Auto Router', 'Auto router')), h('div', { className: 'bar-error' }, T('RPC 通道不可用:请确认插件已启用且 DSH 已重启,然后刷新本页。', 'RPC unavailable: make sure the plugin is enabled and DSH was restarted, then reload this page.'))));
                }
                if (!state || !draft) {
                    return h('div', { className: 'bar-root' }, h('style', null, CSS), h('div', { className: 'bar-card' }, h('span', { className: 'bar-muted' }, busy ? T('加载中…', 'Loading…') : T('等待状态…', 'Waiting for state…')), error ? h('div', { className: 'bar-error' }, error) : null));
                }
                const cfg = state.config;
                const saveConfig = () => {
                    const taskRoutes = {};
                    const priceSorted = [...(state.pool?.models ?? [])].sort((a, b) => (a.price ?? 5) - (b.price ?? 5)).map((m) => m.id);
                    for (const [task, text] of Object.entries(draft.taskRoutesText ?? {})) {
                        const list = String(text).split(/[\n,，]/).map((s) => s.trim()).filter((s) => s.length > 0);
                        // 0.6: an emptied candidate list means "price first", not "no candidates".
                        taskRoutes[task] = list.length > 0 ? list : priceSorted;
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
                        sortStrategy: draft.sortStrategy ?? cfg.sortStrategy ?? 'auto',
                        bucketTokens: Number(draft.bucketTokens ?? cfg.bucketTokens ?? 1000000),
                        bucketTolerance: Number(draft.bucketTolerance ?? cfg.bucketTolerance ?? 0.05),
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
                // No local sticky pick: resolve the selected connection from the live
                // endpoint, so panel and chat float always show the same account.
                const selectedConn = selectedConnOf(state, cfg);
                const accountSelectValue = activeAccountId !== ''
                    ? `acct:${activeAccountId}`
                    : selectedConn ? `conn:${selectedConn.entryId}|${selectedConn.providerId}` : '';
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
                /** 0.6 inline per-model cap editor: writes modelLimits immediately. */
                const setLimit = (id, key, raw) => {
                    const current = { ...(state.config?.modelLimits ?? {}) };
                    const entry = { ...(current[id] ?? {}) };
                    const num = Number(raw);
                    if (raw.trim() === '' || !Number.isFinite(num) || num < 1)
                        delete entry[key];
                    else
                        entry[key] = Math.round(num);
                    if (entry.maxCalls === undefined && entry.maxTokens === undefined)
                        delete current[id];
                    else
                        current[id] = entry;
                    void mutate(() => remote.updateConfig({ modelLimits: current }), T('额度上限已更新', 'Limit updated'));
                };
                /** 0.7.1: caps are edited in 万 (10k) tokens; storage stays raw tokens. */
                const wanOf = (v) => (typeof v === 'number' && v > 0 ? String(Math.round(v / 10_000)) : '');
                const setLimitWan = (id, raw) => {
                    const n = Number(raw);
                    setLimit(id, 'maxTokens', raw.trim() === '' || !Number.isFinite(n) || n < 1 ? '' : String(Math.round(n * 10_000)));
                };
                const connLabel = (c) => connLabelOf(c, cfg?.connectionNames);
                const saveConnName = (c) => {
                    const names = { ...(cfg?.connectionNames ?? {}) };
                    if (renVal.trim() !== '')
                        names[connKeyOf(c)] = renVal.trim();
                    else
                        delete names[connKeyOf(c)];
                    setRenKey(null);
                    void mutate(() => remote.updateConfig({ connectionNames: names }), T('连接名称已保存', 'Connection name saved'));
                };
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
                // ---- tab bar (0.6 paged UI) ----
                h('div', { className: 'bar-row', style: { gap: '6px' } }, ...[['account', T('账号与更新', 'Accounts')], ['route', T('路由与策略', 'Routing')], ['pool', T('模型池与限额', 'Pool & limits')], ['log', T('自检与日志', 'Check & logs')]].map(([key, label]) => h('div', {
                    key, className: tab === key ? 'bar-btn bar-btn-primary' : 'bar-btn', role: 'button',
                    onClick: () => setTab(key),
                }, label))), 
                // ---- self update (0.6.1) ----
                show('account') && h('div', { className: 'bar-card' }, h('div', { className: 'bar-row' }, h('h4', null, T('插件更新', 'Plugin update')), upd?.hasUpdate ? h(Badge, { tone: 'warn', text: T('有可用更新', 'Update available') }) : h(Badge, { tone: 'ok', text: T('已是最新', 'Up to date') }), h('span', { className: 'bar-muted bar-mono' }, `${T('当前', 'Current')} ${upd?.current ?? '…'} → ${T('最新', 'Latest')} ${upd?.latest ?? '…'}`)), h('div', { className: 'bar-row' }, h('div', { className: 'bar-btn', role: 'button', onClick: () => void checkUpdate() }, updBusy ? T('检查中…', 'Checking…') : T('检查更新', 'Check for updates')), upd?.hasUpdate ? h('div', {
                    className: 'bar-btn bar-btn-primary', role: 'button', style: updBusy ? { opacity: .6 } : undefined,
                    onClick: () => void applyUpdateNow(),
                }, T('更新到 v', 'Update to v') + upd.latest) : null, h('span', { className: 'bar-muted', style: { fontSize: '11px' } }, T('原地更新:自动停宿主→替换 lib→重启,保留 node_modules、账号和配置,不需要重装。', 'In-place update: stops host, swaps lib, restarts; keeps node_modules, accounts and config; no reinstall.'))), updMsg ? h('div', { className: updMsg.startsWith('更新失败') ? 'bar-error' : 'bar-ok', style: { fontSize: '11px', marginTop: '6px', whiteSpace: 'pre-wrap' } }, updMsg) : null), 
                // ---- overview ----
                show('account') && h('div', { className: 'bar-card' }, h('div', { className: 'bar-row' }, h('h4', null, T('智能路由 Auto Router · 状态', 'Auto router · status')), h(Badge, { tone: cfg.apiKeyConfigured ? 'ok' : 'err', text: cfg.apiKeyConfigured ? T('API Key 已配置', 'API key set') : T('API Key 未配置', 'API key missing') }), h(Badge, { tone: cfg.enableDecision ? 'ok' : 'warn', text: cfg.enableDecision ? T('决策模型开启', 'decision on') : T('决策模型关闭(启发式)', 'decision off (heuristic)') }), h('span', { className: 'bar-muted bar-mono' }, state.modelName ?? T('智能路由 Auto Router', 'Auto Router'))), h('div', { className: 'bar-row' }, h('label', { className: 'bar-muted' }, T('当前 API 账号', 'Active API account')), h(Combobox, {
                    value: accountSelectValue,
                    onChange: onAccountSelect,
                    placeholder: T('搜索账号 / 厂商…', 'Search account / vendor…'),
                    options: [
                        { value: '', label: T('默认接口 / 自动沿用', 'Default endpoint / auto-adopt') },
                        ...accounts.map((a) => ({ value: `acct:${a.id}`, label: a.name })),
                        ...(state.connections ?? []).map((c) => ({ value: `conn:${c.id}|${c.providerId}`, label: connLabel(c) })),
                    ],
                }), h('span', { className: 'bar-muted', style: { fontSize: '11px' } }, T('切换后自动重新同步模型池;台账按 key 记忆,不跨 key 混算', 'Switching resyncs the pool; the ledger is per-key and never mixed across keys'))), h('div', { className: 'bar-row bar-muted', style: { fontSize: '11px' } }, h('span', null, T('本地台账: ', 'Local ledger: '), h('span', { className: 'bar-mono' }, `${state.keyLedger?.totalTokens ?? 0} tok · 周期 ${state.keyLedger?.cycle ?? 0}`))), h('div', { className: 'bar-row bar-muted' }, h('span', null, T('接口: ', 'Endpoint: '), h('span', { className: 'bar-mono' }, cfg.baseURL)), h('span', null, T('凭据引用: ', 'Credential ref: '), h('span', { className: 'bar-mono' }, cfg.apiKeyEnv)), h('span', null, T('最近同步: ', 'Last sync: '), fmtTime(state.pool?.lastSyncAt ?? null))), h('div', { className: 'bar-row' }, h(Badge, { tone: 'ok', text: T(`账号可用 ${state.pool?.total ?? 0} 个 → 可对话 ${state.pool?.count ?? 0} 个`, `${state.pool?.total ?? 0} reachable → ${state.pool?.count ?? 0} chat models`) }), h(Badge, { tone: 'ok', text: T(`视觉模型 ${state.pool?.visionCount ?? 0} 个`, `${state.pool?.visionCount ?? 0} vision`) }), h(Badge, { tone: 'none', text: T(`已排除非对话模型 ${(state.pool?.excluded ?? []).length} 个`, `${(state.pool?.excluded ?? []).length} non-chat excluded`) })), state.derived && (state.derived.decisionModel || state.derived.fallbackModel)
                    ? h('div', { className: 'bar-muted' }, T(`当前账号不提供配置的模型,已自动替代: 决策=${cfg.decisionModel}(原 ${cfg.decisionModelConfigured}),回退=${cfg.fallbackModel}(原 ${cfg.fallbackModelConfigured})。换账号后无需改动配置。`, `This account does not serve the configured models; substituted decision=${cfg.decisionModel} (was ${cfg.decisionModelConfigured}), fallback=${cfg.fallbackModel} (was ${cfg.fallbackModelConfigured}).`))
                    : null, state.adopted
                    ? h('div', { className: 'bar-muted' }, T(`已自动沿用 profile 中 ${state.adopted.name ?? state.adopted.providerId}(${state.adopted.providerId})的接口与凭据(无需重复配置)。`, `Reusing ${state.adopted.name ?? state.adopted.providerId} (${state.adopted.providerId}) from this profile.`))
                    : (state.candidates ?? []).length > 0
                        ? h('div', { className: 'bar-muted' }, T(`检测到 ${state.candidates.length} 个 OpenAI 兼容连接(任意厂商);在上方账号下拉选择即可切换。`, `${state.candidates.length} OpenAI-compatible connection(s) found (any vendor); pick one in the account dropdown above.`))
                        : null, state.pool?.lastSyncError ? h('div', { className: 'bar-error' }, T('同步失败: ', 'Sync failed: '), state.pool.lastSyncError) : null, notice ? h('div', { className: 'bar-ok' }, notice) : null, error ? h('div', { className: 'bar-error' }, error) : null), 
                // ---- API account management ----
                show('account') && h('div', { className: 'bar-card' }, h('h4', null, T('API 账号管理(添加 / 切换多厂商账号)', 'API accounts (add / switch multi-vendor accounts)')), h('div', { className: 'bar-muted', style: { fontSize: '11px' } }, T('Key 以 secret 形式存于本机配置,面板打码显示,绝不写入 state.json 或日志;也可只填凭据引用(环境变量名)。', 'Keys are stored as secrets in local config, masked here, never in state.json or logs; a credential ref (env name) also works.')), accounts.length === 0
                    ? h('div', { className: 'bar-muted' }, T('还没有保存的账号。在下方添加,或继续使用默认接口/自动沿用。', 'No saved accounts yet. Add one below, or keep the default endpoint / auto-adopt.'))
                    : h('div', { style: { display: 'flex', flexDirection: 'column', gap: '8px' } }, ...accounts.map((a) => h('div', { key: a.id, className: 'bar-history-item' }, h('div', { className: 'bar-row' }, h('strong', null, a.name), a.active ? h(Badge, { tone: 'ok', text: T('使用中', 'active') }) : null, h('span', { className: 'bar-muted bar-mono', style: { fontSize: '11px', wordBreak: 'break-all' } }, a.baseURL)), h('div', { className: 'bar-row bar-muted', style: { fontSize: '11px' } }, h('span', null, a.hasKey
                        ? T('Key: ', 'Key: ') + (a.keyHint ?? '••••')
                        : T('凭据引用: ', 'Credential ref: ') + (a.apiKeyEnv ?? '—')), h('div', { className: 'bar-btn', role: 'button', onClick: () => setAcctForm({ id: a.id, name: a.name, baseURL: a.baseURL, apiKey: '', apiKeyEnv: a.apiKeyEnv ?? '' }) }, T('编辑', 'Edit')), a.active ? null : h('div', { className: 'bar-btn', role: 'button', onClick: () => void mutate(() => remote.activateAccount(a.id), T('已切换账号并重新同步模型池', 'Account switched and pool resynced')) }, T('启用', 'Use')), h('div', { className: 'bar-btn', role: 'button', onClick: () => void mutate(() => remote.removeAccount(a.id), T('账号已删除', 'Account removed')) }, T('删除', 'Delete')))))), h('div', { className: 'bar-row' }, field(T('账号名称', 'Account name'), acctForm.name, (v) => setAcctForm({ ...acctForm, name: v })), field(T('接口地址 baseURL', 'Endpoint baseURL'), acctForm.baseURL, (v) => setAcctForm({ ...acctForm, baseURL: v }))), h('div', { className: 'bar-row' }, h('div', { className: 'bar-field' }, h('label', null, T('API Key(编辑时留空=保留原 Key)', 'API key (blank when editing = keep stored key)')), h('input', {
                    className: 'bar-input bar-mono', type: 'password', value: acctForm.apiKey, placeholder: 'sk-…',
                    onChange: (e) => setAcctForm({ ...acctForm, apiKey: e.target.value }),
                })), field(T('或凭据引用(环境变量名,可选)', 'Or credential ref (env name, optional)'), acctForm.apiKeyEnv, (v) => setAcctForm({ ...acctForm, apiKeyEnv: v }))), h('div', { className: 'bar-row' }, h('div', { className: 'bar-btn bar-btn-primary', role: 'button', onClick: saveAccount }, acctForm.id ? T('保存修改', 'Save changes') : T('添加账号', 'Add account')), acctForm.id ? h('div', { className: 'bar-btn', role: 'button', onClick: resetAcctForm }, T('取消编辑', 'Cancel edit')) : null)), 
                // ---- discovered connections: rename / switch (0.7.1) ----
                show('account') && (state.connections ?? []).length > 0 && h('div', { className: 'bar-card' }, h('h4', null, T('检测到的连接(可改中文名 / 切换)', 'Discovered connections (rename / switch)')), h('div', { className: 'bar-muted', style: { fontSize: '11px' } }, T('「改名」设置你自己的显示名,下拉与列表统一显示「显示名: provider id」;冒号后是程序内部标识,凭据引用不再显示。同一接口多个 key 用名称区分。', 'Rename to your own label; dropdown and list show "display name: provider id". The id is internal; credential refs are hidden. Distinguish multiple keys on one endpoint by name.')), h('div', { style: { display: 'flex', flexDirection: 'column', gap: '8px' } }, ...(state.connections ?? []).map((c) => h('div', { key: connKeyOf(c), className: 'bar-history-item' }, h('div', { className: 'bar-row' }, h('strong', null, connLabel(c)), selectedConn && String(selectedConn.baseURL ?? '').replace(/\/+$/, '') === String(c.baseURL ?? '').replace(/\/+$/, '') ? h(Badge, { tone: 'ok', text: T('使用中', 'active') }) : null, h('span', { className: 'bar-muted bar-mono', style: { fontSize: '11px', wordBreak: 'break-all' } }, c.baseURL)), h('div', { className: 'bar-row' }, renKey === connKeyOf(c) ? h('input', {
                    className: 'bar-input', style: { width: '180px' }, value: renVal, placeholder: T('显示名,如:主力key…', 'Display name…'),
                    onChange: (e) => setRenVal(e.target.value),
                }) : null, renKey === connKeyOf(c)
                    ? h('div', { className: 'bar-btn bar-btn-primary', role: 'button', onClick: () => saveConnName(c) }, T('保存', 'Save'))
                    : h('div', {
                        className: 'bar-btn', role: 'button',
                        onClick: () => { setRenKey(connKeyOf(c)); setRenVal((cfg?.connectionNames ?? {})[connKeyOf(c)] ?? ''); },
                    }, T('改名', 'Rename')), h('div', {
                    className: 'bar-btn', role: 'button',
                    onClick: () => { void mutate(() => remote.switchConnection(c.id, c.providerId), T('已切换连接并重新同步模型池', 'Connection switched and pool resynced')); },
                }, T('使用', 'Use'))))))), 
                // ---- routing configuration ----
                show('route') && h('div', { className: 'bar-card' }, h('h4', null, T('路由与容灾配置', 'Routing & failover')), h('div', { className: 'bar-row' }, h('label', { className: 'bar-check' }, h('input', { type: 'checkbox', checked: draft.enableDecision !== false, onChange: (e) => setDraft({ ...draft, enableDecision: e.target.checked }) }), T('启用决策模型(关闭后仅按启发式规则路由)', 'Enable decision model (heuristics only when off)'))), h('div', { className: 'bar-row' }, h('div', { className: 'bar-field' }, h('label', null, T('决策模型', 'Decision model')), h(Combobox, { value: draft.decisionModel, onChange: (v) => setDraft({ ...draft, decisionModel: v }), placeholder: T('搜索模型…', 'Search model…'), options: (state.pool?.models ?? []).map((m) => ({ value: m.id, label: m.id })) })), h('div', { className: 'bar-field' }, h('label', null, T('回退模型(决策失败时)', 'Fallback model')), h(Combobox, { value: draft.fallbackModel, onChange: (v) => setDraft({ ...draft, fallbackModel: v }), placeholder: T('搜索模型…', 'Search model…'), options: (state.pool?.models ?? []).map((m) => ({ value: m.id, label: m.id })) })), field(T('决策超时 ms', 'Decision timeout (ms)'), draft.decisionTimeoutMs, (v) => setDraft({ ...draft, decisionTimeoutMs: v })), field(T('单请求最多尝试模型数', 'Max attempts per request'), draft.maxAttempts, (v) => setDraft({ ...draft, maxAttempts: v }))), h('div', { className: 'bar-row' }, h('div', { className: 'bar-field' }, h('label', null, T('候选排序策略', 'Candidate ordering strategy')), h('select', { className: 'bar-input', value: draft.sortStrategy ?? 'auto', onChange: (e) => setDraft({ ...draft, sortStrategy: e.target.value }) }, h('option', { value: 'auto' }, T('智能(任务匹配+均衡,默认)', 'Smart (task match + balance, default)')), h('option', { value: 'price' }, T('价格优先(便宜先用)', 'Price first (cheapest first)')), h('option', { value: 'capability' }, T('能力优先(旗舰先用)', 'Capability first')), h('option', { value: 'speed' }, T('速度优先(快先用)', 'Speed first')), h('option', { value: 'free_quota' }, T('薅免费额度(按桶轮转)', 'Free-quota rotation')))), field(T('免费额度桶大小(tok)', 'Free-quota bucket (tok)'), draft.bucketTokens, (v) => setDraft({ ...draft, bucketTokens: v })), field(T('额度完成容差(0–0.5)', 'Quota tolerance (0–0.5)'), draft.bucketTolerance, (v) => setDraft({ ...draft, bucketTolerance: v }))), h('div', { className: 'bar-row' }, field(T('额度耗尽冷却(分钟)', 'Quota cooldown (minutes)'), draft.quotaCooldownMinutes, (v) => setDraft({ ...draft, quotaCooldownMinutes: v })), field(T('限流/网络冷却(秒)', 'Rate-limit cooldown (seconds)'), draft.rateLimitCooldownSeconds, (v) => setDraft({ ...draft, rateLimitCooldownSeconds: v }))), h('div', { className: 'bar-row' }, h('div', { className: 'bar-btn bar-btn-primary', role: 'button', onClick: saveConfig }, T('保存配置', 'Save')), h('div', { className: 'bar-btn', role: 'button', onClick: () => void load() }, T('重新载入', 'Reload')), h('span', { className: 'bar-muted' }, T('保存写入 profile 的 cordis.patch.yml;volatile 字段即时生效', 'Saves into the profile cordis.patch.yml; volatile fields apply live')))), 
                // ---- 0.7 cost & free-quota notices ----
                show('route') && h('div', { className: 'bar-card' }, h('h4', null, T('费用与免费额度提示', 'Cost & free-quota notes')), h('div', { className: 'bar-muted' }, T('① 选智能路由会加快余额消耗:复杂问题会被派给更强(也更贵)的模型,单题成本可能高于固定用一个便宜模型,但处理效果更优。想省钱可选「价格优先」。', '① Auto routing spends balance faster: hard questions go to stronger (pricier) models, costing more per query than a fixed cheap model, but with better results. Pick "Price first" to save.')), h('div', { className: 'bar-muted' }, T('② 薅免费额度优先=每个模型先用满一桶免费额度再换下一个,把各家送的额度都薅一遍(比任何单一排序薅得多)。台账按 key 记忆:切换排序不重置,只有换 key 才重置;换 key 又换回可能使该 key 超出免费额度,建议配合厂商「用完即停」。', '② Free-quota first drains one bucket per model before moving on, milking every vendor\'s free grant. The ledger is per-key: switching strategy never resets it, only a key change does; switching away and back may push a key past its free quota — pair with the vendor\'s "stop when exhausted".'))), 
                // ---- task routes ----
                show('route') && h('div', { className: 'bar-card' }, h('h4', null, T('各任务类型候选模型(逗号/换行分隔,按优先级排序)', 'Task candidate lists (comma/newline separated, priority order)')), h('div', { className: 'bar-muted', style: { fontSize: '11px' } }, T('清空某任务候选=按价格优先自动填充;排序策略在「路由与策略」页选择。', 'Emptying a task list = auto-fill price-first; pick ordering strategy on the Routing tab.')), h('div', { className: 'bar-row' }, ...['image', 'writing', 'translation', 'code', 'reasoning', 'general'].map(task => h('div', { className: 'bar-field', key: task }, h('label', null, TASK_LABELS[task]), h('textarea', {
                    className: 'bar-textarea',
                    value: draft.taskRoutesText?.[task] ?? '',
                    onChange: (e) => setDraft({ ...draft, taskRoutesText: { ...draft.taskRoutesText, [task]: e.target.value } }),
                }), h(Combobox, {
                    value: '', placeholder: T('+ 选模型加入(按顺序)', '+ pick model to append'),
                    options: (state.pool?.models ?? []).map((m) => ({ value: m.id, label: m.id })),
                    onChange: (v) => setDraft({ ...draft, taskRoutesText: { ...draft.taskRoutesText, [task]: ((draft.taskRoutesText?.[task] ?? '').trim() ? draft.taskRoutesText[task].trim() + ', ' : '') + v } }),
                })))), h('div', { className: 'bar-field' }, h('label', null, T('自定义模型池(JSON 数组,覆盖内置目录;字段: id,name,vision,contextWindow,maxTokens,tags)', 'Custom pool (JSON array; fields: id,name,vision,contextWindow,maxTokens,tags)')), h('textarea', {
                    className: 'bar-textarea', style: { minHeight: '96px' }, value: draft.modelsText ?? '[]',
                    onChange: (e) => setDraft({ ...draft, modelsText: e.target.value }),
                }))), show('pool') && (() => {
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
                        return h('tr', { key: id }, h('td', { className: 'bar-mono', style: { wordBreak: 'break-all' } }, id, meta?.name && meta.name !== id ? h('span', { className: 'bar-muted' }, ` (${meta.name})`) : null), h('td', null, meta?.source ?? '—'), h('td', { title: meta ? (meta.vision ? T('明确支持图片输入', 'Declared image input') : (meta.visionKnown ? T('明确不支持图片输入', 'Declared no image input') : T('未核实，仅按模型 id 推断', 'Unverified, inferred from model id'))) : T('目录中无此模型', 'Not in catalog') }, meta ? (meta.vision ? '✓' : (meta.visionKnown ? '✗' : '—')) : '—'), h('td', null, available
                            ? h(Badge, { tone: 'ok', text: T('可用', 'available') })
                            : h(Badge, { tone: 'warn', text: `${T('冷却中', 'cooldown')} ${fmtDuration(q?.cooldownRemainingMs ?? 0)}` })), h('td', null, String(q?.fails ?? 0)), h('td', null, String(q?.calls ?? 0)), h('td', { className: 'bar-muted' }, q?.lastFailCode ?? '—'), h('td', null, h('div', { className: 'bar-row', style: { gap: '4px' } }, h('input', {
                            className: 'bar-input', key: `${id}-${state.config?.modelLimits?.[id]?.maxTokens ?? 0}`,
                            style: { width: '64px' }, type: 'number', min: 1, placeholder: '100',
                            title: T('单位:万 token;100 = 100 万;清空 = 不限', 'Unit: 10k tokens; 100 = 1M; blank = unlimited'),
                            defaultValue: wanOf(state.config?.modelLimits?.[id]?.maxTokens),
                            onBlur: (e) => setLimitWan(id, e.target.value),
                        }), h('span', { className: 'bar-muted', style: { fontSize: '11px' } }, T('万', '×10k')), h('div', { className: 'bar-btn', role: 'button', title: T('设 1M(100万) token 上限', 'Set 1M token cap'), onClick: () => setLimit(id, 'maxTokens', '1000000') }, '1M'))), h('td', null, available ? null : h('div', {
                            className: 'bar-btn', role: 'button',
                            onClick: () => void mutate(() => remote.resetQuota(id), T('已解除冷却: ', 'Cooldown cleared: ') + id),
                        }, T('解除', 'Clear'))));
                    };
                    return h('div', { className: 'bar-card' }, h('div', { className: 'bar-row' }, h('h4', null, T('模型池(按分类展开)', 'Model pool (collapsible by category)')), h('div', {
                        className: 'bar-btn', role: 'button',
                        onClick: () => void mutate(() => remote.refreshPool(), T('已拉取模型列表', 'Model list refreshed')),
                    }, T('刷新模型列表', 'Refresh pool')), h('div', {
                        className: 'bar-btn', role: 'button',
                        onClick: () => void mutate(() => remote.resetQuota(), T('已解除全部冷却', 'All cooldowns cleared')),
                    }, T('全部解除冷却', 'Clear all cooldowns'))), GROUPS.map((g) => {
                        if (g.ids.length === 0)
                            return null;
                        return h('details', { key: g.key, style: { borderTop: '1px solid var(--dsw-alias-border-l1)', padding: '6px 0' } }, h('summary', { className: 'bar-muted', style: { cursor: 'pointer', userSelect: 'none' } }, `${g.label} · ${g.ids.length} 个`), h('div', { style: { maxHeight: '240px', overflow: 'auto', marginTop: '4px' } }, h('table', { className: 'bar-table' }, h('thead', null, h('tr', null, h('th', null, T('模型', 'Model')), h('th', null, T('来源', 'Source')), h('th', { title: T('✓ 声明支持 / ✗ 声明不支持 / — 未核实(按 id 推断)', '✓ declared / ✗ declared none / — unverified (id inference)') }, T('视觉', 'Vision')), h('th', null, T('冷却', 'Cooldown')), h('th', null, T('连败', 'Fails')), h('th', null, T('调用', 'Calls')), h('th', null, T('错误', 'Error')), h('th', null, T('限额(万tok)', 'Cap (×10k tok)')), h('th', null, ''))), h('tbody', null, g.ids.slice(0, 300).map((id) => modelRow(id))))));
                    }));
                })(), 
                // ---- per-model usage limits ----
                show('pool') && h('div', { className: 'bar-card' }, h('div', { className: 'bar-row' }, h('h4', null, T('每模型额度上限', 'Per-model usage limits')), h('div', {
                    className: 'bar-btn', role: 'button',
                    onClick: () => void mutate(() => remote.resetModelTotals(), T('已重置全部用量', 'All usage reset')),
                }, T('重置全部用量', 'Reset all usage'))), h('div', { className: 'bar-muted' }, T('限额单位为「万 token」:填 100 = 100 万,点「1M」一键设 100 万;达到上限自动路由下一个,清空=不限。旧版误填的小数值(如 100)已自动按「万」迁移,不会再秒触发冷却。', 'Caps are in 10k tokens: 100 = 1M; "1M" sets a 1M cap. Reaching it routes to the next model; blank = unlimited. Legacy tiny raw values (e.g. 100) are auto-migrated as 10k units.')), h('div', { style: { maxHeight: '200px', overflow: 'auto', marginTop: '4px' } }, h('table', { className: 'bar-table' }, h('thead', null, h('tr', null, h('th', null, T('模型', 'Model')), h('th', null, T('调用', 'Calls')), h('th', null, T('token', 'Tokens')), h('th', null, T('上限', 'Limit')), h('th', null, T('行内设置(次 / 万tok)', 'Inline cap (calls / ×10k tok)')), h('th', null, T('本key桶/累计', 'Key bucket / total')), h('th', null, T('状态', 'Status')), h('th', null, ''))), h('tbody', null, (state.pool?.models ?? []).map((m) => {
                    const usage = state.modelUsage?.[m.id] ?? { calls: 0, tokens: 0 };
                    const limit = state.config?.modelLimits?.[m.id];
                    const overCalls = typeof limit?.maxCalls === 'number' && usage.calls >= limit.maxCalls;
                    const overTokens = typeof limit?.maxTokens === 'number' && usage.tokens >= limit.maxTokens;
                    const over = overCalls || overTokens;
                    const limitText = limit === undefined ? '—'
                        : [typeof limit.maxCalls === 'number' ? `${limit.maxCalls} 次` : '', typeof limit.maxTokens === 'number' ? `${Math.round(limit.maxTokens / 10_000)} 万tok` : ''].filter(Boolean).join(' / ');
                    return h('tr', { key: m.id }, h('td', { className: 'bar-mono', style: { wordBreak: 'break-all' } }, m.id), h('td', null, String(usage.calls)), h('td', null, String(usage.tokens)), h('td', { className: 'bar-muted' }, limitText), h('td', null, h('div', { className: 'bar-row', style: { gap: '4px' } }, h('input', { className: 'bar-input', key: `${m.id}-c-${limit?.maxCalls ?? 0}`, style: { width: '70px' }, type: 'number', min: 1, placeholder: '次', defaultValue: limit?.maxCalls ?? '', onBlur: (e) => setLimit(m.id, 'maxCalls', e.target.value) }), h('input', {
                        className: 'bar-input', key: `${m.id}-t-${limit?.maxTokens ?? 0}`, style: { width: '70px' }, type: 'number', min: 1, placeholder: '100',
                        title: T('单位:万 token;清空 = 不限', 'Unit: 10k tokens; blank = unlimited'),
                        defaultValue: wanOf(limit?.maxTokens), onBlur: (e) => setLimitWan(m.id, e.target.value),
                    }), h('span', { className: 'bar-muted', style: { fontSize: '11px' } }, T('万', '×10k')))), h('td', { className: 'bar-muted bar-mono' }, `${m.bucketTokens ?? 0} / ${m.ledgerTokens ?? 0}`), h('td', null, limit === undefined
                        ? h(Badge, { tone: 'none', text: T('未设限', 'unlimited') })
                        : over
                            ? h(Badge, { tone: 'err', text: T('超限', 'exhausted') })
                            : h(Badge, { tone: 'ok', text: T('额度内', 'within') })), h('td', null, (usage.calls > 0 || usage.tokens > 0) ? h('div', {
                        className: 'bar-btn', role: 'button',
                        onClick: () => void mutate(() => remote.resetModelTotals(m.id), T('已重置用量: ', 'Usage reset: ') + m.id),
                    }, T('重置', 'Reset')) : null));
                }))))), 
                // ---- integrity self-check ----
                show('log') && h('div', { className: 'bar-card' }, h('div', { className: 'bar-row' }, h('h4', null, T('一键检测完整性', 'One-click integrity check')), h('div', { className: 'bar-btn bar-btn-primary', role: 'button', onClick: () => void runSelfCheck() }, busy ? T('检测中…', 'Checking…') : T('开始检测', 'Run check'))), selfCheck === null ? null : h('div', { style: { display: 'flex', flexDirection: 'column', gap: '4px' } }, h('div', { className: selfCheck.ok ? 'bar-ok' : 'bar-error' }, selfCheck.ok
                    ? T('✓ 全部通过,插件可在本机正常使用', 'All checks passed — the plugin works on this machine')
                    : T('✗ 存在未通过项,按下面的提示修复后重试', 'Some checks failed — follow the hints below and retry')), (selfCheck.items ?? []).map((item, index) => h('div', { key: `${item.name}-${index}`, className: 'bar-row', style: { alignItems: 'flex-start' } }, h('span', { style: { color: item.ok ? 'var(--dsw-alias-state-success-primary)' : 'var(--dsw-alias-state-error-primary)', width: '18px', flex: 'none' } }, item.ok ? '✓' : '✗'), h('span', { style: { minWidth: '130px', flex: 'none' } }, item.name), h('span', { className: 'bar-muted', style: { flex: '1 1 auto' } }, item.detail), item.hint ? h('span', { className: 'bar-muted', style: { display: 'block', width: '100%' } }, T('→ ', '→ ') + item.hint) : null)))), 
                // (0.7) removed redundant "Aliyun connection" card — account switching
                // lives in the single searchable account dropdown on the Accounts tab.
                // ---- balancing & thinking ----
                show('route') && h('div', { className: 'bar-card' }, h('h4', null, T('负载均衡与思考档位', 'Load balancing & thinking effort')), h('div', { className: 'bar-row' }, h('div', { className: 'bar-field' }, h('label', null, T('均衡策略', 'Balancing strategy')), h('select', {
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
                }, h('option', { value: 'auto' }, T('自动(按任务复杂度)', 'Auto (by task complexity)')), h('option', { value: 'off' }, T('关闭', 'Off')), h('option', { value: 'low' }, 'low'), h('option', { value: 'medium' }, 'medium'), h('option', { value: 'high' }, 'high'), h('option', { value: 'max' }, 'max')))), h('div', { className: 'bar-muted' }, T('均衡: 同一任务在排名前 N 的同类模型之间按近期 token 消耗轮转,避免每次都用同一个旗舰。决策模型只从「当前可用、未冷却、未超限、未连续失败」且落在本轮价格带内的候选里选:简单 3 / 普通 4 / 复杂 8 / 深度 12(¥/百万 token)。思考档位: auto 会按输入长度、代码密度、推理词汇、已执行工具步数估算复杂度并下发对应档位(trivial→off, simple→low, normal→medium, complex→high, deep→max)。', 'Balancing rotates among the top-N task candidates by recent token usage. The decision model only sees callable, non-cooling, within-limit candidates inside the request price band (3/4/8/12 ¥ per 1M tokens). Auto effort follows the estimated complexity.')), h('div', { className: 'bar-row' }, h('label', { className: 'bar-check' }, h('input', {
                    type: 'checkbox',
                    checked: draft.enableMediaRouting !== false,
                    onChange: (e) => setDraft({ ...draft, enableMediaRouting: e.target.checked }),
                }), T('启用媒体路由(图像生成走 /images/generations)', 'Enable media routing (image generation)')), h('span', { className: 'bar-muted' }, T(`可路由媒体: 图像 ${(state.pool?.media?.image ?? []).length} 个 · 语音 ${(state.pool?.media?.speech ?? []).length} 个 · 识别 ${(state.pool?.media?.asr ?? []).length} 个`, `Media: image ${(state.pool?.media?.image ?? []).length}, speech ${(state.pool?.media?.speech ?? []).length}, asr ${(state.pool?.media?.asr ?? []).length}`)))), 
                // ---- pool composition ----
                show('pool') && h('div', { className: 'bar-card' }, h('div', { className: 'bar-row' }, h('h4', null, T('模型池构成(来自本账号 /models 列表)', 'Pool composition (this account\'s /models)')), h('div', {
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
                show('log') && h('div', { className: 'bar-card' }, h('div', { className: 'bar-row' }, h('h4', null, T('最近路由决策(最多 50 条)', 'Recent routing decisions (last 50)')), h('div', {
                    className: 'bar-btn', role: 'button',
                    onClick: () => void mutate(() => remote.clearHistory(), T('历史已清空', 'History cleared')),
                }, T('清空', 'Clear'))), (state.history ?? []).length === 0
                    ? h('div', { className: 'bar-muted' }, T('暂无记录;在会话中把模型切到「智能路由 Auto Router」发起对话后回到这里查看。', 'No records yet; pick the "智能路由 Auto Router" model in a session and come back.'))
                    : h('div', { style: { display: 'flex', flexDirection: 'column', gap: '8px', maxHeight: '360px', overflow: 'auto' } }, (state.history ?? []).map((r, i) => h('div', { className: 'bar-history-item', key: `${r.at}-${i}` }, h('div', { className: 'bar-row' }, h(Badge, { tone: r.ok ? 'ok' : 'err', text: r.ok ? T('成功', 'ok') : T('失败', 'failed') }), h('span', { className: 'bar-mono' }, r.finalModel ?? '—'), h('span', { className: 'bar-muted' }, `${fmtTime(r.at)} · ${r.task} · ${r.modality} · ${decisionSourceLabel(r.decisionSource)}`
                        + (r.decisionTokens ? ` · 决策 ${r.decisionTokens} tok` : '')
                        + ` · 输入 ${(r.inputTokens ?? 0) + (r.cacheReadTokens ?? 0)} / 缓存 ${(r.cacheReadTokens ?? 0)} tok`
                        + (r.tokens ? ` · 回答 ${r.tokens} tok` : '')
                        + ` · ${r.origin === 'user' ? T('用户指定', 'user-pinned') : T('自动', 'auto')} · ${r.strategy ?? 'auto'}`)), r.reasoning ? h('div', { className: 'bar-muted' }, r.reasoning) : null, (r.attempts ?? []).length > 1
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
                const [st, setSt] = useState(null);
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
                                    setLine(T(`智能路由 Auto Router:远程通道未挂载 · 改用内置配置表单${detail}`, `Auto router: remote channel not mounted · using the built-in form${detail}`));
                                }
                                return;
                            }
                            const state = unwrap(await remote.getState());
                            if (disposed || !state)
                                return;
                            setSt(state);
                            const cooling = (state.quota ?? []).filter((q) => !q.available).length;
                            setLine(`${state.modelName} · ${T('模型池', 'pool')} ${state.pool?.count ?? 0} · ${T('冷却中', 'cooling')} ${cooling}`);
                        }
                        catch (_e) { /* stay silent in the footer */ }
                    };
                    void run();
                    const timer = setInterval(() => { void run(); }, 30_000);
                    return () => { disposed = true; clearInterval(timer); };
                }, []);
                const last = (st?.history ?? [])[0];
                const setStrategy = (v) => {
                    const remote = clientCtx?.get?.(`remote.${NS}`);
                    if (!remote)
                        return;
                    void remote.updateConfig({ sortStrategy: v }).then(() => { });
                };
                return h('div', { className: 'bar-footer-card', style: { flexWrap: 'wrap' } }, h('style', null, CSS), h('span', { className: 'bar-dot', style: { background: line ? 'var(--dsw-alias-state-success-primary)' : 'var(--dsw-alias-state-idle-primary)' } }), h('span', null, line ?? T('智能路由 Auto Router:状态载入中…', 'Auto router: loading…')), last ? h('span', { className: 'bar-muted bar-mono' }, `${T('上次', 'last')} ${last.finalModel ?? '—'} · ${last.tokens ?? 0} tok · ${last.origin === 'user' ? T('用户指定', 'user') : T('自动', 'auto')}`) : null, h('select', {
                    className: 'bar-input', style: { maxWidth: '150px' }, value: st?.config?.sortStrategy ?? 'auto',
                    onChange: (e) => setStrategy(e.target.value),
                }, h('option', { value: 'auto' }, T('智能', 'Smart')), h('option', { value: 'price' }, T('价格优先', 'Price')), h('option', { value: 'capability' }, T('能力优先', 'Capability')), h('option', { value: 'speed' }, T('速度优先', 'Speed')), h('option', { value: 'free_quota' }, T('薅免费额度', 'Free quota'))));
            }
            // ---- 0.9.0 右下角浮窗(全应用、与面板同一事实源、决策可视化) --------------
            const TASK_LABELS_F = {
                image: '图片分析', writing: '写作', translation: '翻译', code: '代码', reasoning: '推理', general: '通用',
            };
            const STRATEGY_LABELS_F = {
                auto: '智能排序', price: '价格优先', capability: '能力优先', speed: '速度优先', free_quota: '薅免费额度',
            };
            function FloatCard() {
                const [st, setSt] = useState(null);
                const viewportWidth = Number(globalThis.innerWidth ?? 1200);
                const [open, setOpen] = useState(viewportWidth >= 720);
                const [busy, setBusy] = useState(null);
                const [msg, setMsg] = useState(null);
                const alive = useRef(true);
                useEffect(() => () => { alive.current = false; }, []);
                const remote = useCallback(() => {
                    try {
                        return clientCtx?.get?.(`remote.${NS}`);
                    }
                    catch (_e) {
                        return undefined;
                    }
                }, []);
                const pull = useCallback(async (silent = true) => {
                    const r = remote();
                    if (!r)
                        return;
                    try {
                        const next = unwrap(await r.getState());
                        if (alive.current && next) {
                            setSt(next);
                            publishState(next);
                        }
                    }
                    catch (error) {
                        if (!silent && alive.current)
                            setMsg({ tone: 'err', text: `状态读取失败:${String(error?.message ?? error)}` });
                    }
                }, [remote]);
                useEffect(() => {
                    void pull();
                    const timer = setInterval(() => { void pull(); }, 8_000);
                    let off;
                    try {
                        off = clientCtx?.remote?.$on?.('settings/document-updated', () => { void pull(); });
                    }
                    catch (_e) { /* 宿主不支持该事件 */ }
                    return () => { alive.current = false; clearInterval(timer); try {
                        off?.();
                    }
                    catch (_e) { /* ignore */ } };
                }, [pull]);
                /** One RPC: adopt its returned state at once and always surface the outcome. */
                const run = useCallback(async (label, fn, okText) => {
                    const r = remote();
                    if (!r || busy !== null)
                        return;
                    setBusy(label);
                    setMsg(null);
                    try {
                        const res = unwrap(await fn(r));
                        const next = res?.state ?? res;
                        if (next && next.config) {
                            setSt(next);
                            publishState(next);
                        }
                        else
                            await pull();
                        if (res && res.ok === false)
                            setMsg({ tone: 'err', text: `${label}失败:${res.message ?? '未知原因'}` });
                        else
                            setMsg({ tone: 'ok', text: okText ?? `${label}已完成` });
                    }
                    catch (error) {
                        setMsg({ tone: 'err', text: `${label}失败:${String(error?.message ?? error)}` });
                    }
                    if (alive.current)
                        setBusy(null);
                }, [remote, busy, pull]);
                const cfg = st?.config ?? {};
                const accounts = cfg.accounts ?? [];
                const conns = st?.connections ?? [];
                const selectedConn = selectedConnOf(st, cfg);
                const activeVal = cfg.activeAccountId
                    ? `acct:${cfg.activeAccountId}`
                    : selectedConn ? `conn:${selectedConn.entryId}|${selectedConn.providerId}` : '';
                const onPick = (v) => {
                    if (v.startsWith('acct:'))
                        void run('切换账号', r => r.activateAccount(v.slice(5)), '已切换账号,模型池已重新同步');
                    else if (v.startsWith('conn:')) {
                        const sep = v.indexOf('|');
                        void run('切换连接', r => r.switchConnection(v.slice(5, sep), v.slice(sep + 1)), '已切换连接,模型池已重新同步');
                    }
                    else
                        void run('恢复默认接口', r => r.activateAccount(''), '已恢复默认接口/自动沿用');
                };
                const cooling = (st?.quota ?? []).filter((q) => !q.available).length;
                const history = st?.history ?? [];
                const userHistory = history.filter((row) => row?.utility !== true);
                const last = userHistory[0] ?? history[0];
                const recent = userHistory.slice(0, 8).reverse();
                const sessionRows = last?.sessionId
                    ? userHistory.filter((row) => row.sessionId === last.sessionId).slice(0, 60)
                    : userHistory.slice(0, 12);
                const countModels = (rows, pick) => {
                    const counts = new Map();
                    for (const row of rows) {
                        const model = pick(row);
                        if (model)
                            counts.set(model, (counts.get(model) ?? 0) + 1);
                    }
                    return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
                };
                const executionModels = countModels(sessionRows, row => row.ok ? row.finalModel : undefined);
                const decisionModels = countModels(sessionRows, row => row.decisionSource === 'model' ? row.decisionModel : undefined);
                const decisionCalls = sessionRows.filter((row) => row.decisionSource === 'model').length;
                const directDecisions = sessionRows.filter((row) => row.decisionSource === 'heuristic'
                    || row.decisionSource === 'media' || row.decisionSource === 'notice').length;
                const decisionSummary = decisionCalls === 0
                    ? `决策模型：本会话未调用（规则直选 ${directDecisions} 次）`
                    : `决策模型：${decisionModels.slice(0, 3).map(([model, count]) => `${model} ×${count}`).join('、')}`
                        + (directDecisions > 0 ? `；其余 ${directDecisions} 次规则直选未调用` : '');
                const okCount = recent.filter(row => row.ok).length;
                const maxTok = Math.max(1, ...recent.map(row => Number(row.tokens) || 0));
                const fmtClock = (ms) => {
                    try {
                        return new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                    }
                    catch (_e) {
                        return '—';
                    }
                };
                const sourceText = (row) => row.decisionSource === 'model' ? '决策模型'
                    : row.decisionSource === 'heuristic' ? '规则判断'
                        : row.decisionSource === 'fallback' ? '决策超时回退'
                            : row.decisionSource === 'media' ? '媒体路由'
                                : row.decisionSource === 'notice' ? '未调用模型' : '—';
                const chip = (text, tone = 'plain') => h('span', {
                    style: {
                        display: 'inline-block', padding: '1px 6px', borderRadius: '999px', fontSize: '10px',
                        border: '1px solid var(--dsw-alias-border-l2, #ddd)',
                        background: tone === 'ok' ? 'rgba(34,197,94,.12)' : tone === 'err' ? 'rgba(239,68,68,.12)' : 'var(--dsw-alias-bg-layer-2, #f5f5f5)',
                        color: tone === 'ok' ? '#15803d' : tone === 'err' ? '#b91c1c' : 'inherit',
                        maxWidth: '100%', whiteSpace: 'normal', wordBreak: 'break-all', lineHeight: 1.4,
                    },
                }, text);
                const node = (label, model, accent) => h('div', {
                    style: {
                        flex: '1 1 0', minWidth: 0, padding: '4px 6px', borderRadius: '6px',
                        border: `1px solid ${accent ? 'var(--dsw-alias-brand-primary, #2563eb)' : 'var(--dsw-alias-border-l2, #ddd)'}`,
                        background: accent ? 'rgba(37,99,235,.08)' : 'var(--dsw-alias-bg-layer-2, #f5f5f5)',
                    },
                }, h('div', { className: 'bar-muted', style: { fontSize: '10px' } }, label), h('div', { className: 'bar-muted', style: { fontSize: '10px', whiteSpace: 'normal', wordBreak: 'break-all', lineHeight: 1.3, maxHeight: '2.6em', overflow: 'hidden' }, title: model }, model));
                const box = {
                    position: 'fixed', right: '12px', bottom: '12px', zIndex: 900, pointerEvents: 'auto',
                    width: open ? '308px' : 'auto', maxWidth: 'calc(100vw - 24px)', background: 'var(--dsw-alias-bg-l1, #fff)',
                    border: '1px solid var(--dsw-alias-border-l1, #ddd)', borderRadius: '12px',
                    boxShadow: '0 6px 24px rgba(0,0,0,.18)', padding: '10px 12px', fontSize: '12px',
                    color: 'var(--dsw-alias-text-l1, #222)', boxSizing: 'border-box',
                };
                if (!open)
                    return h('div', { style: { ...box, cursor: 'pointer' }, onClick: () => setOpen(true) }, h('style', null, CSS), h('span', { style: { display: 'inline-block', width: 8, height: 8, borderRadius: 4, marginRight: 6, background: st ? 'var(--dsw-alias-state-success-primary, #22c55e)' : '#999' } }), '智能路由');
                return h('div', { style: box }, h('style', null, CSS), h('div', { className: 'bar-row', style: { justifyContent: 'space-between', gap: '8px' } }, h('strong', { style: { display: 'flex', alignItems: 'center', gap: '6px' } }, h('span', { style: { display: 'inline-block', width: 7, height: 7, borderRadius: 4, background: st ? 'var(--dsw-alias-state-success-primary, #22c55e)' : '#999' } }), '智能路由'), h('span', { className: 'bar-muted', style: { cursor: 'pointer' }, onClick: () => setOpen(false) }, '收起')), h('div', { className: 'bar-muted', style: { margin: '4px 0', fontSize: '11px' }, title: st?.keyLedger ? `当前 key:${st.keyLedger.label}` : undefined }, st ? `模型池 ${st.pool?.count ?? 0} · 冷却 ${cooling} · 台账 ${st.keyLedger?.totalTokens ?? 0} tok${(st.ledgersTotal ?? 0) !== (st.keyLedger?.totalTokens ?? 0) ? `(累计 ${st.ledgersTotal})` : ''}` : '状态载入中…'), 
                // ---- 上次决策可视化:任务 → 决策模型 → 执行模型 ----
                last ? h('div', { style: { border: '1px solid var(--dsw-alias-border-l1, #eee)', borderRadius: '8px', padding: '8px', margin: '6px 0' } }, h('div', { className: 'bar-row', style: { justifyContent: 'space-between', gap: '6px' } }, h('span', { style: { fontWeight: 600 } }, '上次决策'), h('span', { className: 'bar-muted', style: { fontSize: '9.5px', flexShrink: 0 } }, `${fmtClock(last.at)} · ${last.origin === 'user' ? '你指定' : '自动'}`)), h('div', { className: 'bar-row', style: { gap: '4px', margin: '4px 0' } }, chip(TASK_LABELS_F[last.task] ?? last.task ?? '通用'), chip(sourceText(last)), chip(STRATEGY_LABELS_F[last.strategy] ?? last.strategy ?? '—'), chip(last.ok ? '成功' : '失败', last.ok ? 'ok' : 'err')), h('div', { style: { display: 'flex', alignItems: 'stretch', gap: '6px', margin: '4px 0' } }, node('决策模型', last.decisionModel
                    ?? (last.decisionSource === 'heuristic' ? '规则直选·未调用'
                        : last.decisionSource === 'media' ? '媒体路由·未调用'
                            : last.decisionSource === 'notice' ? '能力闸门·未调用'
                                : last.decisionSource === 'fallback' ? '决策超时·未调用' : '—'), false), h('div', { style: { alignSelf: 'center', fontSize: '13px' } }, '→'), node('本次执行模型', last.finalModel ?? '—', true)), h('div', { className: 'bar-muted', style: { fontSize: '10px', marginTop: '4px' } }, [
                    `输入 ${(last.inputTokens ?? 0) + (last.cacheReadTokens ?? 0)} tok`,
                    `输出 ${last.outputTokens ?? last.tokens ?? 0} tok`,
                    ((last.inputTokens ?? 0) + (last.cacheReadTokens ?? 0)) > 0
                        ? `缓存 ${Math.round((last.cacheReadTokens ?? 0) / ((last.inputTokens ?? 0) + (last.cacheReadTokens ?? 0)) * 100)}%`
                        : '缓存 0%',
                    last.decisionTokens ? `决策 ${last.decisionTokens} tok` : '',
                    (last.attempts?.length ?? 0) > 1 ? `试了 ${last.attempts.length} 个模型` : '',
                ].filter(Boolean).join(' · ')), executionModels.length > 0 ? h('div', { style: { marginTop: '5px' } }, h('div', { className: 'bar-muted', style: { fontSize: '10px', marginBottom: '2px' } }, `${last.sessionId ? '本会话' : '最近'}成功执行模型（${sessionRows.length} 次请求）`), h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: '3px' } }, ...executionModels.slice(0, 8).map(([model, count]) => chip(`${model} ×${count}`, 'ok')), executionModels.length > 8 ? chip(`另有 ${executionModels.length - 8} 个`, 'plain') : null), h('div', { className: 'bar-muted', style: { fontSize: '10px', marginTop: '3px', lineHeight: 1.4, wordBreak: 'break-word' } }, decisionSummary + (decisionModels.length > 3 ? ` 等 ${decisionModels.length} 个决策模型` : '')))
                    : null, last.reasoning ? h('div', {
                    style: { fontSize: '10px', marginTop: '3px', lineHeight: 1.35, color: 'var(--dsw-alias-text-l2, #666)', wordBreak: 'break-word' },
                    title: String(last.reasoning),
                }, `理由:${String(last.reasoning).slice(0, 140)}${String(last.reasoning).length > 140 ? '…' : ''}`) : null)
                    : h('div', { className: 'bar-muted', style: { margin: '8px 0', fontSize: '11px' } }, '还没有路由记录 — 发一条消息后,这里会显示「任务 → 决策模型 → 执行模型」的分配结果。'), 
                // ---- 近 8 次迷你趋势 ----
                recent.length > 0 ? h('div', { style: { margin: '4px 0 6px' } }, h('div', { style: { display: 'flex', alignItems: 'flex-end', gap: '3px', height: '20px' } }, ...recent.map((row, index) => h('div', {
                    key: `${row.at}-${index}`,
                    title: `${fmtClock(row.at)} · ${TASK_LABELS_F[row.task] ?? row.task} · ${row.finalModel ?? '—'} · ${row.tokens ?? 0} tok · ${row.ok ? '成功' : '失败'}`,
                    style: {
                        flex: '1 1 0', minWidth: '4px', height: `${Math.max(4, Math.round(((Number(row.tokens) || 0) / maxTok) * 18))}px`,
                        background: row.ok ? 'rgba(34,197,94,.55)' : 'rgba(239,68,68,.6)', borderRadius: '2px',
                    },
                }))), h('div', { className: 'bar-muted', style: { fontSize: '10px', marginTop: '2px' } }, `近 ${recent.length} 次 · 成功 ${okCount}/${recent.length}`))
                    : null, msg ? h('div', { className: msg.tone === 'ok' ? 'bar-ok' : 'bar-error', style: { fontSize: '11px', margin: '4px 0' } }, msg.text) : null, h('div', { className: 'bar-row', style: { gap: '4px', marginTop: '4px' } }, h('select', {
                    className: 'bar-input', style: { flex: 1, minWidth: 0 }, value: cfg.sortStrategy ?? 'auto', disabled: busy !== null,
                    onChange: (e) => void run('切换排序', r => r.updateConfig({ sortStrategy: e.target.value }), `排序已切换:${STRATEGY_LABELS_F[e.target.value] ?? e.target.value}`),
                }, h('option', { value: 'auto' }, '智能排序'), h('option', { value: 'price' }, '价格优先'), h('option', { value: 'capability' }, '能力优先'), h('option', { value: 'speed' }, '速度优先'), h('option', { value: 'free_quota' }, '薅免费额度')), h('div', {
                    className: 'bar-btn', role: 'button',
                    style: busy === '刷新模型池' ? { opacity: .6 } : undefined,
                    onClick: () => void run('刷新模型池', r => r.refreshPool(), '模型池已刷新'),
                }, busy === '刷新模型池' ? '刷新中…' : '刷新')), h('select', {
                    className: 'bar-input', style: { width: '100%', marginTop: '4px', minWidth: 0 },
                    value: activeVal, disabled: busy !== null, onChange: (e) => onPick(e.target.value),
                }, h('option', { value: '' }, '默认接口 / 自动沿用'), ...accounts.map((a) => h('option', { key: a.id, value: `acct:${a.id}` }, a.name)), ...conns.map((c) => h('option', { key: connKeyOf(c), value: `conn:${c.id}|${c.providerId}` }, connLabelOf(c, cfg.connectionNames)))));
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
                    // 0.7.3: 逐槽容错注册——移动宿主若缺某个 slot,只少对应组件,不连累面板。
                    const injectSlot = (slot, register) => {
                        try {
                            ctx.slots.inject(slot, register);
                        }
                        catch (error) {
                            ctx.logger?.warn?.(`${PACKAGE}: slot ${slot} 不可用:${String(error?.message ?? error)}`);
                        }
                    };
                    injectSlot('settings.models.footer', () => ctx.slots.register({
                        name: 'settings.models.footer', id: 'auto-router-status', order: 50,
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
                    injectSlot('plugins.bundle.config', () => ctx.slots.register({
                        name: 'plugins.bundle.config', key: PACKAGE, inject: () => ({ ctx }),
                    }, (props) => h(Panel, { ...props, ctx })));
                    // 0.7.2: 主页/全应用右下角浮窗(shell.overlay 为追加式浮层,不遮挡底层)。
                    injectSlot('shell.overlay', () => ctx.slots.register({
                        name: 'shell.overlay', id: 'auto-router-float', order: 60, label: '智能路由',
                    }, FloatCard));
                },
            };
        },
    });
}
