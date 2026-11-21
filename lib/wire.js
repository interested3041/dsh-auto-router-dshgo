/**
 * Wire translation between the harness vocabulary and the Bailian
 * (OpenAI-compatible) chat-completions protocol:
 *
 * - `serializeMessages()` projects harness `RequestMessage[]` into wire
 *   messages: images become base64 data URLs for vision execution models and
 *   deterministic placeholders otherwise, file blocks become their harness
 *   handle text, reasoning history is dropped, tool declarations are sent in
 *   full on every request (the documented fallback for routes without
 *   tool-update support).
 * - `translateStream()` converts provider SSE events into harness
 *   `StreamChunk` values obeying the protocol: block-start → deltas →
 *   block-end, usage before the terminal finish.
 */
import { LlmError } from '@deepseek-ai/dsh-llm';
const DEFAULT_IMAGE_MAX_BYTES = 4 * 1024 * 1024;
function textOf(blocks) {
    return blocks.filter((block) => block.type === 'text')
        .map(block => block.text).join('');
}
function imagePlaceholder(ref, reason) {
    return `[image attachment ${ref.attachmentId} omitted: ${reason}]`;
}
/**
 * Project harness messages into wire messages for one execution model.
 * @param messages - request messages exactly as the harness assembled them.
 * @param options - vision capability and attachment access of this attempt.
 */
export async function serializeMessages(messages, options) {
    const wire = [];
    const imageCache = new Map();
    const readImage = async (ref) => {
        if (options.readImage === undefined)
            return undefined;
        const cached = imageCache.get(ref.attachmentId);
        if (cached !== undefined)
            return cached;
        const version = await options.readImage.read(ref, options.signal);
        imageCache.set(ref.attachmentId, version);
        return version;
    };
    for (const message of messages) {
        const blocks = message.content ?? [];
        switch (message.role) {
            case 'system': {
                const text = textOf(blocks);
                if (text.length > 0)
                    wire.push({ role: 'system', content: text });
                continue;
            }
            case 'developer': {
                // Tool additions/removals: this route always sends the complete
                // current tool list, so incremental update messages are skipped.
                continue;
            }
            case 'user': {
                const parts = [];
                let hasNonText = false;
                for (const block of blocks) {
                    if (block.type === 'text') {
                        parts.push({ type: 'text', text: block.text });
                    }
                    else if (block.type === 'image') {
                        hasNonText = true;
                        const ref = block.attachment;
                        if (block.offloaded === true || !options.vision) {
                            parts.push({
                                type: 'text',
                                text: imagePlaceholder(ref, block.offloaded === true ? 'offloaded from context' : 'the execution model does not accept image input'),
                            });
                            continue;
                        }
                        const version = await readImage(ref);
                        if (version === undefined) {
                            parts.push({ type: 'text', text: imagePlaceholder(ref, 'attachment service unavailable') });
                            continue;
                        }
                        const base64 = Buffer.from(version.data).toString('base64');
                        parts.push({ type: 'image_url', image_url: { url: `data:${version.mediaType};base64,${base64}` } });
                    }
                    else if (block.type === 'file') {
                        const handle = options.fileText?.(block.attachment)
                            ?? `[file attachment ${block.attachment.attachmentId}]`;
                        parts.push({ type: 'text', text: handle });
                    }
                    // tool-addition / tool-removal blocks never appear in user content.
                }
                if (parts.length === 0)
                    continue;
                if (!hasNonText && parts.every(part => part.type === 'text')) {
                    wire.push({ role: 'user', content: parts.map(part => part.text).join('') });
                }
                else {
                    wire.push({ role: 'user', content: parts });
                }
                continue;
            }
            case 'assistant': {
                const text = textOf(blocks);
                const toolCalls = blocks
                    .filter((block) => block.type === 'tool-call')
                    .map(block => ({ id: block.id, type: 'function', function: { name: block.name, arguments: block.arguments } }));
                // Reasoning history is dropped: OpenAI-compatible endpoints do not
                // accept reasoning_content replay, and content stays provider-neutral.
                if (toolCalls.length === 0 && text.length === 0) {
                    wire.push({ role: 'assistant', content: '' });
                }
                else {
                    wire.push({
                        role: 'assistant',
                        content: text.length > 0 ? text : null,
                        ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
                    });
                }
                continue;
            }
            case 'tool': {
                // Tool results are text-only on this wire; images inside results keep
                // a deterministic placeholder so no bytes are silently dropped.
                const parts = [];
                for (const block of blocks) {
                    if (block.type === 'text')
                        parts.push(block.text);
                    else if (block.type === 'image')
                        parts.push(imagePlaceholder(block.attachment, 'images are not supported inside tool results on this route'));
                    else if (block.type === 'file')
                        parts.push(options.fileText?.(block.attachment) ?? `[file attachment ${block.attachment.attachmentId}]`);
                }
                wire.push({ role: 'tool', tool_call_id: message.toolCallId, content: parts.join('') });
                continue;
            }
            default: continue;
        }
    }
    return wire;
}
/** Map harness tool schemas onto OpenAI function tools. */
export function serializeTools(tools) {
    if (tools === undefined || tools.length === 0)
        return undefined;
    return tools.map(tool => ({
        type: 'function',
        function: {
            name: tool.name,
            ...(tool.description === undefined ? {} : { description: tool.description }),
            parameters: tool.parameters,
        },
    }));
}
/**
 * Translate one provider SSE stream into harness StreamChunks.
 *
 * Guarantees the protocol order: every opened block is closed with
 * `block-end` before the `usage` chunk (when present) and the terminal
 * `finish`. Provider failures surface as thrown `LlmError`s before any
 * finish chunk; the runtime normalizes them.
 *
 * @param events - parsed SSE events of one attempt.
 * @yields harness stream chunks.
 */
