/**
 * The adapter: one fetch + SSE round trip per model call.
 *
 * It is deliberately transport-only. Route lookups, credentials, prompt quirks
 * and error classification all live beside it, so this file reads as the shape
 * of a model call and nothing else. Every lookup is by the `provider` route passed
 * in, so adding an upstream is a configuration edit — no branch in here knows a
 * vendor name.
 *
 * Image input is a per-model declaration, not a per-route one: the adapter reads
 * an image only when the resolved model lists `image` in its modalities, because
 * a route may serve image-capable and text-only models side by side.
 *
 * @module dsh-llm-app-credentials/adapter
 */

import {
  LlmAdapter,
  LlmError,
  ReasoningEffortId,
  assertUsableApiKey,
  attributionHeaders,
  type GenerateOptions,
  type LlmModelInfo,
  type LlmModelReasoningInfo,
  type LlmProviderInfo,
  type LlmResolvedModelInfo,
  type StreamChunk,
} from '@deepseek-ai/dsh-llm'
import {
  DEFAULT_IMAGE_MAX_BYTES,
  DEFAULT_IMAGE_PIXEL_BUDGET,
  DEFAULT_REASONING_EFFORTS,
  DEFAULT_STREAM_IDLE_TIMEOUT_MS,
  OFF_EFFORT,
} from './config.js'
import { readCredential } from './credential.js'
import { classifyFailure, classifyTransportError } from './failure.js'
import { buildRequestBody, collectImageRefs, type FileRef, type SerializeHelpers } from './serialize.js'
import { readSse } from './sse.js'
import { translate } from './translate.js'
import type { Credential } from './credential.js'
import type { ImageRequestPolicy, ImageStore, ProviderConfig, RequestImage } from './types.js'

/** Package name used in diagnostics. */
export const PKG = 'dsh-llm-app-credentials'

/** Everything the adapter needs, resolved per call so settings changes take effect without a restart. */
export interface AppCredentialsAdapterOptions {
  /** Current route table (a thunk, not a snapshot). */
  readonly providers: () => Record<string, ProviderConfig>
  /** Identity used when a route declares no attribution of its own. */
  readonly fallbackIdentity: { product: string; version: string; url: string }
  /** Host-side projection of a durable file reference, when the runtime exposes one. */
  readonly fileRequestText?: ((ref: FileRef) => string) | undefined
  /**
   * The host's durable attachment store, when it is mounted.
   *
   * A thunk rather than a value because the host may provide the service after
   * this plugin loads; `undefined` is a valid answer and is only reported as an
   * error when an image is actually in play.
   */
  readonly resolveImageStore?: (() => ImageStore | undefined) | undefined
}

/**
 * `LlmAdapter` over an OpenAI-compatible chat-completions endpoint whose
 * credential comes from another local application's file.
 */
export class AppCredentialsAdapter extends LlmAdapter {
  constructor(private readonly options: AppCredentialsAdapterOptions) {
    super()
  }

  override providerInfo(provider: string): LlmProviderInfo {
    const profile = this.options.providers()[provider]
    return { id: provider, name: profile?.displayName ?? provider }
  }

  override async listModels(provider: string): Promise<readonly LlmModelInfo[]> {
    const models = this.options.providers()[provider]?.models
    if (models === undefined) return []
    return models.map((model) => ({
      provider,
      id: model.id,
      name: model.name ?? model.id,
      inputModalities: model.inputModalities ?? ['text'],
    }))
  }

