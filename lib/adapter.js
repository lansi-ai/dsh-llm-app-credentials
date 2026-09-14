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
import { LlmAdapter, LlmError, ReasoningEffortId, assertUsableApiKey, attributionHeaders, } from '@deepseek-ai/dsh-llm';
import { DEFAULT_REASONING_EFFORTS, DEFAULT_STREAM_IDLE_TIMEOUT_MS, OFF_EFFORT } from './config.js';
import { readCredential } from './credential.js';
import { classifyFailure, classifyTransportError } from './failure.js';
import { buildRequestBody } from './serialize.js';
import { readSse } from './sse.js';
import { translate } from './translate.js';
/** Package name used in diagnostics. */
export const PKG = 'dsh-llm-app-credentials';
/**
 * `LlmAdapter` over an OpenAI-compatible chat-completions endpoint whose
 * credential comes from another local application's file.
 */
export class AppCredentialsAdapter extends LlmAdapter {
    options;
    constructor(options) {
        super();
        this.options = options;
    }
    providerInfo(provider) {
        const profile = this.options.providers()[provider];
        return { id: provider, name: profile?.displayName ?? provider };
    }
    async listModels(provider) {
        const models = this.options.providers()[provider]?.models;
        if (models === undefined)
            return [];
        return models.map((model) => ({ provider, id: model.id, name: model.name ?? model.id }));
    }
    async resolveModel(provider, model) {
        const profile = this.options.providers()[provider];
        const spec = profile?.models?.find((candidate) => candidate.id === model);
        return {
            provider,
            id: model,
            name: spec?.name ?? model,
            ...(spec?.contextWindow !== undefined ? { context: { contextWindow: spec.contextWindow } } : {}),
            ...(spec?.maxTokens !== undefined ? { defaultMaxTokens: spec.maxTokens } : {}),
            reasoning: reasoningInfo(profile),
        };
    }
    async *stream(options) {
        const profile = this.route(options.provider);
        // Re-read per request: the source application rotates its own token, so this
        // picks the new one up with no restart and no refresh flow of our own.
        const credential = await readCredential(profile.credential);
        const endpoint = endpointOf(profile.baseURL);
        const helpers = this.options.fileRequestText === undefined ? {} : { fileRequestText: this.options.fileRequestText };
        const body = buildRequestBody(options, profile, helpers);
        const response = await this.dispatch(endpoint, profile, credential, body, options.signal);
        if (!response.ok)
            throw await classifyFailure(response);
        if (response.body === null)
            throw new LlmError(`${PKG}: ${endpoint} answered without a body`, 'TRANSPORT');
        yield* translate(readSse(response.body, {
            ...(options.signal !== undefined ? { signal: options.signal } : {}),
            idleTimeoutMs: profile.streamIdleTimeoutMs ?? DEFAULT_STREAM_IDLE_TIMEOUT_MS,
        }));
    }
    /** Resolve one route, or fail loudly — an unconfigured route must not silently pick a default. */
    route(provider) {
        const profile = this.options.providers()[provider];
        if (profile === undefined) {
            throw new LlmError(`${PKG}: route "${provider}" is not configured. Add it under providers in the plugin configuration ` +
                `or on the LLM credential settings page.`, 'NO_ADAPTER');
        }
        return profile;
    }
    /** Perform the HTTP call, attributing it and classifying transport failures. */
    async dispatch(endpoint, profile, credential, body, signal) {
        const token = assertUsableApiKey(credential.token, PKG, 'APP_CREDENTIAL_TOKEN');
        try {
            return await fetch(endpoint, {
                method: 'POST',
                headers: {
                    // White-label identity is mandatory: the harness default is refused by
                    // this upstream family with an opaque 400, so a route that declares no
                    // attribution still must not fall back to the harness identity.
                    ...attributionHeaders(completeIdentity(profile.attribution) ?? this.options.fallbackIdentity),
                    authorization: `Bearer ${token}`,
                    ...(credential.uid !== undefined ? { 'x-user-id': encodeURIComponent(credential.uid) } : {}),
                    'content-type': 'application/json',
                    accept: 'text/event-stream',
                },
                body: JSON.stringify(body),
                ...(signal !== undefined ? { signal } : {}),
            });
        }
        catch (error) {
            // An abort must stay an abort: the runtime classifies the terminal finish
            // from the signal, and wrapping it would report a transport fault instead.
            if (signal?.aborted === true || (error instanceof Error && error.name === 'AbortError'))
                throw error;
            throw classifyTransportError(error, endpoint);
        }
    }
}
/**
 * Resolve a route's chat-completions endpoint.
 *
 * Accepts either an origin (`https://host`) or a versioned root
 * (`https://host/v2`), and tolerates a fully-qualified endpoint being pasted in.
 */
function endpointOf(baseURL) {
    const trimmed = baseURL.replace(/\/+$/, '');
    return trimmed.endsWith('/chat/completions') ? trimmed : `${trimmed}/chat/completions`;
}
/**
 * Accept a configured attribution identity only when it is complete.
 *
 * The schema cannot require the inner fields (an omitted optional object is
 * materialized as `{}`), so completeness is judged here: a half-filled identity
 * would render a `User-Agent` with an empty product token, which is exactly the
 * opaque refusal this plugin exists to avoid — falling back to the plugin's own
 * identity is strictly better than sending a broken one.
 *
 * @param attribution - the route's configured identity, possibly partial.
 * @returns a complete identity, or undefined when anything is missing.
 */
function completeIdentity(attribution) {
    if (attribution === undefined)
        return undefined;
    const { product, version, url } = attribution;
    if (typeof product !== 'string' || product.length === 0)
        return undefined;
    if (typeof version !== 'string' || version.length === 0)
        return undefined;
    if (typeof url !== 'string' || url.length === 0)
        return undefined;
    return { product, version, url };
}
/**
 * Declare one route's selectable reasoning levels.
 *
 * Declaring the off level is not cosmetic. The harness **rejects** a requested
 * level the model does not declare — `UNSUPPORTED_REASONING_EFFORT`, thrown
 * before any network I/O — and a stored selection that carries no level has to
 * resolve to something. So every route declares the off level, and the off level
 * is the default, which is also the only value this plugin can honor without
 * knowing anything about the upstream.
 *
 * @param profile - the route's configuration; an unknown route still gets a
 *   usable declaration so a stale selection cannot wedge the caller.
 * @returns the reasoning metadata for `resolveModel`.
 */
function reasoningInfo(profile) {
    const declared = profile?.reasoningEfforts ?? DEFAULT_REASONING_EFFORTS;
    const seen = new Set([OFF_EFFORT]);
    const ids = [OFF_EFFORT];
    for (const level of declared) {
        if (level.length === 0 || seen.has(level))
            continue;
        seen.add(level);
        ids.push(level);
    }
    return {
        efforts: ids.map((id) => ({ id: ReasoningEffortId(id), name: id === OFF_EFFORT ? '关闭' : id })),
        defaultEffort: ReasoningEffortId(OFF_EFFORT),
    };
}