export async function* translateStream(events) {
    const blocks = new Map();
    let nextIndex = 0;
    let textIndex;
    let reasoningIndex;
    const toolIndexes = new Map();
    let finishReason;
    let usage;
    const open = (type) => {
        const index = nextIndex++;
        blocks.set(index, { index, type, text: '' });
        return index;
    };
    for await (const event of events) {
        const choice = event.choices?.[0];
        const delta = choice?.delta;
        if (delta !== undefined && delta !== null) {
            const reasoning = typeof delta.reasoning_content === 'string' ? delta.reasoning_content : '';
            if (reasoning.length > 0) {
                if (reasoningIndex === undefined) {
                    reasoningIndex = open('reasoning');
                    yield { type: 'block-start', index: reasoningIndex, blockType: 'reasoning' };
                }
                const block = blocks.get(reasoningIndex);
                block.text += reasoning;
                yield { type: 'reasoning-delta', index: reasoningIndex, text: reasoning };
            }
            const content = typeof delta.content === 'string' ? delta.content : '';
            if (content.length > 0) {
                if (textIndex === undefined) {
                    textIndex = open('text');
                    yield { type: 'block-start', index: textIndex, blockType: 'text' };
                }
                const block = blocks.get(textIndex);
                block.text += content;
                yield { type: 'text-delta', index: textIndex, text: content };
            }
            for (const item of delta.tool_calls ?? []) {
                const slot = typeof item.index === 'number' ? item.index : (item.id !== undefined ? nextIndex : 0);
                let index = toolIndexes.get(slot);
                if (index === undefined) {
                    index = open('tool-call');
                    toolIndexes.set(slot, index);
                    yield { type: 'block-start', index, blockType: 'tool-call' };
                }
                const block = blocks.get(index);
                if (item.id !== undefined && block.toolCallId === undefined)
                    block.toolCallId = item.id;
                if (item.function?.name !== undefined && block.toolCallName === undefined)
                    block.toolCallName = item.function.name;
                const piece = typeof item.function?.arguments === 'string' ? item.function.arguments : '';
                if (piece.length > 0 || item.id !== undefined || item.function?.name !== undefined) {
                    block.text += piece;
                    yield {
                        type: 'tool-call-delta',
                        index,
                        id: block.toolCallId ?? `call_${index}`,
                        ...(block.toolCallName !== undefined ? { name: block.toolCallName } : {}),
                        argumentsDelta: piece,
                    };
                }
            }
        }
        const reason = choice?.finish_reason;
        if (typeof reason === 'string' && reason.length > 0 && finishReason === undefined) {
            finishReason = reason === 'tool_calls' ? 'tool-calls' : reason === 'length' ? 'max-tokens' : 'stop';
        }
        if (event.usage !== undefined && event.usage !== null) {
            const raw = event.usage;
            const cached = raw.prompt_tokens_details?.cached_tokens ?? 0;
            const prompt = raw.prompt_tokens ?? 0;
            usage = {
                inputTokens: Math.max(0, prompt - cached),
                outputTokens: raw.completion_tokens ?? 0,
                ...(raw.total_tokens !== undefined ? { totalTokens: raw.total_tokens } : {}),
                ...(cached > 0 ? { cacheReadTokens: cached } : {}),
                ...(raw.completion_tokens_details?.reasoning_tokens !== undefined
                    ? { reasoningTokens: raw.completion_tokens_details.reasoning_tokens } : {}),
            };
        }
    }
    // Close every opened block with its assembled value.
    for (const block of [...blocks.values()].sort((a, b) => a.index - b.index)) {
        if (block.type === 'text') {
            yield { type: 'block-end', index: block.index, block: { type: 'text', text: block.text } };
        }
        else if (block.type === 'reasoning') {
            yield { type: 'block-end', index: block.index, block: { type: 'reasoning', text: block.text } };
        }
        else {
            const args = block.text.length > 0 ? block.text : '{}';
            try {
                JSON.parse(args);
            }
            catch (_invalidArgs) {
                throw new LlmError(`Bailian tool call "${block.toolCallName ?? block.index}" produced malformed JSON arguments`, 'MALFORMED_RESPONSE');
            }
            yield {
                type: 'block-end',
                index: block.index,
                block: {
                    type: 'tool-call',
                    id: block.toolCallId ?? `call_${block.index}`,
                    name: block.toolCallName ?? '',
                    arguments: args,
                },
            };
        }
    }
    if (usage !== undefined)
        yield { type: 'usage', usage };
    yield { type: 'finish', reason: { kind: finishReason ?? 'stop' } };
}
/** Convenience wrapper: one streaming attempt as harness chunks. */
export function streamAttempt(client, request, signal) {
    return translateStream(client.streamChat(request, signal));
}
