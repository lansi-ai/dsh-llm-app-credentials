/**
 * The adapter: one fetch + SSE round trip per model call.
 *
 * It is deliberately transport-only. Route lookups, credentials, prompt quirks
 * and error classification all live beside it, so this file reads as the shape of
 * a model call and nothing else. Every lookup is by the `provider` route passed
 * in, so adding an upstream is a configuration edit — no branch in here knows a
 * vendor name.
 *
 * @module dsh-llm-app-credentials/adapter
 */
import { LlmAdapter, type GenerateOptions, type LlmModelInfo, type LlmProviderInfo, type LlmResolvedModelInfo, type StreamChunk } from '@deepseek-ai/dsh-llm';
import { type FileRef } from './serialize.js';
import type { ProviderConfig } from './types.js';
/** Package name used in diagnostics. */
export declare const PKG = "dsh-llm-app-credentials";
/** Everything the adapter needs, resolved per call so settings changes take effect without a restart. */
export interface AppCredentialsAdapterOptions {
    /** Current route table (a thunk, not a snapshot). */
    readonly providers: () => Record<string, ProviderConfig>;
    /** Identity used when a route declares no attribution of its own. */
    readonly fallbackIdentity: {
        product: string;
        version: string;
        url: string;
    };
    /** Host-side projection of a durable file reference, when the runtime exposes one. */
    readonly fileRequestText?: ((ref: FileRef) => string) | undefined;
}
/**
 * `LlmAdapter` over an OpenAI-compatible chat-completions endpoint whose
 * credential comes from another local application's file.
 */
export declare class AppCredentialsAdapter extends LlmAdapter {
    private readonly options;
    constructor(options: AppCredentialsAdapterOptions);
    providerInfo(provider: string): LlmProviderInfo;
    listModels(provider: string): Promise<readonly LlmModelInfo[]>;
    resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo>;
    stream(options: GenerateOptions): AsyncGenerator<StreamChunk>;
    /** Resolve one route, or fail loudly — an unconfigured route must not silently pick a default. */
    private route;
    /** Perform the HTTP call, attributing it and classifying transport failures. */
    private dispatch;
}
