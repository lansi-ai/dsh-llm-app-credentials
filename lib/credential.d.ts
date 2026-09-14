/**
 * Credential reading: another local application's credential file.
 *
 * This is the one thing that separates this plugin from the generic
 * OpenAI-compatible adapter: the credential is not a standard API key and does
 * not live in the harness credential store, so `ctx.credentials.resolve()` can
 * never reach it. The file is re-read on **every request** (a few KB, negligible)
 * which is what makes hot rotation work: the other application refreshes its own
 * token, and the next request picks the new one up with no restart and no refresh
 * flow implemented here.
 *
 * @module dsh-llm-app-credentials/credential
 */
import type { CredentialSpec } from './types.js';
/** The resolved credential facts one request needs. */
export interface Credential {
    /** Bearer token, already stripped of any `Bearer ` prefix. */
    token: string;
    /** Account id, when the credential file carries one. */
    uid?: string;
    /** Epoch-millisecond expiry, when the credential file carries one. */
    expiresAt?: number;
}
/**
 * Read one route's credential from its configured file.
 *
 * @param spec - the route's credential source description.
 * @returns the token plus any uid / expiry the file provided.
 * @throws {LlmError} `MISSING_CREDENTIAL` when the file or path is unusable,
 *   `AUTH` when the file's own expiry has already passed.
 */
export declare function readCredential(spec: CredentialSpec): Promise<Credential>;