  override async resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
    const profile = this.options.providers()[provider]
    const spec = profile?.models?.find((candidate) => candidate.id === model)
    return {
      provider,
      id: model,
      name: spec?.name ?? model,
      ...(spec?.contextWindow !== undefined ? { context: { contextWindow: spec.contextWindow } } : {}),
      ...(spec?.maxTokens !== undefined ? { defaultMaxTokens: spec.maxTokens } : {}),
      // Stated explicitly rather than left absent: the harness reads an absent
      // list as "unknown" and refuses image input on such a route, while an
      // unlisted model must not accidentally look image-capable either.
      inputModalities: spec?.inputModalities ?? ['text'],
      reasoning: reasoningInfo(profile),
    }
  }

  override async *stream(options: GenerateOptions): AsyncGenerator<StreamChunk> {
    const profile = this.route(options.provider)
    // Re-read per request: the source application rotates its own token, so this
    // picks the new one up with no restart and no refresh flow of our own.
    const credential = await readCredential(profile.credential)
    const endpoint = endpointOf(profile.baseURL)
    const helpers = await this.serializeHelpers(profile, options)
    const body = buildRequestBody(options, profile, helpers)

    const response = await this.dispatch(endpoint, profile, credential, body, options.signal)
    if (!response.ok) throw await classifyFailure(response)
    if (response.body === null) throw new LlmError(`${PKG}: ${endpoint} answered without a body`, 'TRANSPORT')

    yield* translate(
      readSse(response.body, {
        ...(options.signal !== undefined ? { signal: options.signal } : {}),
        idleTimeoutMs: profile.streamIdleTimeoutMs ?? DEFAULT_STREAM_IDLE_TIMEOUT_MS,
      }),
    )
  }

  /**
   * Build the serializer's host-side helpers for one call.
   *
   * Image bytes are read only when the route's model declares `image` **and** the
   * request carries at least one image, so a text-only route never pays for a
   * projection it cannot use and keeps the degradation path untouched.
   *
   * @param profile - the resolved route.
   * @param options - the request, whose messages and signal drive the reads.
   * @returns the helpers; `requestImages` is present only when images will be sent.
   */
  private async serializeHelpers(profile: ProviderConfig, options: GenerateOptions): Promise<SerializeHelpers> {
    const helpers: SerializeHelpers =
      this.options.fileRequestText === undefined ? {} : { fileRequestText: this.options.fileRequestText }
    if (!this.imageAllowed(profile, options.model)) return helpers

    const refs = collectImageRefs(options.messages)
    if (refs.length === 0) return helpers

    const store = this.options.resolveImageStore?.()
    if (store === undefined) {
      throw new LlmError(
        `${PKG}: model "${options.model}" accepts image input, but the durable attachment service is not available`,
        'UNSUPPORTED_CONTENT',
      )
    }

    const policy: ImageRequestPolicy = {
      maxPixels: profile.imagePixelBudget ?? DEFAULT_IMAGE_PIXEL_BUDGET,
      maxBytes: profile.imageMaxBytes ?? DEFAULT_IMAGE_MAX_BYTES,
    }
    const prepared = await Promise.all(refs.map((ref) => store.readImageRequest(ref, policy, options.signal)))
    const requestImages = new Map<string, RequestImage>()
    for (const [index, ref] of refs.entries()) {
      const image = prepared[index]
      if (image !== undefined) requestImages.set(String(ref.attachmentId), image)
    }
    return { ...helpers, requestImages }
  }

  /** Whether the route advertises this exact model as accepting image input. */
  private imageAllowed(profile: ProviderConfig, model: string): boolean {
    return profile.models?.find((candidate) => candidate.id === model)?.inputModalities?.includes('image') === true
  }

  /** Resolve one route, or fail loudly — an unconfigured route must not silently pick a default. */
  private route(provider: string): ProviderConfig {
    const profile = this.options.providers()[provider]
    if (profile === undefined) {
      throw new LlmError(
        `${PKG}: route "${provider}" is not configured. Add it under providers in the plugin configuration ` +
          `or on the LLM credential settings page.`,
        'NO_ADAPTER',
      )
    }
    return profile
  }

  /** Perform the HTTP call, attributing it and classifying transport failures. */
  private async dispatch(
    endpoint: string,
    profile: ProviderConfig,
    credential: Credential,
    body: Record<string, unknown>,
    signal: AbortSignal | undefined,
  ): Promise<Response> {
    const token = assertUsableApiKey(credential.token, PKG, 'APP_CREDENTIAL_TOKEN')
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
      })
    } catch (error) {
      // An abort must stay an abort: the runtime classifies the terminal finish
      // from the signal, and wrapping it would report a transport fault instead.
      if (signal?.aborted === true || (error instanceof Error && error.name === 'AbortError')) throw error
      throw classifyTransportError(error, endpoint)
    }
  }
}

/**
 * Resolve a route's chat-completions endpoint.
 *
 * Accepts either an origin (`https://host`) or a versioned root
 * (`https://host/v2`), and tolerates a fully-qualified endpoint being pasted in.
 */
function endpointOf(baseURL: string): string {
  const trimmed = baseURL.replace(/\/+$/, '')
  return trimmed.endsWith('/chat/completions') ? trimmed : `${trimmed}/chat/completions`
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
function completeIdentity(
  attribution: { product?: string; version?: string; url?: string } | undefined,
): { product: string; version: string; url: string } | undefined {
  if (attribution === undefined) return undefined
  const { product, version, url } = attribution
  if (typeof product !== 'string' || product.length === 0) return undefined
  if (typeof version !== 'string' || version.length === 0) return undefined
  if (typeof url !== 'string' || url.length === 0) return undefined
  return { product, version, url }
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
function reasoningInfo(profile: ProviderConfig | undefined): LlmModelReasoningInfo {
  const declared = profile?.reasoningEfforts ?? DEFAULT_REASONING_EFFORTS
  const seen = new Set<string>([OFF_EFFORT])
  const ids = [OFF_EFFORT]
  for (const level of declared) {
    if (level.length === 0 || seen.has(level)) continue
    seen.add(level)
    ids.push(level)
  }
  return {
    efforts: ids.map((id) => ({ id: ReasoningEffortId(id), name: id === OFF_EFFORT ? '关闭' : id })),
    defaultEffort: ReasoningEffortId(OFF_EFFORT),
  }
}
