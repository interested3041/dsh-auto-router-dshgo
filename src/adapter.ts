/**
 * The virtual-model LlmAdapter: one entry in the DSH model selector
 * ("智能路由 Auto Router") whose every request is analyzed by the decision
 * model and routed to the best available execution model (any vendor).
 */
import { LlmAdapter } from '@deepseek-ai/dsh-llm'
import type { GenerateOptions, LlmModelInfo, LlmProviderInfo, LlmResolvedModelInfo, PreparedAdapterCall, StreamChunk } from '@deepseek-ai/dsh-llm'
import { PROVIDER, VIRTUAL_MODEL, VIRTUAL_MODEL_NAME } from './catalog.js'
import type { Router, RouterSnapshot } from './router.js'
import { virtualContextWindow } from './router.js'

/** Provider display name in model selectors and diagnostics. */
const PROVIDER_NAME = '智能路由 Auto Router'

/** LlmAdapter over the decision-model router. */
export class BailianAutoAdapter extends LlmAdapter {
  constructor(private readonly router: Router) {
    super()
  }

  override providerInfo(provider: string): LlmProviderInfo {
    return { id: provider, name: PROVIDER_NAME }
  }

  /**
   * The GUI catalog: exactly one virtual model. Concrete Bailian ids are still
   * accepted by `stream()` for pass-through debugging, but are not advertised.
   */
  override async listModels(provider: string): Promise<readonly LlmModelInfo[]> {
    return [{
      provider,
      id: VIRTUAL_MODEL,
      name: VIRTUAL_MODEL_NAME,
      description: '决策模型自动选择最合适的执行模型(多厂商);额度感知与静默回退',
      inputModalities: ['text', 'image'],
      badge: { text: { en: 'Auto', zh: '智能路由' }, tone: 'info' },
    }]
  }

  override async resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
    await this.router.whenReady()
    return this.modelInfo(provider, model, this.router.capture())
  }

  override async prepareCall(provider: string, model: string): Promise<PreparedAdapterCall> {
    await this.router.whenReady()
    const snapshot = this.router.capture()
    return {
      model: this.modelInfo(provider, model, snapshot),
      stream: options => this.router.stream(options, snapshot),
    }
  }

  stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    return this.router.stream(options, this.router.capture())
  }

  /** Model metadata of the virtual route (or one pass-through id). */
  private modelInfo(provider: string, model: string, snapshot: RouterSnapshot): LlmResolvedModelInfo {
    if (model !== VIRTUAL_MODEL) {
      const entry = snapshot.entries.find(candidate => candidate.id === model)
      return {
        provider,
        id: model,
        name: entry?.name ?? model,
        ...(entry?.vision === true ? { inputModalities: ['text', 'image'] as const } : { inputModalities: ['text'] as const }),
        context: { contextWindow: entry?.contextWindow ?? 131072 },
      }
    }
    return {
      provider,
      id: VIRTUAL_MODEL,
      name: VIRTUAL_MODEL_NAME,
      description: '决策模型自动选择最合适的执行模型(多厂商);额度感知、负载均衡与静默回退',
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
    }
  }
}

/** The registered provider route id. */
export { PROVIDER }
