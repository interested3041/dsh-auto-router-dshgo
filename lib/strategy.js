/** Blended estimate per 1M tokens for known ids (input+output average). */
const PRICE_TABLE = {
    'deepseek-v4.1-flash-1017': 2,
    'deepseek-v4.1-flash': 2,
    'deepseek-v4-flash-0731': 2,
    'deepseek-v4-pro': 12,
    'deepseek-v4-pro-0813': 12,
    'vanchin/deepseek-v4-pro': 12,
    'vanchin/deepseek-r1': 8,
    'vanchin/deepseek-v3.2-think': 6,
    'qwen3.8-max-0902': 10,
    'qwen3.8-max': 10,
    'qwen3.8-flash': 1.5,
    'qwen-plus': 3,
    'qwen-turbo': 1,
    'qwen-flash': 0.8,
    'qwen3-vl-plus': 4,
    'qwen-vl-ocr': 2,
    'qvq-max': 8,
    'glm-5.2': 6,
    'glm-5.3': 6,
    'glm-5.3-prime': 8,
    'kimi-k3.1-pro': 9,
    'kimi-k3': 6,
    'stepfun/step-5-preview': 5,
};
/** Family-tier fallback for ids absent from the price table. */
function tierPrice(id) {
    const lower = id.toLowerCase();
    if (/flash|turbo|lite|nano/.test(lower))
        return 1.5;
    if (/plus|standard/.test(lower))
        return 4;
    if (/max|pro|prime|ultra/.test(lower))
        return 10;
    return 5;
}
/** Estimated blended price per 1M tokens (never throws). */
export function priceOf(id) {
    return PRICE_TABLE[id] ?? tierPrice(id);
}
const byQuality = (a, b) => b.quality - a.quality || priceOf(a.id) - priceOf(b.id);
/**
 * Order candidates under one strategy. Pure: never mutates the ledger.
 * `free_quota` spreads consumption by *utilization ratio* instead of draining
 * one bucket at a time: while every bucket is empty it starts from the
 * cheapest/light model, then the least-used model gets the next turn. Full
 * buckets are parked at the tail.
 */
export function orderCandidates(candidates, strategy, ledger, options = { bucketTokens: 1_000_000, bucketTolerance: 0.05 }) {
    const list = [...candidates];
    if (strategy === 'auto') {
        return { order: list.map(c => c.id), allFull: false };
    }
    if (strategy === 'capability') {
        return { order: list.sort(byQuality).map(c => c.id), allFull: false };
    }
    if (strategy === 'speed') {
        return { order: list.sort((a, b) => b.speed - a.speed || byQuality(a, b)).map(c => c.id), allFull: false };
    }
    if (strategy === 'price') {
        return { order: list.sort((a, b) => priceOf(a.id) - priceOf(b.id) || byQuality(a, b)).map(c => c.id), allFull: false };
    }
    // free_quota
    const bucketOf = (id) => ledger?.models[id]?.bucketTokens ?? 0;
    const threshold = options.bucketTokens * (1 - options.bucketTolerance);
    const notFull = list.filter(c => bucketOf(c.id) < threshold);
    if (notFull.length === 0) {
        return { order: list.sort(byQuality).map(c => c.id), allFull: true };
    }
    const byLight = (a, b) => priceOf(a.id) - priceOf(b.id) || byQuality(a, b);
    const ratio = (c) => bucketOf(c.id) / Math.max(1, options.bucketTokens);
    const allZero = notFull.every(c => bucketOf(c.id) === 0);
    const head = notFull.sort(allZero
        ? byLight
        : (a, b) => ratio(a) - ratio(b) || byLight(a, b));
    const tail = list.filter(c => bucketOf(c.id) >= threshold).sort(byQuality);
    return { order: [...head, ...tail].map(c => c.id), allFull: false };
}
