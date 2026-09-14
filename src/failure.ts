/**
 * Failure classification for upstream HTTP responses.
 *
 * The classification itself is delegated to the harness's own classifiers rather
 * than re-derived here: a hand-written table of provider wordings goes stale in
 * silence, while `isContextWindowExceededError` / `isQuotaExceededError` are the
 * vocabulary the rest of the harness already reasons on.
 *
 * @module dsh-llm-app-credentials/failure
 */

import {
  LlmError,
  ProviderRequestId,
  isContextWindowExceededError,
  isQuotaExceededError,
} from '@deepseek-ai/dsh-llm'

/** Package name used in diagnostics. */
const PKG = 'dsh-llm-app-credentials'

/**
 * Wordings this upstream family uses when it refuses an unapproved client.
 *
 * The reference gateway hit this repeatedly (as HTTP 400 with `code: 11128`),
 * and the flat `INVALID_REQUEST` it would otherwise produce says nothing about
 * which of the two known causes applies. Matching it explicitly turns a
 * dead-end error into a two-line fix.
 */
const ILLEGAL_CHANNEL_PATTERN = /unapproved channel|illegal api invocation|request illegal/i

/**
 * Turn one non-OK upstream response into a typed failure.
 *
 * @param response - the non-OK response; its body is consumed here.
 * @returns the classified error, with the upstream's own text preserved.
 */
export async function classifyFailure(response: Response): Promise<LlmError> {
  const raw = await readBodyText(response)
  const status = response.status
  const detail = `${String(status)} ${raw}`
  const requestId = optionalRequestId(response.headers.get('x-request-id'))
  const providerRetryAfterMs = retryAfterMs(response)
  const options = {
    status,
    ...(requestId !== undefined ? { requestId } : {}),
    ...(providerRetryAfterMs !== undefined ? { providerRetryAfterMs } : {}),
  }

  const illegalChannel = illegalChannelHint(raw)
  if (illegalChannel !== undefined) return new LlmError(illegalChannel, 'INVALID_REQUEST', options)
  if (status === 401 || status === 403) return new LlmError(raw, 'AUTH', options)
  if (status === 429) return new LlmError(raw, 'RATE_LIMIT', options)
  if (isContextWindowExceededError(detail)) return new LlmError(raw, 'CONTEXT_WINDOW_EXCEEDED', options)
  if (isQuotaExceededError(detail)) return new LlmError(raw, 'QUOTA', options)
  if (status === 400) return new LlmError(raw, 'INVALID_REQUEST', options)
  if (status >= 500) return new LlmError(raw, 'SERVER', options)
  return new LlmError(raw, `HTTP_${String(status)}`, options)
}

/**
 * Classify a transport-level rejection (DNS, TLS, connection reset, proxy
 * refusal) so the turn fails with a routable code instead of a bare `TypeError`.
 *
 * @param error - the value thrown by `fetch`.
 * @param endpoint - the endpoint that could not be reached, for the message.
 * @returns the classified error, retaining the original as its cause.
 */
export function classifyTransportError(error: unknown, endpoint: string): LlmError {
  const summary = error instanceof Error ? error.message : String(error)
  return new LlmError(
    `${PKG}: cannot reach ${endpoint} (${summary}). Check the route's baseURL and, if this machine needs one, the desktop proxy setting.`,
    'TRANSPORT',
    { cause: error },
  )
}

/** Read a bounded amount of the response body as text; never throws. */
async function readBodyText(response: Response): Promise<string> {
  try {
    const text = await response.text()
    const trimmed = text.trim()
    if (trimmed.length === 0) return `HTTP ${String(response.status)}`
    return trimmed.length > 500 ? `${trimmed.slice(0, 500)}…` : trimmed
  } catch {
    return `HTTP ${String(response.status)}`
  }
}

/** The actionable diagnosis for an unapproved-client refusal, when it matches. */
function illegalChannelHint(raw: string): string | undefined {
  if (!ILLEGAL_CHANNEL_PATTERN.test(raw) && !raw.includes('11128')) return undefined
  return (
    `${PKG}: the upstream refused this client as an unapproved channel. Two known causes: ` +
    `(1) the User-Agent carries the harness identity — give the route its own attribution; ` +
    `(2) the system prompt landed on a role the upstream rejects — keep quirks.ensureSystemFirst on. ` +
    `Upstream said: ${raw}`
  )
}

/** Brand a provider request id, or undefined when the upstream sent none. */
function optionalRequestId(header: string | null): ReturnType<typeof ProviderRequestId> | undefined {
  return header === null || header.length === 0 ? undefined : ProviderRequestId(header)
}

/** Parse `Retry-After` (delta seconds or HTTP date) into milliseconds. */
function retryAfterMs(response: Response): number | undefined {
  const header = response.headers.get('retry-after')
  if (header === null) return undefined
  const seconds = Number(header)
  if (Number.isFinite(seconds) && seconds > 0) return Math.round(seconds * 1000)
  const at = Date.parse(header)
  if (Number.isFinite(at)) {
    const delta = at - Date.now()
    if (delta > 0) return delta
  }
  return undefined
}
