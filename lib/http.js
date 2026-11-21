/**
 * Minimal Aliyun Bailian (DashScope compatible-mode) HTTP client:
 * OpenAI-style `/chat/completions` (streaming + one-shot) and `/models`,
 * with SSE framing written locally so the bundle keeps zero runtime
 * runtime dependencies at all, and provider errors classified into the stable
 * `LlmError` failure codes the harness routes on.
 */
import { attributionHeaders, LlmError } from '@deepseek-ai/dsh-llm';
/** Bailian quota/rate-limit error code spellings seen in the wild. */
const CONTEXT_PATTERN = /context.?length|maximum context|too many tokens|range of input length/i;
const MODEL_NOT_FOUND_PATTERN = /model.?not.?(found|exist)|does not exist|invalid.?model/i;
/**
 * Classify one provider failure into a stable harness code.
 * @param status - HTTP status when the failure preceded streaming.
 * @param raw - decoded JSON error envelope (either OpenAI or Bailian shape).
 * @param fallbackMessage - message used when the body carries none.
 */
export function classifyFailure(status, raw, fallbackMessage) {
    const envelope = typeof raw === 'object' && raw !== null ? raw : {};
    const inner = typeof envelope.error === 'object' && envelope.error !== null ? envelope.error : envelope;
    const message = [inner.message, envelope.message].find((value) => typeof value === 'string' && value.length > 0) ?? fallbackMessage;
    const codeText = [inner.code, envelope.code, inner.type, envelope.type, envelope.request_id === undefined ? '' : '']
        .filter((value) => typeof value === 'string').join(' ');
    const detail = `${codeText} ${message}`.toLowerCase();
    let code;
    if (status === 401 || status === 403 || /invalidapikey|accessdenied|unauthorized|authentication|permission/.test(detail))
        code = 'AUTH';
    else if (status === 402 || /arrearage|insufficient_quota/.test(detail))
        code = 'QUOTA';
    // Bailian reports hard allocation-quota exhaustion as HTTP 400/429 with
    // Throttling.AllocationQuota ("Allocated quota exceeded"); it must classify
    // as QUOTA so the router cools the model down instead of failing the turn.
    else if (/allocationquota|allocated quota|free allocated quota/.test(detail))
        code = 'QUOTA';
    else if (status === 429 || /throttling|rate.?limit|limit_requests|requests rate limit/.test(detail))
        code = 'RATE_LIMIT';
    else if (CONTEXT_PATTERN.test(detail))
        code = 'CONTEXT_WINDOW_EXCEEDED';
    else if ((status === 404 || status === 400) && MODEL_NOT_FOUND_PATTERN.test(detail))
        code = 'UNKNOWN_MODEL';
    else if (status === 400 || status === 413 || /invalid_request|invalidparameter|datainspectionfailed/.test(detail))
        code = 'INVALID_REQUEST';
    else if (status !== undefined && status >= 500)
        code = 'SERVER';
    else if (status === undefined)
        code = 'SERVER';
    else
        code = `HTTP_${status}`;
    return { code, message };
}
/** Build one LlmError from an HTTP failure body. */
export function httpFailure(status, raw, url) {
    const { code, message } = classifyFailure(status, raw, `Bailian request failed (${status}) ${url}`);
    const envelope = typeof raw === 'object' && raw !== null ? raw : {};
    const requestId = [envelope.request_id, envelope.requestId].find((value) => typeof value === 'string');
    return new LlmError(message, code, {
        status,
        ...(requestId ? { requestId } : {}),
    });
}
/** Build one LlmError from an in-band (mid-stream) provider error event. */
export function inBandFailure(raw) {
    const { code, message } = classifyFailure(undefined, raw, 'Bailian stream reported an in-band error');
    return new LlmError(message, code);
}
/** Parse one HTTP error body tolerantly (JSON first, then text). */
export async function readErrorBody(response) {
    const text = await response.text().catch(() => '');
    try {
        return JSON.parse(text);
    }
    catch (_nonJson) {
        return text.length > 0 ? { message: text.slice(0, 2000) } : undefined;
    }
}
/**
 * Split one SSE response body into decoded `data:` JSON payloads.
 * Handles multi-line data fields, comments (heartbeats), and `[DONE]`.
 * The body is typed loosely because fetch stream generics differ between
 * DOM and undici typings; only the web-stream contract is used.
 */
