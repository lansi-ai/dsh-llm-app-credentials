/**
 * `dsh-llm-app-credentials` — an LLM adapter whose credential comes from another
 * local application's file rather than a standard API key.
 *
 * Why this exists as its own plugin: the generic OpenAI-compatible adapter
 * already covers "configure an API key". The one thing it cannot do is take the
 * credential from an application that manages its own session — so this plugin's
 * identity describes that **mechanism**, and nothing about any vendor. A route is
 * whatever key the user writes under `providers`; the shipped detection table
 * (see `detect.ts`) is a convenience layered underneath the configuration, never
 * a hard-coded upstream.
 *
 * Layering, highest wins:
 *   1. the settings user section      (`settings.installSection` user layer)
 *   2. this plugin's entry config     (composition base)
 *   3. built-in detection             (only when the credential file exists)
 *   4. schema defaults
 *
 * @module dsh-llm-app-credentials
 */
import type { Context } from '@deepseek-ai/cordis';
import type { Config } from './types.js';
/** Plugin id; also the settings namespace and the client-half module id. */
export declare const name = "llm-app-credentials";
/** The LLM seam is the whole point: the adapter is registered onto it. */
export declare const inject: string[];
/** Settings namespace. Lowercase-hyphenated, and free of any vendor name. */
export declare const NS = "llm-app-credentials";
/**
 * White-label attribution identity.
 *
 * **Must be given explicitly.** Omitting it makes the adapter send the harness
 * default (`deepseek-harness`), which this upstream family refuses with HTTP 400
 * `{"code":11128,"msg":"request illegal"}`. It is also the fallback for a route
 * that declares no attribution of its own, so a forgotten field cannot turn into
 * an opaque failure.
 */
export declare const PLUGIN_IDENTITY: {
    readonly product: "app-credentials";
    readonly version: string;
    readonly url: "https://example.invalid";
};
/** Configuration schema, exported for the loader to validate the plugin row. */
export { ConfigSchema as Config } from './config.js';
/**
 * Register one adapter for every configured route.
 *
 * @param ctx - plugin context (holds `llm`, and optionally `settings`).
 * @param config - the plugin row's configuration (the composition base layer).
 */
export declare function apply(ctx: Context, config: Config): void;
