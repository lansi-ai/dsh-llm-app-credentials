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
import { type StreamChunk } from '@deepseek-ai/dsh-llm';
import type { WireChunk } from './types.js';
/**
 * Consume wire chunks and yield harness stream chunks.
 *
 * @param chunks - parsed SSE payloads for one response.
 * @yields block starts and deltas as they arrive; block ends, usage, and the
 *   terminal finish are all deferred to the end of the payload stream.
 * @throws {LlmError} when the upstream reports an in-band error.
 */
export declare function translate(chunks: AsyncIterable<WireChunk>): AsyncGenerator<StreamChunk>;
