/**
 * Translation of upstream SSE payloads into harness `StreamChunk`s.
 *
 * The emission order is the contract, not a detail: `block-end` carries the
 * assembled block, `usage` must be emitted before the terminal `finish`, and
 * nothing may follow that finish. Identity handling for tool calls is the other
 * trap — see {@link acceptIdentity}.
 *
 * @module dsh-llm-app-credentials/translate
 */
import { EMPTY_RESPONSE_CODE, LlmError, ToolCallId, } from '@deepseek-ai/dsh-llm';
/**
 * Consume wire chunks and yield harness stream chunks.
 *
 * @param chunks - parsed SSE payloads for one response.
 * @yields block starts and deltas as they arrive; block ends, usage, and the
 *   terminal finish are all deferred to the end of the payload stream.
 * @throws {LlmError} when the upstream reports an in-band error.
 */
export async function* translate(chunks) {
    let nextIndex = 0;
    const order = [];
    let textBlock;
    let reasoningBlock;
    const toolBlocks = new Map();
    let pendingFinish;
    let pendingUsage;
    const open = (kind) => {
        const block = { index: nextIndex, kind, text: '' };
        nextIndex += 1;
        order.push(block);
        return block;
    };
    for await (const chunk of chunks) {
        if (chunk.error !== undefined)
            throw inBandError(chunk);
        for (const choice of chunk.choices ?? []) {
            const delta = choice.delta;
            const reasoning = delta?.reasoning_content;
            if (typeof reasoning === 'string' && reasoning.length > 0) {
                if (reasoningBlock === undefined) {
                    reasoningBlock = open('reasoning');
                    yield { type: 'block-start', index: reasoningBlock.index, blockType: 'reasoning' };
                }
                reasoningBlock.text += reasoning;
                yield { type: 'reasoning-delta', index: reasoningBlock.index, text: reasoning };
            }
            const content = delta?.content;
            if (typeof content === 'string' && content.length > 0) {
                if (textBlock === undefined) {
                    textBlock = open('text');
                    yield { type: 'block-start', index: textBlock.index, blockType: 'text' };
                }
                textBlock.text += content;
                yield { type: 'text-delta', index: textBlock.index, text: content };
            }
            for (const call of delta?.tool_calls ?? []) {
                const key = call.index ?? 0;
                let block = toolBlocks.get(key);
                if (block === undefined) {
                    block = open('tool-call');
                    toolBlocks.set(key, block);
                    yield { type: 'block-start', index: block.index, blockType: 'tool-call' };
                }
                block.callId = acceptIdentity(block.callId, call.id);
                block.name = acceptIdentity(block.name, call.function?.name);
                const fragment = call.function?.arguments ?? '';
                block.text += fragment;
                yield {
                    type: 'tool-call-delta',
                    index: block.index,
                    id: ToolCallId(block.callId ?? ''),
                    ...(block.name !== undefined ? { name: block.name } : {}),
                    argumentsDelta: fragment,
                };
            }
            if (typeof choice.finish_reason === 'string')
                pendingFinish = mapFinishReason(choice.finish_reason);
        }
        if (chunk.usage !== undefined && chunk.usage !== null)
            pendingUsage = mapUsage(chunk.usage);
    }
    for (const block of order) {
        yield { type: 'block-end', index: block.index, block: closeBlock(block) };
    }
    if (pendingUsage !== undefined)
        yield { type: 'usage', usage: pendingUsage };
    const reason = pendingFinish ?? { kind: 'stop' };
    // A normally-stopped response with no blocks is a degenerate completion: an
    // empty assistant message would silently end the turn, so it is reported as
    // an EMPTY_RESPONSE error finish. Retry policy treats it as safe to repeat.
    yield {
        type: 'finish',
        reason: reason.kind === 'stop' && order.length === 0
            ? {
                kind: 'error',
                failure: { message: 'model returned a completed response with no content', code: EMPTY_RESPONSE_CODE },
            }
            : reason,
    };
}
/**
 * Accept one streamed identity field for a tool call.
 *
 * `id` and `name` are identity, not accumulation: the wire sends each once, on
 * the call's first delta. A continuation delta that re-sends the field empty —
 * or `null`, which some OpenAI-compatible gateways fill in — means "no update",
 * never "clear". Overwriting here would break every tool call.
 *
 * @param current - identity established by an earlier delta of this call.
 * @param incoming - the field as parsed from this delta.
 * @returns the identity in force after this delta.
 */
function acceptIdentity(current, incoming) {
    return typeof incoming === 'string' && incoming.length > 0 ? incoming : current;
}
/** Assemble the final content block for one open block. */
function closeBlock(block) {
    if (block.kind === 'text')
        return { type: 'text', text: block.text };
    if (block.kind === 'reasoning')
        return { type: 'reasoning', text: block.text };
    return { type: 'tool-call', id: ToolCallId(block.callId ?? ''), name: block.name ?? '', arguments: block.text };
}
/** Map an upstream finish reason; an unknown one becomes an error finish. */
function mapFinishReason(reason) {
    switch (reason) {
        case 'stop':
            return { kind: 'stop' };
        case 'tool_calls':
            return { kind: 'tool-calls' };
        case 'length':
            return { kind: 'max-tokens' };
        default:
            return { kind: 'error', failure: { message: `model stopped: ${reason}`, code: reason.toUpperCase() } };
    }
}
/**
 * Map wire usage onto the harness's DISJOINT counts.
 *
 * These upstreams report `prompt_tokens` as the aggregate prompt count, i.e.
 * cache hits included, while the harness bills uncached input separately — so
 * the cache read is subtracted out of `inputTokens`. `cacheWriteTokens` is only
 * declared when the upstream reports a positive write count, because a stored
 * `0` would surface an empty row in session statistics.
 *
 * @param usage - usage as the upstream reported it.
 * @returns disjoint counts; `totalTokens` only when the counters are valid and agree.
 */
function mapUsage(usage) {
    const cacheRead = usage.prompt_cache_hit_tokens;
    const prompt = usage.prompt_tokens;
    const completion = usage.completion_tokens;
    const reasoning = usage.completion_tokens_details?.reasoning_tokens;
    const cacheWrite = usage.prompt_cache_write_tokens;
    const inputTokens = (typeof prompt === 'number' ? prompt : 0) - (typeof cacheRead === 'number' ? cacheRead : 0);
    const outputTokens = typeof completion === 'number' ? completion : 0;
    const combined = (typeof prompt === 'number' ? prompt : 0) + outputTokens;
    const hasExactTotal = Number.isSafeInteger(prompt) &&
        prompt >= 0 &&
        Number.isSafeInteger(completion) &&
        completion >= 0 &&
        Number.isSafeInteger(combined) &&
        (usage.total_tokens === undefined || usage.total_tokens === combined);
    return {
        inputTokens,
        outputTokens,
        ...(hasExactTotal ? { totalTokens: combined } : {}),
        ...(typeof cacheRead === 'number' ? { cacheReadTokens: cacheRead } : {}),
        ...(typeof cacheWrite === 'number' && cacheWrite > 0 ? { cacheWriteTokens: cacheWrite } : {}),
        ...(typeof reasoning === 'number' ? { reasoningTokens: reasoning } : {}),
    };
}
/** Turn an in-band error payload into a typed failure. */
function inBandError(chunk) {
    const error = chunk.error;
    const message = error?.message ?? 'the upstream reported an error inside the stream';
    const code = error?.code;
    return new LlmError(String(message), typeof code === 'string' && code.length > 0 ? code : 'STREAM_ERROR');
}