export async function* parseSseData(body, activity) {
    const reader = body.pipeThrough(new TextDecoderStream()).getReader();
    let buffer = '';
    try {
        while (true) {
            const { done, value } = await reader.read();
            if (done)
                break;
            activity?.();
            buffer += value;
            let boundary = buffer.indexOf('\n\n');
            while (boundary >= 0) {
                const frame = buffer.slice(0, boundary);
                buffer = buffer.slice(boundary + 2);
                boundary = buffer.indexOf('\n\n');
                const dataLines = [];
                for (const line of frame.split(/\r?\n/)) {
                    if (line.startsWith(':')) {
                        activity?.();
                        continue;
                    }
                    if (line.startsWith('data:'))
                        dataLines.push(line.slice(5).replace(/^ /, ''));
                }
                if (dataLines.length === 0)
                    continue;
                const data = dataLines.join('\n');
                if (data === '[DONE]')
                    return;
                yield data;
            }
        }
        // Flush a trailing frame that arrived without the final blank line.
        const tail = buffer.trim();
        if (tail.startsWith('data:')) {
            const data = tail.slice(5).replace(/^ /, '');
            if (data !== '[DONE]')
                yield data;
        }
    }
    finally {
        reader.releaseLock();
    }
}
/**
 * One Bailian endpoint client. Instances are created per request generation so
 * settings changes never mix into an in-flight call.
 */
