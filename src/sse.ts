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

import { createParser } from 'eventsource-parser'
import { LlmError } from '@deepseek-ai/dsh-llm'
import type { WireChunk } from './types.js'

/** Reading options for one upstream stream. */
export interface SseReadOptions {
  /** Caller cancellation; aborts the read and rejects with the signal's reason. */
  signal?: AbortSignal
  /** Reject when no bytes arrive for this long (guards against a hung connection). */
  idleTimeoutMs: number
}

/**
 * One `read()` result, derived from the reader itself.
 *
 * The result type is not part of the ES library, so naming it directly would
 * tie this file to whichever ambient declaration set happens to be loaded.
 */
type ReadResult = Awaited<ReturnType<ReadableStreamDefaultReader<Uint8Array>['read']>>

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
export async function* readSse(body: ReadableStream<Uint8Array>, options: SseReadOptions): AsyncGenerator<WireChunk> {
  const decoder = new TextDecoder()
  const queue: string[] = []
  const parser = createParser({
    onEvent: (event) => {
      queue.push(event.data)
    },
  })

  const reader = body.getReader()
  try {
    while (true) {
      const result = await readWithBounds(reader, options)
      if (result.done === true) {
        throw new LlmError(
          'dsh-llm-app-credentials: the upstream stream ended without a [DONE] sentinel; the response was truncated.',
          'STREAM_CLOSED',
        )
      }
      parser.feed(decoder.decode(result.value, { stream: true }))
      while (queue.length > 0) {
        const data = queue.shift() as string
        if (data === '[DONE]') return
        if (data.trim().length === 0) continue
        let parsed: unknown
        try {
          parsed = JSON.parse(data) as unknown
        } catch {
          continue
        }
        if (parsed !== null && typeof parsed === 'object') yield parsed as WireChunk
      }
    }
  } finally {
    // Release the connection without surfacing a cancel error from an already-failed read.
    await reader.cancel().catch(() => undefined)
  }
}

/**
 * One `reader.read()` bounded by the idle timeout and the caller's signal.
 *
 * @param reader - the body reader.
 * @param options - bounds to enforce.
 * @returns the reader's own result.
 */
function readWithBounds(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  options: SseReadOptions,
): Promise<ReadResult> {
  const { signal, idleTimeoutMs } = options
  if (signal?.aborted === true) return Promise.reject(abortReason(signal))
  return new Promise<ReadResult>((resolve, reject) => {
    let settled = false
    const cleanup = (): void => {
      clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
    }
    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      cleanup()
      reject(
        new LlmError(
          `dsh-llm-app-credentials: the upstream stream was idle for ${String(idleTimeoutMs)}ms; the connection is dead. ` +
            `Raise the route's streamIdleTimeoutMs only if this upstream legitimately pauses that long.`,
          'TRANSPORT',
        ),
      )
    }, idleTimeoutMs)
    const onAbort = (): void => {
      if (settled) return
      settled = true
      cleanup()
      reject(abortReason(signal))
    }
    signal?.addEventListener('abort', onAbort, { once: true })
    reader.read().then(
      (result) => {
        if (settled) return
        settled = true
        cleanup()
        resolve(result)
      },
      (error: unknown) => {
        if (settled) return
        settled = true
        cleanup()
        reject(error instanceof Error ? error : new Error(String(error)))
      },
    )
  })
}

/** The value to reject with when the caller aborted, preserving its reason when present. */
function abortReason(signal: AbortSignal | undefined): Error {
  const reason: unknown = signal?.reason
  if (reason instanceof Error) return reason
  const error = new Error('dsh-llm-app-credentials: the call was aborted')
  error.name = 'AbortError'
  return error
}
