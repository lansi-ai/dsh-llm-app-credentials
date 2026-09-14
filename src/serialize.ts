/**
 * Request serialization: harness request → upstream wire body.
 *
 * Every upstream-specific behaviour lives here as an explicit switch, because
 * these are observations about one upstream, not universal truths. The defaults
 * are the values that made the reference upstream work.
 *
 * A message-list note: the harness has **no `tool` role**. A tool result is a
 * user-role message carrying a `tool-result` block, so it must be split back out
 * into the upstream's `role: 'tool'` message on the way out.
 *
 * @module dsh-llm-app-credentials/serialize
 */

import type { ContentBlock, GenerateOptions, Message } from '@deepseek-ai/dsh-llm'
import { OFF_EFFORT } from './config.js'
import type { ProviderConfig, WireMessage, WireTool, WireToolCallOut } from './types.js'

/** A durable file reference, taken from the block union so no extra package is imported. */
export type FileRef = Extract<ContentBlock, { type: 'file' }>['attachment']

/** Host-side projections the serializer needs for content it cannot render itself. */
export interface SerializeHelpers {
  /**
   * Official projection of one durable file occurrence to model-visible handle
   * text (`LlmRuntime.fileRequestText`). Absent when the runtime is unreachable,
   * in which case a plain placeholder is substituted.
   */
  fileRequestText?: (ref: FileRef) => string
}

/** Default system prompt for the `ensureSystemFirst` switch. */
const DEFAULT_SYSTEM_PROMPT = 'You are a helpful assistant.'

/**
 * Build the upstream request body for one call.
 *
 * @param options - the fully assembled harness request.
 * @param provider - the route's configuration (supplies the quirk switches).
 * @param helpers - host-side projections for non-text content.
 * @returns a plain JSON-serializable body.
 */
export function buildRequestBody(
  options: GenerateOptions,
  provider: ProviderConfig,
  helpers: SerializeHelpers = {},
): Record<string, unknown> {
  const quirks = provider.quirks ?? {}
  const forceStream = quirks.forceStream ?? true
  const ensureSystemFirst = quirks.ensureSystemFirst ?? true

  const messages = toWireMessages(options.messages, helpers)
  if (options.system !== undefined && options.system.length > 0) {
    messages.unshift({ role: 'system', content: options.system })
  }
  if (ensureSystemFirst && messages[0]?.role !== 'system') {
    messages.unshift({ role: 'system', content: quirks.defaultSystemPrompt ?? DEFAULT_SYSTEM_PROMPT })
  }

  const body: Record<string, unknown> = { model: options.model, messages }
  // The harness always streams, so this only exists to satisfy upstreams that require the flag.
  if (forceStream) body['stream'] = true
  if (options.tools !== undefined && options.tools.length > 0) {
    const tools: WireTool[] = options.tools.map((tool) => ({
      type: 'function',
      function: { name: tool.name, description: tool.description, parameters: tool.parameters },
    }))
    body['tools'] = tools
  }
  if (options.temperature !== undefined) body['temperature'] = options.temperature
  if (options.maxTokens !== undefined) body['max_completion_tokens'] = options.maxTokens
  // The off level means "no level chosen" and must never reach the wire; every
  // other declared level is sent verbatim, since its id IS its wire spelling.
  const effort = options.reasoningEffort
  if (effort !== undefined && String(effort) !== OFF_EFFORT) body['reasoning_effort'] = String(effort)
  if (options.stop !== undefined && options.stop.length > 0) body['stop'] = options.stop
  // Deliberately no `stream_options`: the reference upstream rejects it.
  return body
}

/** Map the harness message list onto upstream wire messages. */
function toWireMessages(messages: readonly Message[], helpers: SerializeHelpers): WireMessage[] {
  const out: WireMessage[] = []
  for (const message of messages) {
    if (message.role === 'system') {
      out.push({ role: 'system', content: textOf(message.content, helpers) })
      continue
    }
    if (message.role === 'assistant') {
      const text = textOf(message.content, helpers)
      const reasoning = reasoningOf(message.content)
      const toolCalls: WireToolCallOut[] = []
      for (const block of message.content) {
        if (block.type !== 'tool-call') continue
        toolCalls.push({ id: String(block.id), type: 'function', function: { name: block.name, arguments: block.arguments } })
      }
      out.push({
        role: 'assistant',
        content: toolCalls.length > 0 && text.length === 0 ? null : text,
        ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
        ...(reasoning.length > 0 ? { reasoning_content: reasoning } : {}),
      })
      continue
    }
    // user role: tool results split out into their own upstream messages.
    const parts: ContentBlock[] = []
    for (const block of message.content) {
      if (block.type === 'tool-result') {
        out.push({
          role: 'tool',
          tool_call_id: String(block.toolCallId),
          content: textOf(block.content, helpers),
        })
      } else {
        parts.push(block)
      }
    }
    if (parts.length > 0) out.push({ role: 'user', content: textOf(parts, helpers) })
  }
  return out
}

/**
 * Flatten blocks to plain text.
 *
 * This route declares itself text-only, so an image or file block is degraded to
 * text rather than dropped: dropping it would silently change what the model
 * sees, while throwing would strand a long session that merely carries one
 * historical attachment.
 */
function textOf(blocks: readonly ContentBlock[], helpers: SerializeHelpers): string {
  let text = ''
  for (const block of blocks) {
    if (block.type === 'text') text += block.text
    else if (block.type === 'image') text += '[image omitted: this route is text-only]'
    else if (block.type === 'file') text += fileTextOf(block.attachment, helpers)
    // reasoning / tool-call / tool-result are handled by their own call sites.
  }
  return text
}

/** Project one durable file reference to the text the model should read. */
function fileTextOf(ref: FileRef, helpers: SerializeHelpers): string {
  if (helpers.fileRequestText !== undefined) {
    try {
      return helpers.fileRequestText(ref)
    } catch {
      /* fall through to the neutral placeholder */
    }
  }
  return '[file attachment omitted: this route is text-only]'
}

/** Concatenate an assistant message's reasoning blocks (the reasoning回传 convention). */
function reasoningOf(blocks: readonly ContentBlock[]): string {
  let text = ''
  for (const block of blocks) {
    if (block.type === 'reasoning') text += block.text
  }
  return text
}
