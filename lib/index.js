/**
 * dsh-bailian-auto-router — decision-model router for Aliyun Bailian.
 *
 * Registers the virtual model `bailian-auto` ("百炼智能路由") with the harness
 * LLM service. Every request to it is first analyzed by the configurable
 * decision model (default `deepseek-v4.1-flash`), then routed to the best
 * available Bailian execution model with quota-aware cooldowns and a silent
 * fallback chain that never interrupts a conversation before visible output.
 */
import { join } from 'node:path';
import { BailianAutoAdapter } from './adapter.js';
import { PROVIDER } from './catalog.js';
import { Config, resolveOptions } from './config.js';
import { invalidateConnectionCache } from './connection.js';
import { dshHomePath } from './home.js';
import { provideRemoteService } from './remote.js';
import { Router } from './router.js';
import { createService } from './service.js';
import { RouterStore } from './store.js';
export { Config } from './config.js';
export { REMOTE_ENDPOINTS } from './remote.js';
/** Plugin row name used by the loader. */
export const name = 'bailian-auto-router';
/** The LLM service is mandatory; everything else is resolved optionally. */
export const inject = ['llm'];
const PACKAGE = 'dsh-bailian-auto-router';
const LOG = `[${PACKAGE}]`;
/** Delay of the first background pool sync after activation. */
const INITIAL_SYNC_DELAY_MS = 5_000;
/** Plugin activation: register adapter, RPC service, and pool-sync timers. */
export function apply(ctx, config) {
    // Fail loud on an unusable configuration at load time.
    resolveOptions(config);
    const store = RouterStore.create(join(dshHomePath('bailian-auto-router'), 'state.json'));
    const router = new Router(ctx, config, store);
    const adapter = new BailianAutoAdapter(router);
    ctx.effect(() => ctx.llm.registerAdapter([PROVIDER], adapter), `${PACKAGE}: llm adapter`);
    ctx.effect(() => () => { void store.dispose(); }, `${PACKAGE}: state store`);
    // RPC surface for the Web panel. The binding marks this Service in source
    // (typertRemote + prototype markers) so the Gateway resolves it without a
    // generated `./typert` artifact.
    provideRemoteService(ctx, createService(ctx, router, store));
    // First-install pool bootstrap and periodic refresh (local state only; no
    // quota polling of the Bailian API beyond the /models listing).
    const shouldSync = () => {
        try {
            const options = resolveOptions(config);
            return options.autoSyncPool;
        }
        catch (_badConfig) {
            return false;
        }
    };
    const syncOnce = (manual) => {
        if (!shouldSync())
            return;
        void router.syncPool(manual).then((result) => {
            if (!result.ok && manual)
                ctx.logger.warn(`${LOG} pool sync failed: ${result.message}`);
        }).catch((error) => {
            ctx.logger.warn(`${LOG} pool sync failed: ${String(error?.message ?? error)}`);
        });
    };
    const initialTimer = setTimeout(() => syncOnce(false), INITIAL_SYNC_DELAY_MS);
    initialTimer.unref?.();
    ctx.effect(() => () => clearTimeout(initialTimer), `${PACKAGE}: initial pool sync`);
    const hourly = setInterval(() => {
        try {
            const options = resolveOptions(config);
            if (!options.autoSyncPool || options.poolSyncIntervalHours <= 0)
                return;
            const age = Date.now() - (store.state.lastSyncAt ?? 0);
            if (age >= options.poolSyncIntervalHours * 3_600_000)
                syncOnce(false);
        }
        catch (_badConfig) { /* keep the timer alive */ }
    }, 3_600_000);
    hourly.unref?.();
    ctx.effect(() => () => clearInterval(hourly), `${PACKAGE}: periodic pool sync`);
    // A profile edit may introduce or change the Aliyun connection we adopt.
    try {
        ctx.on?.('settings/document-updated', () => invalidateConnectionCache());
    }
    catch (_unsupportedEvent) {
        // Not every profile exposes that event; discovery simply re-reads on TTL.
    }
    ctx.logger.info(`${LOG} registered virtual model "${PROVIDER}" (百炼智能路由)`);
}
