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
import z from '@deepseek-ai/schemastery';
import type { Config } from './types.js';
/** Default maximum idle interval while one stream read is outstanding (mirrors the reference adapter). */
export declare const DEFAULT_STREAM_IDLE_TIMEOUT_MS = 300000;
/**
 * The reasoning level that means "do not send `reasoning_effort` at all".
 *
 * It is always selectable, and it is the declared default, because the harness
 * **rejects** a requested level the model does not declare (before any network
 * I/O) while a stored selection with no level has to land somewhere. Choosing
 * the off level is also the only value this plugin can honor without knowing
 * anything about the upstream.
 */
export declare const OFF_EFFORT = "off";
/**
 * Conventional `reasoning_effort` spellings offered when a route declares none.
 *
 * These are the standard OpenAI-compatible levels for the same field; the
 * reference deployment was verified with `high`. A different upstream may accept
 * fewer or different spellings — override per route with `reasoningEfforts`, or
 * set it to `[]` to offer only the off level.
 */
export declare const DEFAULT_REASONING_EFFORTS: readonly string[];
/** Runtime schema for {@link Config}. */
export declare const ConfigSchema: z<Config>;