export class BailianClient {
    options;
    constructor(options) {
        this.options = options;
    }
    headers(extra) {
        return {
            ...attributionHeaders(),
            'content-type': 'application/json',
            authorization: `Bearer ${this.options.apiKey}`,
            ...extra,
        };
    }
    body(request, stream) {
        return JSON.stringify({
            model: request.model,
            messages: request.messages,
            ...(request.tools && request.tools.length > 0 ? { tools: request.tools } : {}),
            ...(request.temperature === undefined ? {} : { temperature: request.temperature }),
            ...(request.maxTokens === undefined ? {} : { max_tokens: request.maxTokens }),
            ...(request.stop && request.stop.length > 0 ? { stop: request.stop } : {}),
            ...(request.reasoningEffort === undefined || request.reasoningEffort === 'off'
                ? {}
                : { reasoning_effort: request.reasoningEffort }),
            ...(request.enableThinking === undefined ? {} : { enable_thinking: request.enableThinking }),
            ...(request.enableThinking !== true || request.thinkingBudget === undefined
                ? {}
                : { thinking_budget: request.thinkingBudget }),
            ...(stream ? { stream: true, stream_options: { include_usage: true } } : {}),
        });
    }
    /** GET /models — the pool sync source. */
    async listModels(signal) {
        const url = `${this.options.baseURL}/models`;
        const response = await fetch(url, { method: 'GET', headers: this.headers(), signal, redirect: 'error' });
        if (!response.ok)
            throw httpFailure(response.status, await readErrorBody(response), url);
        const raw = await response.json();
        if (!Array.isArray(raw?.data))
            throw new LlmError('Bailian /models returned no data array', 'MALFORMED_RESPONSE');
        return raw.data
            .map(entry => ({ id: typeof entry?.id === 'string' ? entry.id : undefined }))
            .filter((entry) => typeof entry.id === 'string' && entry.id.length > 0);
    }
    /** One-shot chat completion (decision calls). */
    async chatOnce(request, signal) {
        const url = `${this.options.baseURL}/chat/completions`;
        const response = await fetch(url, {
            method: 'POST', headers: this.headers(), body: this.body(request, false), signal, redirect: 'error',
        });
        if (!response.ok)
            throw httpFailure(response.status, await readErrorBody(response), url);
        const raw = await response.json();
        if (raw?.error)
            throw inBandFailure(raw);
        return raw;
    }
    /**
     * One image-generation request (`POST /images/generations`).
     * @param model - image model id from the account listing.
     * @param prompt - natural-language description.
     * @param signal - cancellation.
     * @returns generated image URLs/base64 payloads, in provider order.
     */
    async generateImage(model, prompt, signal) {
        const url = `${this.options.baseURL}/images/generations`;
        const response = await fetch(url, {
            method: 'POST',
            headers: this.headers(),
            body: JSON.stringify({ model, prompt, n: 1, size: '1024x1024' }),
            signal,
            redirect: 'error',
        });
        if (!response.ok)
            throw httpFailure(response.status, await readErrorBody(response), url);
        const raw = await response.json();
        if (!Array.isArray(raw?.data))
            throw new LlmError('Bailian /images/generations returned no data array', 'MALFORMED_RESPONSE');
        return raw.data.map(entry => ({
            ...(typeof entry?.url === 'string' ? { url: entry.url } : {}),
            ...(typeof entry?.b64_json === 'string' ? { b64: entry.b64_json } : {}),
        }));
    }
    /**
     * Streaming chat completion as parsed SSE events, with one idle watchdog.
     * Throws LlmError on HTTP failure, in-band error, malformed JSON, or idle
     * timeout; the caller owns translation into harness chunks.
     */
    async *streamChat(request, signal) {
        const url = `${this.options.baseURL}/chat/completions`;
        const idle = new AbortController();
        let timer;
        const pulse = () => {
            if (timer !== undefined)
                clearTimeout(timer);
            timer = setTimeout(() => idle.abort(), this.options.streamIdleTimeoutMs);
            timer.unref?.();
        };
        const combined = signal === undefined ? idle.signal : AbortSignal.any([signal, idle.signal]);
        pulse();
        let response;
        try {
            response = await fetch(url, {
                method: 'POST', headers: this.headers({ accept: 'text/event-stream' }), body: this.body(request, true),
                signal: combined, redirect: 'error',
            });
        }
        catch (error) {
            clearTimeout(timer);
            throw this.transportError(error, signal);
        }
        if (!response.ok) {
            clearTimeout(timer);
            throw httpFailure(response.status, await readErrorBody(response), url);
        }
        if (response.body === null) {
            clearTimeout(timer);
            throw new LlmError('Bailian stream returned no response body', 'EMPTY_RESPONSE');
        }
        try {
            for await (const data of parseSseData(response.body, pulse)) {
                let event;
                try {
                    event = JSON.parse(data);
                }
                catch (_invalidJson) {
                    throw new LlmError('Bailian SSE contains invalid JSON', 'MALFORMED_RESPONSE');
                }
                if (event.error)
                    throw inBandFailure(event);
                yield event;
            }
        }
        catch (error) {
            if (idle.signal.aborted && signal?.aborted !== true) {
                throw new LlmError(`Bailian stream idle timeout after ${this.options.streamIdleTimeoutMs}ms`, 'TIMEOUT', { cause: error });
            }
            throw this.transportError(error, signal);
        }
        finally {
            clearTimeout(timer);
        }
    }
    /** Normalize fetch-level failures; user cancellation stays ABORTED. */
    transportError(error, signal) {
        if (error instanceof LlmError)
            return error;
        if (signal?.aborted)
            return new LlmError('Bailian request aborted', 'ABORTED', { cause: error });
        return new LlmError(`Bailian transport failed: ${String(error?.message ?? error)}`, 'TRANSPORT', { cause: error });
    }
}
