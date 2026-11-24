/**
 * Host-face Remote binding for the Web panel.
 *
 * DSH's Typert Gateway accepts two definitions of a Remote method: a generated
 * `./typert` artifact, or a live Cordis Service marked in source ("SRC"). The
 * source route needs only what this module adds:
 *
 * - a `typertRemote` binding on the service instance, and
 * - a method-marker record on its class prototype.
 *
 * The Gateway then derives each endpoint's wire parameters from the method's
 * own parameter list, so those parameter names are the contract the Client
 * contribution must repeat. No generated artifact is required, which is why
 * this plugin keeps zero third-party runtime imports.
 */
import type { HostContext } from './context.js'
import type { BailianRouterService, ConfigPatch } from './service.js'
import type { SavedAccount } from './config.js'

/** Cordis service key the panel reaches as `remote.<namespace>`. */
const SERVICE_KEY = 'bailianRouter'
/** Wire namespace the Client contribution mounts. */
const NAMESPACE = 'bailianRouter'
/** Prototype key read by `remoteMethods()` from @deepseek-ai/dsh-typert-protocol. */
const MARKER_KEY = '@deepseek-ai/dsh-typert-protocol/remote-methods'

/**
 * Endpoint names in declaration order. Each entry must also exist as a public
 * prototype method below, because the Gateway resolves the marker to the
 * prototype function and reads its parameter names.
 */
const REMOTE_METHODS = [
  'getState',
  'updateConfig',
  'refreshPool',
  'switchConnection',
  'upsertAccount',
  'removeAccount',
  'activateAccount',
  'resetQuota',
  'resetModelTotals',
  'selfCheck',
  'clearHistory',
  'pinUserModel',
  'checkUpdate',
  'applyUpdate',
] as const

/**
 * Build the class the Gateway calls.
 *
 * The implementation is captured in the closure rather than read from `this`:
 * a call runs on a Context-bound Service view, and the methods must not depend
 * on that view forwarding instance fields. Every parameter is a plain
 * identifier because the Gateway parses the emitted function source.
 * @param impl - runtime service created by `createService`.
 * @returns a class whose prototype carries the callable methods.
 */
function remoteClass(impl: BailianRouterService) {
  return class BailianRouterRemote {
    getState() { return impl.getState() }
    updateConfig(patch: ConfigPatch) { return impl.updateConfig(patch) }
    refreshPool() { return impl.refreshPool() }
    switchConnection(entryId: string, providerId: string) { return impl.switchConnection(entryId, providerId) }
    upsertAccount(account: SavedAccount) { return impl.upsertAccount(account) }
    removeAccount(id: string) { return impl.removeAccount(id) }
    activateAccount(id: string) { return impl.activateAccount(id) }
    resetQuota(model?: string) { return impl.resetQuota(model) }
    resetModelTotals(model?: string) { return impl.resetModelTotals(model) }
    selfCheck() { return impl.selfCheck() }
    clearHistory() { return impl.clearHistory() }
    pinUserModel(model: string) { return impl.pinUserModel(model) }
    checkUpdate() { return impl.checkUpdate() }
    applyUpdate(tag: string) { return impl.applyUpdate(tag) }
  }
}

/** Attach the frozen marker record the Gateway reads from the prototype. */
function markRemoteMethods(prototype: object): void {
  Object.defineProperty(prototype, MARKER_KEY, {
    configurable: true,
    value: Object.freeze({
      version: 1,
      methods: Object.freeze(REMOTE_METHODS.map((method) => Object.freeze({
        method,
        invocation: Object.freeze({ kind: 'direct' as const }),
      }))),
    }),
  })
}

/**
 * Register `ctx.invocation` as an undefined accessor, matching what the
 * protocol's own binding helper does. The Gateway extends a call Context with
 * `invocation`, so the declaration must exist before the first call.
 * @param ctx - plugin context owning the service.
 */
function declareInvocationAccessor(ctx: HostContext): void {
  try {
    const root = (ctx as unknown as {
      root?: {
        reflect?: { props?: Record<string, unknown> }
        accessor?: (name: string, options: { get: () => undefined }) => unknown
      }
    }).root
    if (root?.accessor === undefined || root.reflect?.props === undefined) return
    if (Object.hasOwn(root.reflect.props, 'invocation')) return
    root.accessor('invocation', { get: () => undefined })
  } catch (_alreadyDeclared) {
    // Another service in this tree already declared it; that declaration wins.
  }
}

/**
 * Expose the router service to the Web panel as `remote.bailianRouter`.
 * @param ctx - plugin context that owns the service registration.
 * @param impl - runtime service created by `createService`.
 */
export function provideRemoteService(ctx: HostContext, impl: BailianRouterService): void {
  const Remote = remoteClass(impl)
  markRemoteMethods(Remote.prototype)
  const instance = new Remote()
  Object.defineProperty(instance, 'typertRemote', {
    value: Object.freeze({ service: instance, serviceKey: SERVICE_KEY, namespace: NAMESPACE }),
  })
  declareInvocationAccessor(ctx)
  ctx.provide(SERVICE_KEY, instance)
}

/** Endpoint names the Client contribution must declare, for tests and docs. */
export const REMOTE_ENDPOINTS: readonly string[] = REMOTE_METHODS.map((method) => `${NAMESPACE}/${method}`)