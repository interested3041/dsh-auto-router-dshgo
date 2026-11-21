/**
 * Built-in Aliyun Bailian (DashScope / MaaS compatible-mode) model catalog and
 * the default task routing table.
 *
 * The catalog carries only routing-relevant metadata (vision capability,
 * context window, task affinity tags). It seeds the execution pool before the
 * first `/models` sync and annotates synced model ids. Every value is
 * user-overridable through the plugin Config (`models`, `taskRoutes`).
 *
 * Ids follow the compatible-mode spelling this deployment actually serves
 * (including workspace-specific versions such as `deepseek-v4.1-flash-1017`).
 */
export const TASK_TYPES = ['writing', 'translation', 'code', 'reasoning', 'image', 'general'];
/** Public Bailian (DashScope) OpenAI-compatible endpoint. */
export const DEFAULT_BASE_URL = 'https://dashscope.aliyuncs.com/compatible-mode/v1';
/** Virtual provider route and model id registered with `ctx.llm.registerAdapter`. */
export const PROVIDER = 'bailian-auto';
export const VIRTUAL_MODEL = 'bailian-auto';
/** Display name of the virtual model in the DSH model selector (vendor-neutral). */
export const VIRTUAL_MODEL_NAME = '智能路由 Auto Router';
/** Default decision/fallback model: the fast flagship used across this profile. */
export const DEFAULT_DECISION_MODEL = 'deepseek-v4.1-flash-1017';
export const DEFAULT_FALLBACK_MODEL = 'deepseek-v4.1-flash-1017';
/**
 * Credential references tried in order (vendor-neutral). The first configured
 * one wins; per-vendor refs are prepended by the config resolver, so a profile
 * exporting any supported platform key works with no extra setup.
 */
export const API_KEY_REFS = [
    'BAILIAN_API_KEY', 'DASHSCOPE_API_KEY', 'ALIYUN_API_KEY',
    'SILICONFLOW_API_KEY', 'OPENROUTER_API_KEY', 'ARK_API_KEY', 'VOLCENGINE_API_KEY',
    'ZHIPU_API_KEY', 'BIGMODEL_API_KEY', 'MOONSHOT_API_KEY', 'DEEPSEEK_API_KEY',
];
/** Default credential reference (first of {@link API_KEY_REFS}). */
export const DEFAULT_API_KEY_ENV = API_KEY_REFS[0];
/**
 * Built-in catalog. Entries are advisory: an id missing here still routes when a
 * task route, the pool sync, or the decision model names it, with capabilities
 * inferred from its spelling.
 */
