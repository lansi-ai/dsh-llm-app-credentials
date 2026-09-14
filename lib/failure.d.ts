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
import { LlmError } from '@deepseek-ai/dsh-llm';
/**
 * Turn one non-OK upstream response into a typed failure.
 *
 * @param response - the non-OK response; its body is consumed here.
 * @returns the classified error, with the upstream's own text preserved.
 */
export declare function classifyFailure(response: Response): Promise<LlmError>;
/**
 * Classify a transport-level rejection (DNS, TLS, connection reset, proxy
 * refusal) so the turn fails with a routable code instead of a bare `TypeError`.
 *
 * @param error - the value thrown by `fetch`.
 * @param endpoint - the endpoint that could not be reached, for the message.
 * @returns the classified error, retaining the original as its cause.
 */
export declare function classifyTransportError(error: unknown, endpoint: string): LlmError;
