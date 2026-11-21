/**
 * Ambient declarations for the DSH (DeepSeek Harness) runtime packages this
 * plugin peer-depends on. The declarations mirror the installed 0.2.x contract
 * (read from `@deepseek-ai/dsh-llm` src/types.ts, src/index.ts, src/message.ts,
 * `@deepseek-ai/dsh-home-paths` src/index.ts, and schemastery 3.19) so the build
 * type-checks without installing the private runtime packages. At runtime the
 * DSH loader resolves these bare imports from the DSH installation.
 */

declare module '@deepseek-ai/dsh-llm' {
  // ---- failures -----------------------------------------------------------
  export interface LlmFailure {
    readonly message: string
    readonly code: string
    readonly status?: number
    readonly providerRetryAfterMs?: number
    readonly requestId?: string
    readonly offloadImages?: number
  }

  export type BuiltinLlmFailureCode =
    | 'ABORTED' | 'AUTH' | 'ACCOUNT_QUOTA' | 'CONTEXT_WINDOW_EXCEEDED' | 'DUPLICATE_ADAPTER'
    | 'EMPTY_RESPONSE' | 'HTTP_400' | 'HTTP_401' | 'HTTP_403' | 'HTTP_404' | 'HTTP_408'
    | 'HTTP_409' | 'HTTP_413' | 'HTTP_429' | 'HTTP_500' | 'HTTP_502' | 'HTTP_503' | 'HTTP_504'
    | 'IMAGE_OFFLOAD_REQUIRED' | 'INVALID_CREDENTIAL' | 'INVALID_MODEL_INFO' | 'INVALID_PREPARED_CALL'
    | 'INVALID_REQUEST' | 'MALFORMED_RESPONSE' | 'MISSING_CREDENTIAL' | 'NO_ADAPTER' | 'QUOTA'
    | 'RATE_LIMIT' | 'REGISTRATION_DISPOSED' | 'SERVER' | 'TIMEOUT' | 'TRANSPORT'
    | 'UNKNOWN_MODEL' | 'UNSUPPORTED_CONTENT' | 'UNSUPPORTED_OPTION'

  export interface LlmErrorOptions {
    status?: number
    providerRetryAfterMs?: number
    requestId?: string
    offloadImages?: number
    cause?: unknown
  }

  export class LlmError extends Error {
    readonly code: string
    readonly status?: number
    readonly providerRetryAfterMs?: number
    readonly requestId?: string
    readonly offloadImages?: number
    constructor(message: string, code: BuiltinLlmFailureCode | `HTTP_${number}`, options?: LlmErrorOptions)
    readonly failure: LlmFailure
    static fromFailure(failure: LlmFailure, options?: { cause?: unknown }): LlmError
  }

  export const LLM_FAILURE_CODES: readonly string[]

  // ---- attribution ----------------------------------------------------------
  export interface AppIdentity {
    product: string
    version: string
    url: string
    suffix?: string | undefined
  }
  export const APP_IDENTITY: AppIdentity
  export function userAgent(identity?: AppIdentity): string
  export function attributionHeaders(identity?: AppIdentity): Record<string, string>

  // ---- content vocabulary ----------------------------------------------------
  export interface TextBlock { type: 'text'; text: string }
  export interface ReasoningBlock { type: 'reasoning'; text: string }
  export interface ImageAttachmentRefLike {
    readonly attachmentId: string
    readonly width: number
    readonly height: number
    readonly bytes: number
    readonly mediaType?: string
  }
  export interface ImageBlock {
    type: 'image'
    attachment: ImageAttachmentRefLike
    offloaded?: true
  }
  export interface FileAttachmentRefLike { readonly attachmentId: string; readonly name?: string }
  export interface FileBlock { type: 'file'; attachment: FileAttachmentRefLike }
  export interface ToolCallBlock { type: 'tool-call'; id: string; name: string; arguments: string }
  export interface ToolAdditionBlock { type: 'tool-addition'; toolName: string }
  export interface ToolRemovalBlock { type: 'tool-removal'; toolName: string }
  /**
   * Closed union of the block kinds this plugin reads. The harness union is
   * merge-extensible; unknown kinds flow through untouched at runtime and are
   * ignored by the wire translation.
   */
  export type ContentBlock =
    | TextBlock | ReasoningBlock | ImageBlock | FileBlock
    | ToolCallBlock | ToolAdditionBlock | ToolRemovalBlock

