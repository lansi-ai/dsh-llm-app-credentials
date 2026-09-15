/**
 * Configuration schema for dsh-llm-app-credentials.
 *
 * The profile dict is keyed by **route name**, so the composition base (this
 * plugin's entry config) and a user-settings layer merge per route, and the
 * route set is structural. No vendor name lives in the schema: a route is
 * whatever key the user writes.
 *
 * @module dsh-llm-app-credentials/config
 */

import z from '@deepseek-ai/schemastery'
import type { Config } from './types.js'

/** Default maximum idle interval while one stream read is outstanding (mirrors the reference adapter). */
export const DEFAULT_STREAM_IDLE_TIMEOUT_MS = 300000

/**
 * Default request-image projection bounds.
 *
 * They match the generic pi-ai adapter's defaults, so an image projected for
 * this route is bounded the same way as one projected for a first-party
 * provider: at most ~4 MP after aspect-preserving scaling, and a ~1 MB encoded
 * target before base64 expansion.
 */
export const DEFAULT_IMAGE_PIXEL_BUDGET = 4194304

/** Default encoded-byte target for one projected request image. */
export const DEFAULT_IMAGE_MAX_BYTES = 1048576

/**
 * The reasoning level that means "do not send `reasoning_effort` at all".
 *
 * It is always selectable, and it is the declared default, because the harness
 * **rejects** a requested level the model does not declare (before any network
 * I/O) while a stored selection with no level has to land somewhere. Choosing
 * the off level is also the only value this plugin can honor without knowing
 * anything about the upstream.
 */
export const OFF_EFFORT = 'off'

/**
 * Conventional `reasoning_effort` spellings offered when a route declares none.
 *
 * These are the standard OpenAI-compatible levels for the same field; the
 * reference deployment was verified with `high`. A different upstream may accept
 * fewer or different spellings — override per route with `reasoningEfforts`, or
 * set it to `[]` to offer only the off level.
 */
export const DEFAULT_REASONING_EFFORTS: readonly string[] = ['low', 'medium', 'high']

/** Credential source: another local application's file. */
const credentialSpecSchema = z.object({
  file: z.string().required(),
  token: z.string().required(),
  uid: z.string(),
  expiresAt: z.string(),
})

/**
 * One advertised model. Capacities are omitted when unknown rather than guessed.
 *
 * `inputModalities` is the exception that must be stated: the harness treats an
 * absent list as "unknown" and refuses image input on such a route, so a model
 * this deployment knows to be image-capable has to say so explicitly.
 */
const modelSpecSchema = z.object({
  id: z.string().required(),
  name: z.string(),
  contextWindow: z.number().step(1).min(1),
  maxTokens: z.number().step(1).min(1),
  inputModalities: z.array(z.union(['text', 'image'])),
})

/**
 * White-label attribution identity sent to the upstream.
 *
 * The inner fields are deliberately **not** `.required()`. schemastery
 * materializes an absent optional nested object as `{}` and then runs that
 * object's own schema, so a required inner field fails on every profile that
 * simply omits the whole object — and, when that happens during settings
 * registration, the failure is contained rather than fatal, which turns it into
 * a silent "namespace unavailable" on the settings page. Completeness is
 * enforced at the point of use instead (see `completeIdentity` in `adapter.ts`),
 * where an incomplete identity degrades to the plugin's own identity.
 */
const attributionSchema = z.object({
  product: z.string(),
  version: z.string(),
  url: z.string(),
})

/** Upstream-behaviour switches; defaults keep the reference upstream working. */
const quirksSchema = z.object({
  forceStream: z.boolean().default(true),
  ensureSystemFirst: z.boolean().default(true),
  defaultSystemPrompt: z.string(),
})

/** One provider route; the `providers` dict key IS the route. */
const providerSchema = z.object({
  displayName: z.string(),
  baseURL: z.string().required(),
  credential: credentialSpecSchema.required(),
  attribution: attributionSchema,
  models: z.array(modelSpecSchema),
  reasoningEfforts: z.array(z.string()).default([...DEFAULT_REASONING_EFFORTS]),
  quirks: quirksSchema,
  streamIdleTimeoutMs: z.number().min(Number.MIN_VALUE).default(DEFAULT_STREAM_IDLE_TIMEOUT_MS),
  imagePixelBudget: z.number().step(1).min(1).default(DEFAULT_IMAGE_PIXEL_BUDGET),
  imageMaxBytes: z.number().step(1).min(1).default(DEFAULT_IMAGE_MAX_BYTES),
})

/** Runtime schema for {@link Config}. */
export const ConfigSchema: z<Config> = z.object({
  providers: z.dict(providerSchema).default({}),
})
