/**
 * Multi-vendor presets: "one API key, many models" OpenAI-compatible platforms.
 *
 * The router is vendor-neutral. Bailian (DashScope / MaaS) is the default
 * preset, but any platform whose single key exposes a multi-model
 * `/models` listing can be routed: SiliconFlow, OpenRouter, Volcengine Ark,
 * Zhipu, Moonshot, DeepSeek official, or a generic OpenAI-compatible gateway.
 *
 * Each preset carries: a display name, a default base URL, the credential
 * references tried in order, an endpoint matcher for zero-config discovery,
 * and the thinking-parameter style its wire protocol honors.
 */

/** Supported vendor identifiers (`auto` resolves from the effective base URL). */
export type VendorId =
  | 'bailian' | 'siliconflow' | 'openrouter' | 'volcengine'
  | 'zhipu' | 'moonshot' | 'deepseek' | 'generic'

/** How a vendor's OpenAI-compatible wire expects thinking to be controlled. */
export type ThinkingStyle = 'enable_thinking' | 'reasoning_effort' | 'none'

/** One vendor preset. */
export interface VendorPreset {
  readonly id: VendorId
  /** Human-readable platform name for panels and docs. */
  readonly name: string
  /** Default OpenAI-compatible base URL. */
  readonly baseURL: string
  /** Credential references tried in order (first configured wins). */
  readonly apiKeyRefs: readonly string[]
  /** Matches base URLs belonging to this platform. */
  readonly endpoint: RegExp
  /** Thinking-parameter style honored by this platform's wire. */
  readonly thinking: ThinkingStyle
}

/** Built-in vendor presets, most-specific first. */
export const VENDORS: readonly VendorPreset[] = [
  {
    id: 'bailian', name: '阿里云百炼',
    baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    apiKeyRefs: ['BAILIAN_API_KEY', 'DASHSCOPE_API_KEY', 'ALIYUN_API_KEY'],
    endpoint: /(?:dashscope\.aliyuncs\.com|maas\.aliyuncs\.com|\.aliyuncs\.com\/compatible-mode)/i,
    thinking: 'enable_thinking',
  },
  {
    id: 'siliconflow', name: '硅基流动',
    baseURL: 'https://api.siliconflow.cn/v1',
    apiKeyRefs: ['SILICONFLOW_API_KEY'],
    endpoint: /siliconflow\.cn/i,
    thinking: 'enable_thinking',
  },
  {
    id: 'openrouter', name: 'OpenRouter',
    baseURL: 'https://openrouter.ai/api/v1',
    apiKeyRefs: ['OPENROUTER_API_KEY'],
    endpoint: /openrouter\.ai/i,
    thinking: 'reasoning_effort',
  },
  {
    id: 'volcengine', name: '火山方舟',
    baseURL: 'https://ark.cn-beijing.volces.com/api/v3',
    apiKeyRefs: ['ARK_API_KEY', 'VOLCENGINE_API_KEY'],
    endpoint: /volces\.com/i,
    thinking: 'reasoning_effort',
  },
  {
    id: 'zhipu', name: '智谱开放平台',
    baseURL: 'https://open.bigmodel.cn/api/paas/v4',
    apiKeyRefs: ['ZHIPU_API_KEY', 'BIGMODEL_API_KEY'],
    endpoint: /bigmodel\.cn/i,
    thinking: 'enable_thinking',
  },
  {
    id: 'moonshot', name: 'Moonshot',
    baseURL: 'https://api.moonshot.cn/v1',
    apiKeyRefs: ['MOONSHOT_API_KEY'],
    endpoint: /moonshot\.cn/i,
    thinking: 'none',
  },
  {
    id: 'deepseek', name: 'DeepSeek 官方',
    baseURL: 'https://api.deepseek.com/v1',
    apiKeyRefs: ['DEEPSEEK_API_KEY'],
    endpoint: /api\.deepseek\.com/i,
    thinking: 'reasoning_effort',
  },
]

/** Fallback preset for any other OpenAI-compatible gateway. */
export const GENERIC_VENDOR: VendorPreset = {
  id: 'generic', name: '通用 OpenAI 兼容',
  baseURL: '',
  apiKeyRefs: [],
  endpoint: /.*/,
  thinking: 'reasoning_effort',
}

/** Resolve the preset for an explicit vendor id, or auto-detect from a URL. */
export function vendorPreset(vendor: VendorId | 'auto' | undefined, baseURL: string): VendorPreset {
  if (vendor !== undefined && vendor !== 'auto') return VENDORS.find(v => v.id === vendor) ?? GENERIC_VENDOR
  return detectVendor(baseURL)
}

/** Auto-detect the vendor from a base URL (generic when unrecognized). */
export function detectVendor(baseURL: string): VendorPreset {
  return VENDORS.find(v => v.endpoint.test(baseURL)) ?? GENERIC_VENDOR
}

/**
 * Whether a base URL is a routable OpenAI-compatible endpoint: a known vendor,
 * or a generic gateway whose path looks like a versioned API root.
 */
export function isRoutableEndpoint(baseURL: string): boolean {
  if (VENDORS.some(v => v.endpoint.test(baseURL))) return true
  return /\/(?:v\d+|compatible-mode|api\/v\d+|paas\/v\d+)(?:\/|$)/i.test(baseURL)
}

/** Thinking style for the effective vendor + base URL. */
export function thinkingStyleFor(vendor: VendorId | 'auto' | undefined, baseURL: string): ThinkingStyle {
  return vendorPreset(vendor, baseURL).thinking
}

/** Credential references for the effective vendor, most-specific first. */
export function vendorKeyRefs(vendor: VendorId | 'auto' | undefined, baseURL: string): readonly string[] {
  return vendorPreset(vendor, baseURL).apiKeyRefs
}