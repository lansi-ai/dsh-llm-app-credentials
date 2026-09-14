/**
 * Server-sent-event framing for one upstream response body.
 *
 * Uses `eventsource-parser` (the same library the reference adapter uses) and
 * adds the two things a long-lived model stream needs: an idle timeout so a dead
 * connection cannot hang a turn forever, and prompt cancellation on the caller's
 * signal so an aborted turn stops reading immediately.
 *
 * @module dsh-llm-app-credentials/sse
 */
import type { WireChunk } from './types.js';
/** Reading options for one upstream stream. */
export interface SseReadOptions {
    /** Caller cancellation; aborts the read and rejects with the signal's reason. */
    signal?: AbortSignal;
    /** Reject when no bytes arrive for this long (guards against a hung connection). */
    idleTimeoutMs: number;
}
/**
 * Yield one parsed JSON payload per SSE event until `[DONE]`.
 *
 * Non-JSON payloads (heartbeats, comments) are skipped silently: they carry no
 * model content and rejecting on them would break otherwise-healthy streams.
 *
 * A body that ends **without** `[DONE]` is a truncated response, not a short
 * one: the upstream never declared the turn complete, so reporting a normal
 * finish would commit a half-written assistant message to the session log.
 * This framing layer is where that distinction is still visible, so it decides.
 *
 * @param body - the upstream response body stream.
 * @param options - cancellation and idle-timeout bounds.
 * @yields each JSON-decoded event payload as a wire chunk.
 * @throws {LlmError} `TRANSPORT` when the stream stalls past `idleTimeoutMs`,
 *   `STREAM_CLOSED` when the body ends without the `[DONE]` sentinel.
 */
export declare function readSse(body: ReadableStream<Uint8Array>, options: SseReadOptions): AsyncGenerator<WireChunk>;