  // ---- messages ----------------------------------------------------------------
  export interface SystemMessage {
    readonly role: 'system'
    readonly id: string
    readonly content: readonly ContentBlock[]
    readonly source: { kind: 'system-prompt' }
  }
  export interface DeveloperMessage {
    readonly role: 'developer'
    readonly id: string
    readonly content: readonly ContentBlock[]
    readonly source: unknown
  }
  export interface UserMessage {
    readonly role: 'user'
    readonly id: string
    readonly content: readonly ContentBlock[]
    readonly source: unknown
  }
  export interface AssistantMessage {
    readonly role: 'assistant'
    readonly id: string
    readonly content: readonly ContentBlock[]
    readonly source: { kind: 'model'; provider: string; model: string; replayState?: unknown }
  }
  export interface ToolResultMessage {
    readonly role: 'tool'
    readonly id: string
    readonly content: readonly ContentBlock[]
    readonly source: { kind: 'tool'; callId: string }
    readonly toolCallId: string
    readonly isError?: boolean
  }
  export type Message = SystemMessage | DeveloperMessage | UserMessage | AssistantMessage | ToolResultMessage
  export interface RequestUserInput {
    readonly role: 'user'
    readonly content: readonly ContentBlock[]
    readonly id?: never
    readonly source?: never
  }
  export type RequestMessage = Message | RequestUserInput

  // ---- streaming -----------------------------------------------------------------
  export interface TokenUsage {
    inputTokens: number
    outputTokens: number
    totalTokens?: number
    cacheReadTokens?: number
    cacheWriteTokens?: number
    reasoningTokens?: number
  }
  export type FinishReason =
    | { kind: 'stop' }
    | { kind: 'tool-calls' }
    | { kind: 'max-tokens' }
    | { kind: 'aborted'; failure: LlmFailure }
    | { kind: 'error'; failure: LlmFailure }
  export interface ReplayEnvelope { response: unknown; blocks?: readonly unknown[] }
  export type StreamChunk =
    | { type: 'block-start'; index: number; blockType: string }
    | { type: 'text-delta'; index: number; text: string }
    | { type: 'reasoning-delta'; index: number; text: string }
    | { type: 'tool-call-delta'; index: number; id: string; name?: string; argumentsDelta: string }
    | { type: 'block-end'; index: number; block: ContentBlock }
    | { type: 'usage'; usage: TokenUsage }
    | { type: 'finish'; reason: FinishReason; replayState?: ReplayEnvelope }

  export interface ToolSchema {
    deferLoading?: true
    name: string
    description: string
    parameters: Record<string, unknown>
  }
  export interface ToolHistory {
    readonly tools: readonly ToolSchema[]
    readonly updates: readonly { readonly messageId: string; readonly additions: readonly ToolSchema[] }[]
  }
  export interface GenerateOptions<Purpose extends string = string> {
    provider: string
    model: string
    reasoningEffort?: string
    messages: RequestMessage[]
    system?: string
    tools?: ToolSchema[]
    toolHistory?: ToolHistory
    temperature?: number
    maxTokens?: number
    stop?: string[]
    signal?: AbortSignal
    sessionId?: string
    purpose?: Purpose
  }