export const BUILTIN_CATALOG = [
    // --- DeepSeek family (hosted on Bailian) ---
    { id: 'deepseek-v4.1-flash-1017', name: 'DeepSeek V4.1 Flash', vision: true, contextWindow: 1048576, tags: ['general', 'reasoning', 'code', 'image'] },
    { id: 'deepseek-v4.1-flash', name: 'DeepSeek V4.1 Flash(别名)', vision: false, contextWindow: 131072, tags: ['general', 'reasoning'] },
    { id: 'deepseek-v4-pro', name: 'DeepSeek V4 Pro', vision: false, contextWindow: 1048576, tags: ['code', 'reasoning'] },
    { id: 'vanchin/deepseek-v4-pro', name: 'DeepSeek V4 Pro(vanchin)', vision: false, contextWindow: 1048576, tags: ['code', 'reasoning'] },
    { id: 'deepseek-v4-pro-0813', name: 'DeepSeek V4 Pro 0813', vision: false, contextWindow: 1048576, tags: ['code', 'reasoning'] },
    { id: 'deepseek-v4-flash-0731', name: 'DeepSeek V4 Flash 0731', vision: false, contextWindow: 131072, tags: ['general', 'reasoning'] },
    { id: 'vanchin/deepseek-v3.2-think', name: 'DeepSeek V3.2 Think', vision: false, contextWindow: 131072, tags: ['reasoning'] },
    { id: 'vanchin/deepseek-r1', name: 'DeepSeek R1', vision: false, contextWindow: 131072, tags: ['reasoning'] },
    { id: 'vanchin/deepseek-ocr', name: 'DeepSeek OCR', vision: true, contextWindow: 32768, tags: ['image'] },
    // --- Qwen flagship / plus / flash ---
    { id: 'qwen3.8-max-0902', name: 'Qwen3.8 Max 0902', vision: true, contextWindow: 262144, tags: ['writing', 'code', 'reasoning', 'translation', 'image'] },
    { id: 'qwen3.8-max', name: 'Qwen3.8 Max', vision: false, contextWindow: 262144, tags: ['writing', 'reasoning', 'code'] },
    { id: 'qwen3.8-flash', name: 'Qwen3.8 Flash', vision: false, contextWindow: 131072, tags: ['general', 'translation'] },
    { id: 'cmaas-qwen3.8-flash', name: 'Qwen3.8 Flash(cmaas)', vision: false, contextWindow: 131072, tags: ['general', 'translation'] },
    { id: 'qwen3.8-2.4t-a95b', name: 'Qwen3.8 2.4T A95B', vision: false, contextWindow: 262144, tags: ['reasoning', 'code'] },
    { id: 'qwen3.7-max', name: 'Qwen3.7 Max', vision: false, contextWindow: 262144, tags: ['writing', 'reasoning'] },
    { id: 'qwen3.6-plus', name: 'Qwen3.6 Plus', vision: false, contextWindow: 131072, tags: ['general', 'writing'] },
    { id: 'qwen-plus', name: 'Qwen Plus', vision: false, contextWindow: 131072, tags: ['general', 'translation'] },
    { id: 'qwen-turbo', name: 'Qwen Turbo', vision: false, contextWindow: 131072, tags: ['general'] },
    { id: 'qwen-long', name: 'Qwen Long', vision: false, contextWindow: 10000000, tags: ['general', 'writing'] },
    { id: 'qwen-flash', name: 'Qwen Flash', vision: false, contextWindow: 131072, tags: ['general'] },
    // --- Qwen vision family ---
    { id: 'qwen3-vl-plus', name: 'Qwen3 VL Plus', vision: true, contextWindow: 131072, tags: ['image', 'reasoning'] },
    { id: 'qwen-vl-ocr', name: 'Qwen VL OCR', vision: true, contextWindow: 32768, tags: ['image'] },
    { id: 'qwen-vl-ocr-2025-11-20', name: 'Qwen VL OCR 2025-11-20', vision: true, contextWindow: 32768, tags: ['image'] },
    { id: 'qwen3.5-ocr', name: 'Qwen3.5 OCR', vision: true, contextWindow: 32768, tags: ['image'] },
    { id: 'qwen3-omni-flash', name: 'Qwen3 Omni Flash', vision: true, contextWindow: 65536, tags: ['image', 'general'] },
    { id: 'qwen3.8-omni-flash', name: 'Qwen3.8 Omni Flash', vision: true, contextWindow: 65536, tags: ['image', 'general'] },
    { id: 'qvq-max', name: 'QVQ Max(视觉推理)', vision: true, contextWindow: 131072, tags: ['image', 'reasoning'] },
    // --- Third-party hosted on Bailian ---
    { id: 'glm-5.2', name: 'GLM 5.2', vision: false, contextWindow: 204800, tags: ['writing', 'code', 'translation'] },
    { id: 'glm-5.3', name: 'GLM 5.3', vision: false, contextWindow: 204800, tags: ['writing', 'code'] },
    { id: 'cmaas-glm-5.3', name: 'GLM 5.3(cmaas)', vision: false, contextWindow: 204800, tags: ['writing', 'code'] },
    { id: 'glm-5.3-prime', name: 'GLM 5.3 Prime', vision: false, contextWindow: 204800, tags: ['writing', 'reasoning'] },
    { id: 'kimi-k3.1-pro', name: 'Kimi K3.1 Pro', vision: false, contextWindow: 262144, tags: ['writing', 'reasoning', 'code'] },
    { id: 'kimi-k3', name: 'Kimi K3', vision: false, contextWindow: 262144, tags: ['writing', 'general'] },
    { id: 'kimi-k2.7-code', name: 'Kimi K2.7 Code', vision: false, contextWindow: 262144, tags: ['code'] },
    { id: 'MiniMax/MiniMax-M3', name: 'MiniMax M3', vision: false, contextWindow: 204800, tags: ['writing', 'general'] },
    { id: 'MiniMax/MiniMax-M3.1-Flash', name: 'MiniMax M3.1 Flash', vision: false, contextWindow: 204800, tags: ['general'] },
    { id: 'stepfun/step-5-preview', name: 'Step 5 Preview', vision: false, contextWindow: 131072, tags: ['reasoning'] },
    { id: 'stepfun/step-3.7-flash', name: 'Step 3.7 Flash', vision: false, contextWindow: 131072, tags: ['general'] },
    { id: 'antdigital/Ling-3.1-flash', name: 'Ling 3.1 Flash', vision: false, contextWindow: 131072, tags: ['general'] },
    // --- Translation specialists ---
    { id: 'qwen-mt-plus', name: 'Qwen MT Plus(翻译)', vision: false, contextWindow: 8192, tags: ['translation'] },
    { id: 'qwen-mt-flash', name: 'Qwen MT Flash(翻译)', vision: false, contextWindow: 8192, tags: ['translation'] },
    { id: 'qwen-mt-uni', name: 'Qwen MT Uni(翻译)', vision: false, contextWindow: 8192, tags: ['translation'] },
    { id: 'qwen-mt-lite', name: 'Qwen MT Lite(翻译)', vision: false, contextWindow: 8192, tags: ['translation'] },
];
/** Fallback context window for pool entries with no declared capacity. */
export const DEFAULT_CONTEXT_WINDOW = 131072;
/**
 * Default task routing table (ordered candidate preference). The image route
 * only lists vision-capable models; the router additionally hard-filters any
 * candidate list to vision-capable models when the request carries images.
 */
export const DEFAULT_TASK_ROUTES = {
    image: ['qwen3.8-max-0902', 'qwen3-vl-plus', 'qwen3.8-omni-flash', 'qwen-vl-ocr', 'qvq-max'],
    writing: ['glm-5.2', 'qwen3.8-max-0902', 'qwen3.8-max', 'kimi-k3.1-pro'],
    translation: ['qwen-mt-plus', 'qwen3.8-max-0902', 'glm-5.2', 'qwen-plus'],
    code: ['deepseek-v4-pro', 'qwen3.8-max-0902', 'glm-5.2', 'kimi-k3.1-pro'],
    reasoning: ['deepseek-v4-pro', 'qwen3.8-max-0902', 'vanchin/deepseek-r1', 'glm-5.3-prime'],
    general: ['deepseek-v4.1-flash-1017', 'qwen3.8-flash', 'qwen-plus', 'qwen-turbo'],
};
/** Vision-capability inference for model ids that no catalog entry describes. */
const VISION_ID_PATTERN = /(?:^|[-./])(?:vl|vision|qvq|omni|ocr)(?:[-./]|$)|^qvq|^qwen-vl|omni/i;
/** @param id - model id discovered from the endpoint or named by configuration. */
export function inferVision(id) {
    return VISION_ID_PATTERN.test(id);
}
/** Built-in catalog lookup by exact id. */
export function catalogEntry(id) {
    return BUILTIN_CATALOG.find(entry => entry.id === id);
}
