/**
 * Wire (upstream HTTP) and configuration types for dsh-llm-app-credentials.
 *
 * The adapter speaks the OpenAI-compatible chat-completions wire shape; only the
 * fields this plugin actually reads or writes are declared. Configuration is a
 * route-name → provider-profile map, so no vendor name is baked into the plugin:
 * the route is whatever the user (or auto-detection) names.
 *
 * @module dsh-llm-app-credentials/types
 */

/** Where one route's credential comes from: another local application's file. */
export interface CredentialSpec {
  /** Absolute path of the credential file the other application writes. */
  file: string
  /** Dot path inside that JSON document holding the token, e.g. `auth.accessToken`. */
  token: string
  /** Dot path holding the account id, when the upstream wants one. */
  uid?: string
  /** Dot path holding an epoch-millisecond expiry, when the file carries one. */
  expiresAt?: string
}

/** One model a route advertises. Catalog membership is advisory, never routing. */
export interface ModelSpec {
  /** Model id the upstream accepts. */
  id: string
  /** Display name for model selectors; defaults to the id. */
  name?: string
  /** Maximum combined request + response context, when known. */
  contextWindow?: number
  /** Maximum output tokens, when known. */
  maxTokens?: number
}

/**
 * Upstream-behaviour switches. They default to the values that made the
 * reference upstream work; a different upstream may need them off.
 */
export interface ProviderQuirks {
  /** Force `stream: true` on the request (default true — the harness is always streaming). */
  forceStream?: boolean
  /** Guarantee `messages[0].role === 'system'` (default true). */
  ensureSystemFirst?: boolean
  /** System prompt inserted when the request carries none (default 'You are a helpful assistant.'). */
  defaultSystemPrompt?: string
}

/** One provider route. The `providers` dict key IS the route name. */
export interface ProviderConfig {
  /** Name shown in model selectors; defaults to the route key. */
  displayName?: string
  /** Upstream root, e.g. `https://host/v2` or `https://host`. */
  baseURL: string
  /** Credential source (another local application's file). */
  credential: CredentialSpec
  /** White-label attribution identity; defaults to {@link PLUGIN_IDENTITY}. */
  attribution?: { product: string; version: string; url: string }
  /** Model catalog for this route. */
  models?: ModelSpec[]
  /**
   * Selectable reasoning levels **beyond** the always-present off level, spelled
   * exactly as the upstream's `reasoning_effort` field expects. Omitted keeps
   * {@link DEFAULT_REASONING_EFFORTS}; an empty list offers only the off level,
   * which is the honest choice for an upstream whose levels are unknown.
   */
  reasoningEfforts?: string[]
  /** Upstream quirk switches. */
  quirks?: ProviderQuirks
  /** Maximum provider idle time while one stream read is outstanding. */
  streamIdleTimeoutMs?: number
}

/** Plugin configuration: the provider routes this instance owns. */
export interface Config {
  /** Route name → provider profile. Empty means "auto-detect only". */
  providers: Record<string, ProviderConfig>
}

// ── Upstream wire vocabulary (OpenAI-compatible chat completions) ────────────

/** One tool call fragment inside a streamed delta. */
export interface WireToolCall {
  index?: number
  id?: string
  type?: string
  function?: { name?: string; arguments?: string }
}

/** The `choices[].delta` object of one streamed chunk. */
export interface WireDelta {
  role?: string
  content?: string | null
  reasoning_content?: string | null
  tool_calls?: WireToolCall[]
}

/** The `choices[]` entry of one streamed chunk. */
export interface WireChoice {
  index?: number
  delta?: WireDelta
  finish_reason?: string | null
}

/** Token accounting exactly as the upstream reports it. */
export interface WireUsage {
  prompt_tokens?: number
  completion_tokens?: number
  total_tokens?: number
  prompt_cache_hit_tokens?: number
  prompt_cache_miss_tokens?: number
  prompt_cache_write_tokens?: number
  completion_tokens_details?: { reasoning_tokens?: number }
}

/** One server-sent-event payload (a chunk, an error envelope, or `[DONE]`). */
export interface WireChunk {
  id?: string
  model?: string
  choices?: WireChoice[]
  usage?: WireUsage | null
  error?: { message?: string; code?: string | number; type?: string }
}

/** One assembled tool call sent back upstream on the assistant turn. */
export interface WireToolCallOut {
  id: string
  type: 'function'
  function: { name: string; arguments: string }
}

/** One outbound chat message. */
export interface WireMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string | null
  tool_calls?: WireToolCallOut[]
  tool_call_id?: string
  reasoning_content?: string
}

/** One outbound tool schema. */
export interface WireTool {
  type: 'function'
  function: { name: string; description: string; parameters: Record<string, unknown> }
}
