/**
 * The `bailian-auto` LlmAdapter: one virtual model in the DSH model selector
 * ("百炼智能路由") whose every request is analyzed by the decision model and
 * routed to the best available Bailian execution model.
 */
import { LlmAdapter } from '@deepseek-ai/dsh-llm';
import { PROVIDER, VIRTUAL_MODEL, VIRTUAL_MODEL_NAME } from './catalog.js';
import { virtualContextWindow } from './router.js';
/** Provider display name in model selectors and diagnostics. */
const PROVIDER_NAME = '阿里云百炼 · 智能路由';
/** LlmAdapter over the decision-model router. */
export class BailianAutoAdapter extends LlmAdapter {
    router;
    constructor(router) {
        super();
        this.router = router;
    }
    providerInfo(provider) {
        return { id: provider, name: PROVIDER_NAME };
    }
    /**
     * The GUI catalog: exactly one virtual model. Concrete Bailian ids are still
     * accepted by `stream()` for pass-through debugging, but are not advertised.
     */
    async listModels(provider) {
        return [{
                provider,
                id: VIRTUAL_MODEL,
                name: VIRTUAL_MODEL_NAME,
                description: '决策模型自动选择最合适的百炼执行模型;额度感知与静默回退',
                inputModalities: ['text', 'image'],
                badge: { text: { en: 'Auto', zh: '智能路由' }, tone: 'info' },
            }];
    }
    async resolveModel(provider, model) {
        await this.router.whenReady();
        return this.modelInfo(provider, model, this.router.capture());
    }
    async prepareCall(provider, model) {
        await this.router.whenReady();
        const snapshot = this.router.capture();
        return {
            model: this.modelInfo(provider, model, snapshot),
            stream: options => this.router.stream(options, snapshot),
        };
    }
    stream(options) {
        return this.router.stream(options, this.router.capture());
    }
    /** Model metadata of the virtual route (or one pass-through id). */
    modelInfo(provider, model, snapshot) {
        if (model !== VIRTUAL_MODEL) {
            const entry = snapshot.entries.find(candidate => candidate.id === model);
            return {
                provider,
                id: model,
                name: entry?.name ?? model,
                ...(entry?.vision === true ? { inputModalities: ['text', 'image'] } : { inputModalities: ['text'] }),
                context: { contextWindow: entry?.contextWindow ?? 131072 },
            };
        }
        return {
            provider,
            id: VIRTUAL_MODEL,
            name: VIRTUAL_MODEL_NAME,
            description: '决策模型自动选择最合适的百炼执行模型;额度感知、负载均衡与静默回退',
            inputModalities: ['text', 'image'],
            badge: { text: { en: 'Auto', zh: '智能路由' }, tone: 'info' },
            // `auto` scales the reasoning effort with the detected task complexity;
            // a concrete level pins it for every request of this session.
            reasoning: {
                efforts: [
                    { id: 'auto', name: '自动(按任务复杂度)' },
                    { id: 'off', name: '关闭思考' },
                    { id: 'low', name: '低' },
                    { id: 'medium', name: '中' },
                    { id: 'high', name: '高' },
                    { id: 'max', name: '最高' },
                ],
                defaultEffort: 'auto',
            },
            // Advertised capacity of the aggregate pool; the chosen execution model
            // enforces its own true limit (CONTEXT_WINDOW_EXCEEDED surfaces as-is).
            context: { contextWindow: virtualContextWindow(snapshot) },
        };
    }
}
/** The registered provider route id. */
export { PROVIDER };
