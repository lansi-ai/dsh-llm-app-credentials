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

import { readFile } from 'node:fs/promises'
import { LlmError } from '@deepseek-ai/dsh-llm'
import { pick } from './pick.js'
import type { CredentialSpec } from './types.js'

/** The resolved credential facts one request needs. */
export interface Credential {
  /** Bearer token, already stripped of any `Bearer ` prefix. */
  token: string
  /** Account id, when the credential file carries one. */
  uid?: string
  /** Epoch-millisecond expiry, when the credential file carries one. */
  expiresAt?: number
}

/** Package name used in diagnostics; never contains a vendor name. */
const PKG = 'dsh-llm-app-credentials'

/**
 * Read one route's credential from its configured file.
 *
 * @param spec - the route's credential source description.
 * @returns the token plus any uid / expiry the file provided.
 * @throws {LlmError} `MISSING_CREDENTIAL` when the file or path is unusable,
 *   `AUTH` when the file's own expiry has already passed.
 */
export async function readCredential(spec: CredentialSpec): Promise<Credential> {
  let document: unknown
  try {
    document = JSON.parse(await readFile(spec.file, 'utf8')) as unknown
  } catch (error) {
    throw new LlmError(
      `${PKG}: cannot read the credential file "${spec.file}" (${describeError(error)}). ` +
        `Sign in to the source application again, or point the route's credential.file at the right file.`,
      'MISSING_CREDENTIAL',
      { cause: error },
    )
  }

  const raw = pick(document, spec.token)
  if (typeof raw !== 'string' || raw.length === 0) {
    throw new LlmError(
      `${PKG}: the credential file "${spec.file}" carries no token at "${spec.token}". ` +
        `Check credential.token against the file's actual shape, or sign in again.`,
      'MISSING_CREDENTIAL',
    )
  }

  const uid = spec.uid === undefined ? undefined : pick(document, spec.uid)
  const expiresAt = spec.expiresAt === undefined ? undefined : pick(document, spec.expiresAt)
  if (typeof expiresAt === 'number' && Number.isFinite(expiresAt) && expiresAt > 0 && Date.now() > expiresAt) {
    throw new LlmError(
      `${PKG}: the credential in "${spec.file}" expired at ${new Date(expiresAt).toISOString()}; ` +
        `sign in to the source application again to refresh it.`,
      'AUTH',
    )
  }

  return {
    token: raw.replace(/^Bearer\s+/i, '').trim(),
    ...(typeof uid === 'string' && uid.length > 0 ? { uid } : {}),
    ...(typeof expiresAt === 'number' && Number.isFinite(expiresAt) ? { expiresAt } : {}),
  }
}

/** Render a caught value as one line, preferring the errno over the message. */
function describeError(error: unknown): string {
  if (error !== null && typeof error === 'object' && 'code' in error) {
    const code = (error as { code?: unknown }).code
    if (typeof code === 'string') return code
  }
  return error instanceof Error ? error.message : String(error)
}
