/**
 * Dot-path lookup used to pull a token / uid / expiry out of another
 * application's credential document.
 *
 * The document shape differs per application, so the paths are configuration
 * rather than code: swapping applications is a config edit, never a patch.
 *
 * @module dsh-llm-app-credentials/pick
 */
/**
 * Walk `path` into `doc`, treating any missing or non-object segment as absent.
 *
 * `'auth.accessToken'` → `doc?.auth?.accessToken`; `''` returns the document
 * itself, so a credential file that IS the bare token string stays reachable.
 *
 * @param doc - parsed JSON document (or any value).
 * @param path - dot-separated path.
 * @returns the value at that path, or `undefined` when any segment is absent.
 */
export declare function pick(doc: unknown, path: string): unknown;