  // ---- model metadata -------------------------------------------------------------
  export type ModelModality = 'text' | 'image'
  export type LlmModelBadgeTone = 'neutral' | 'info' | 'success' | 'warning'
  export interface LlmModelBadge {
    text: string | Record<string, string>
    tone: LlmModelBadgeTone
  }
  export interface LlmProviderInfo { id: string; name: string }
  export interface LlmModelInfo {
    provider: string
    id: string
    name: string
    description?: string
    inputModalities?: readonly ModelModality[]
    badge?: LlmModelBadge
  }
  export interface LlmModelContext { contextWindow: number }
  export interface LlmReasoningEffortInfo { id: string; name: string; description?: string }
  export interface LlmModelReasoningInfo {
    efforts: readonly LlmReasoningEffortInfo[]
    defaultEffort?: string
  }
  export interface LlmResolvedModelInfo extends LlmModelInfo {
    context?: LlmModelContext
    defaultMaxTokens?: number
    reasoning?: LlmModelReasoningInfo
    systemPromptUpdate?: 'in-history'
    toolUpdate?: 'in-history' | 'addition-only'
  }
  export interface LlmDiscoveredModel {
    id: string
    name?: string
    contextWindow?: number
    maxTokens?: number
    inputModalities?: readonly ModelModality[]
  }

  // ---- adapter contract --------------------------------------------------------------
  export interface PreparedAdapterCall {
    readonly model: LlmResolvedModelInfo
    stream(options: GenerateOptions): AsyncIterable<StreamChunk>
  }
  export interface LlmImageRequestPricing {
    priceImages(images: readonly ImageBlock[]): readonly { visualTokens: number; text: string }[]
  }
  export interface ImageRequestTarget { width: number; height: number; maxBytes: number }
  export abstract class LlmAdapter {
    providerInfo(provider: string): LlmProviderInfo
    providerRetryPolicy(provider: string): unknown | undefined
    imageRequestPricing(provider: string, model: string): LlmImageRequestPricing | undefined
    imageRequestTarget(provider: string, model: string, image: ImageAttachmentRefLike): ImageRequestTarget
    listModels(provider: string): Promise<readonly LlmModelInfo[]>
    resolveModel(provider: string, model: string, signal?: AbortSignal): Promise<LlmResolvedModelInfo>
    prepareCall(provider: string, model: string, signal?: AbortSignal): Promise<PreparedAdapterCall>
    abstract stream(options: GenerateOptions): AsyncIterable<StreamChunk>
  }
  export interface AdapterRegistrationHandle {
    (): void
    replace(providers: string[]): void
  }
}

declare module '@deepseek-ai/dsh-home-paths' {
  export function resolveDshHome(configured?: string, env?: Record<string, string | undefined>): string
  export function dshHomePath(...segments: string[]): string
}

declare module '@deepseek-ai/schemastery' {
  /** Volatile reference: parsed once, read with `.get()`, updated in place. */
  export interface Volatile<T> { get(): T }

  export interface Schema<T = any> {
    (value?: unknown, options?: unknown): T
    required(): Schema<T>
    default(value: T extends undefined ? never : T): Schema<T>
    description(text: string): Schema<T>
    volatile(): Schema<T>
    role(role: string): Schema<T>
    min(value: number): Schema<T>
    max(value: number): Schema<T>
    step(value: number): Schema<T>
  }

  interface SchemaConstructor {
    any(): Schema
    never(): Schema
    const<T>(value: T): Schema<T>
    number(): Schema<number>
    string(): Schema<string>
    boolean(): Schema<boolean>
    is(ctor: Function): Schema
    array<T>(inner: Schema<T> | Function | string | number | boolean): Schema<T[]>
    dict<T>(inner: Schema<T> | Function): Schema<Record<string, T>>
    tuple(list: readonly unknown[]): Schema
    object(dict: Record<string, Schema | Function | string | number | boolean>): Schema
    union(list: readonly unknown[]): Schema
    intersect(list: readonly Schema[]): Schema
    transform<T, U>(inner: Schema<T>, callback: (value: T) => U): Schema<U>
    from(value?: unknown): Schema
    extend(type: string, resolve: Function): void
    ValidationError: new (message: string, options?: unknown) => Error
  }

  const z: SchemaConstructor
  export default z
}

declare module '@deepseek-ai/cordis' {
  export type { Volatile } from '@deepseek-ai/schemastery'
}
