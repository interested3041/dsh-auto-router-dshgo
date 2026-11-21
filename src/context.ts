/**
 * Minimal structural view of the Cordis host context and the DSH services
 * this plugin touches. Declared locally so the plugin type-checks against the
 * exact surface it uses, independent of private runtime package versions.
 */

/** Credential seam (`ctx.get('credentials')`). */
export interface CredentialsLike {
  resolve(ref: string): Promise<{ value: string } | undefined>
  describe(ref: string): Promise<{ configured: boolean }>
}

/** Attachment seam (`ctx.get('attachments')`), image request projection only. */
export interface AttachmentsLike {
  readImageRequest(
    ref: { attachmentId: string; width: number; height: number; bytes: number },
    target: { width: number; height: number; maxBytes: number },
    signal?: AbortSignal,
  ): Promise<{ data: Uint8Array; mediaType: string; width: number; height: number; bytes: number }>
}

/** Config editor seam (`ctx.get('configEditor')`). */
export interface ConfigEditorLike {
  configuration(): Array<{
    entry: unknown
    inherited: Record<string, unknown>
    override: Record<string, unknown>
  }>
  edit(
    entry: unknown,
    change: (current: Record<string, unknown>, inherited: Record<string, unknown>) => Record<string, unknown>,
  ): Promise<void>
}

/** The `llm` service surface used here. */
export interface LlmServiceLike {
  registerAdapter(providers: string[], adapter: unknown): (() => void) & { replace(providers: string[]): void }
  fileRequestText(ref: unknown): string
}

export interface LoggerLike {
  debug(...args: unknown[]): void
  info(...args: unknown[]): void
  warn(...args: unknown[]): void
  error(...args: unknown[]): void
}

/** Typert registry seam (optional; the loader normally registers `./typert`). */
export interface TypertRegistryLike {
  getPackage(packageName: string, face: string): unknown
  register(manifest: unknown): unknown
}

/** Structural Cordis context used by this plugin. */
export interface HostContext {
  readonly logger: LoggerLike
  readonly llm: LlmServiceLike
  readonly fiber: {
    entry?: { options?: { id?: string; name?: string } } | undefined
    uid?: number | null
  }
  effect(setup: () => unknown, label?: string): void
  on(event: string, listener: (...args: never[]) => unknown): () => void
  get(service: 'credentials'): CredentialsLike | undefined
  get(service: 'attachments'): AttachmentsLike | undefined
  get(service: 'configEditor'): ConfigEditorLike | undefined
  get(service: 'typert'): TypertRegistryLike | undefined
  get(service: string): unknown
  provide(name: string, value: unknown): unknown
  inject(deps: readonly string[], setup: (ctx: HostContext) => unknown): unknown
}
