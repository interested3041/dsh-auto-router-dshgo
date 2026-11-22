/**
 * dsh-auto-router — vendor-neutral decision-model router.
 *
 * Registers the virtual model "智能路由 Auto Router" with the harness LLM
 * service. Every request to it is first analyzed by the configurable decision
 * model, then routed to the best available execution model (any vendor) with
 * quota-aware cooldowns and a silent fallback chain that never interrupts a
 * conversation before visible output.
 */
import { existsSync, renameSync } from 'node:fs'
import { join } from 'node:path'
import { BailianAutoAdapter } from './adapter.js'
import { PROVIDER } from './catalog.js'
import { Config, resolveOptions } from './config.js'
import { invalidateConnectionCache } from './connection.js'
import type { HostContext } from './context.js'
import { dshHomePath } from './home.js'
import { provideRemoteService } from './remote.js'
import { hydrateConfig, loadPrefs } from './prefs.js'
import { Router } from './router.js'
import { createService } from './service.js'
import { RouterStore } from './store.js'

export { Config } from './config.js'
export type { ConfigModel, RouterOptions } from './config.js'
export type { RouterStateView, ConfigPatch, BailianRouterService } from './service.js'
export { REMOTE_ENDPOINTS } from './remote.js'

/** Plugin row name used by the loader (vendor-neutral since 0.7.1). */
export const name = 'auto-router'
/** The LLM service is mandatory; everything else is resolved optionally. */
export const inject = ['llm']

const PACKAGE = 'dsh-auto-router-dshgo'
const LOG = `[${PACKAGE}]`
/** Delay of the first background pool sync after activation. */
const INITIAL_SYNC_DELAY_MS = 5_000

/** Plugin activation: register adapter, RPC service, and pool-sync timers. */
export function apply(ctx: HostContext, config: Config): void {
  // One-time migration of the legacy state directory (pre-0.7.1 name). If the
  // legacy dir is still held open by another running host, keep using it.
  const stateHome = dshHomePath('auto-router')
  const legacyHome = dshHomePath('bailian-auto-router')
  try {
    if (!existsSync(stateHome) && existsSync(legacyHome)) renameSync(legacyHome, stateHome)
  } catch { /* legacy dir in use; fall back below */ }
  const stateDir = existsSync(stateHome) ? stateHome : legacyHome

  // 0.8.0: volatile config never survives a host restart; re-hydrate the
  // plugin-owned prefs.json so panel choices (sort/account/renames/limits)
  // persist. Invalid prefs are rolled back rather than breaking activation.
  const prefsFile = join(stateDir, 'prefs.json')
  const rollback = hydrateConfig(config as unknown as Record<string, any>, loadPrefs(prefsFile))
  try {
    // Fail loud on an unusable configuration at load time.
    resolveOptions(config)
  } catch (error) {
    rollback()
    resolveOptions(config)
    ctx.logger.warn(`${LOG} prefs.json 校验失败,已回退忽略:${String((error as Error)?.message ?? error)}`)
  }
  const store = RouterStore.create(join(stateDir, 'state.json'))
  const router = new Router(ctx, config, store)
  const adapter = new BailianAutoAdapter(router)

  ctx.effect(() => ctx.llm.registerAdapter([PROVIDER], adapter), `${PACKAGE}: llm adapter`)
  ctx.effect(() => () => { void store.dispose() }, `${PACKAGE}: state store`)

  // RPC surface for the Web panel. The binding marks this Service in source
  // (typertRemote + prototype markers) so the Gateway resolves it without a
  // generated `./typert` artifact.
  provideRemoteService(ctx, createService(ctx, router, store, prefsFile))


  // First-install pool bootstrap and periodic refresh (local state only; no
  // quota polling of the Bailian API beyond the /models listing).
  const shouldSync = (): boolean => {
    try {
      const options = resolveOptions(config)
      return options.autoSyncPool
    } catch (_badConfig) {
      return false
    }
  }
  const syncOnce = (manual: boolean): void => {
    if (!shouldSync()) return
    void router.syncPool(manual).then((result) => {
      if (!result.ok && manual) ctx.logger.warn(`${LOG} pool sync failed: ${result.message}`)
    }).catch((error: unknown) => {
      ctx.logger.warn(`${LOG} pool sync failed: ${String((error as Error)?.message ?? error)}`)
    })
  }
  const initialTimer = setTimeout(() => syncOnce(false), INITIAL_SYNC_DELAY_MS)
  initialTimer.unref?.()
  ctx.effect(() => () => clearTimeout(initialTimer), `${PACKAGE}: initial pool sync`)

  const hourly = setInterval(() => {
    try {
      const options = resolveOptions(config)
      if (!options.autoSyncPool || options.poolSyncIntervalHours <= 0) return
      const age = Date.now() - (store.state.lastSyncAt ?? 0)
      if (age >= options.poolSyncIntervalHours * 3_600_000) syncOnce(false)
    } catch (_badConfig) { /* keep the timer alive */ }
  }, 3_600_000)
  hourly.unref?.()
  ctx.effect(() => () => clearInterval(hourly), `${PACKAGE}: periodic pool sync`)

  // A profile edit may introduce or change the Aliyun connection we adopt.
  try {
    ctx.on?.('settings/document-updated', () => invalidateConnectionCache())
  } catch (_unsupportedEvent) {
    // Not every profile exposes that event; discovery simply re-reads on TTL.
  }
  ctx.logger.info(`${LOG} registered virtual model "${PROVIDER}" (智能路由 Auto Router)`)
}

