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
 * An image note: this route sends an image only for a model the route declares
 * as image-capable, and only when the caller supplied the prepared bytes (see
 * `SerializeHelpers.requestImages`). Everything else — including every
 * text-only route — keeps the earlier behaviour of degrading an image to an
 * explicit text note, because dropping it would silently change what the model
 * sees while throwing would strand a long session that merely carries one
 * historical attachment.
 *
 * @module dsh-llm-app-credentials/serialize
 */

import type { ContentBlock, GenerateOptions, Message } from '@deepseek-ai/dsh-llm'
import { OFF_EFFORT } from './config.js'
import type {
  ProviderConfig,
  RequestImage,
  WireContentPart,
  WireImagePart,
  WireMessage,
  WireTool,
  WireToolCallOut,
} from './types.js'

/** A durable file reference, taken from the block union so no extra package is imported. */
export type FileRef = Extract<ContentBlock, { type: 'file' }>['attachment']

/** A durable image reference, taken from the same union for the same reason. */
export type ImageRefOf = Extract<ContentBlock, { type: 'image' }>['attachment']

/** Host-side projections the serializer needs for content it cannot render itself. */
export interface SerializeHelpers {
  /**
   * Official projection of one durable file occurrence to model-visible handle
   * text (`LlmRuntime.fileRequestText`). Absent when the runtime is unreachable,
   * in which case a plain placeholder is substituted.
   */
  fileRequestText?: (ref: FileRef) => string
  /**
   * Prepared request images keyed by attachment id, supplied only when the
   * route's model declares `image` and the request actually carries one. Absent
   * means no image may be sent, which is what keeps a text-only route on the
   * degradation path.
   */
  requestImages?: ReadonlyMap<string, RequestImage>
}

/** Default system prompt for the `ensureSystemFirst` switch. */
const DEFAULT_SYSTEM_PROMPT = 'You are a helpful assistant.'

/** Text standing in for an image that cannot ride this wire. */
const IMAGE_OMITTED = '[image omitted: this route is text-only]'

/** Lead-in text for images lifted out of a tool result (see {@link toWireMessages}). */
const TOOL_RESULT_IMAGE_NOTE = 'Image(s) returned by the previous tool result:'

/**
 * Collect every durable image reference a request carries, in first-seen order.
 *
 * The caller resolves these before serialization because reading image bytes is
 * asynchronous and this module stays synchronous. Tool-result content is
 * traversed because that is where a tool that returned an image puts it.
 *
 * @param messages - the request's message list.
 * @returns the distinct image references the request mentions.
 */
export function collectImageRefs(messages: readonly Message[]): ImageRefOf[] {
  const refs = new Map<string, ImageRefOf>()
  const visit = (blocks: readonly ContentBlock[]): void => {
    for (const block of blocks) {
      if (block.type === 'image') refs.set(String(block.attachment.attachmentId), block.attachment)
      else if (block.type === 'tool-result') visit(block.content)
    }
  }
  for (const message of messages) visit(message.content)
  return [...refs.values()]
}

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
        const nested = contentOf(block.content, helpers)
        out.push({
          role: 'tool',
          tool_call_id: String(block.toolCallId),
          content: typeof nested === 'string' ? nested : textOfParts(nested),
        })
        // This wire cannot carry an image on a `tool` message, so a tool result
        // that returned one is followed by a user message carrying it: the image
        // is the whole point of the tool call that produced it, and dropping it
        // would leave the model answering about a picture it never saw.
        const images = imagePartsOf(nested)
        if (images.length > 0) {
          out.push({
            role: 'user',
            content: [{ type: 'text', text: TOOL_RESULT_IMAGE_NOTE }, ...images],
          })
        }
      } else {
        parts.push(block)
      }
    }
    if (parts.length > 0) out.push({ role: 'user', content: contentOf(parts, helpers) })
  }
  return out
}

/**
 * Render blocks as plain text.
 *
 * Used for every message that cannot carry an image (system and assistant
 * turns) and for the text projection of a tool result.
 */
function textOf(blocks: readonly ContentBlock[], helpers: SerializeHelpers): string {
  let text = ''
  for (const block of blocks) {
    if (block.type === 'text') text += block.text
    else if (block.type === 'image') text += IMAGE_OMITTED
    else if (block.type === 'file') text += fileTextOf(block.attachment, helpers)
    // reasoning / tool-call / tool-result are handled by their own call sites.
  }
  return text
}

/**
 * Render blocks as text, or as a multimodal part list when they carry an image
 * the route can actually receive.
 *
 * A plain string is returned whenever no image survives, so a request without
 * usable images keeps the exact wire shape it had before this option existed.
 */
function contentOf(blocks: readonly ContentBlock[], helpers: SerializeHelpers): string | WireContentPart[] {
  const parts: WireContentPart[] = []
  let pending = ''
  const flush = (): void => {
    if (pending.length === 0) return
    parts.push({ type: 'text', text: pending })
    pending = ''
  }
  for (const block of blocks) {
    if (block.type === 'text') pending += block.text
    else if (block.type === 'file') pending += fileTextOf(block.attachment, helpers)
    else if (block.type === 'image') {
      const part = imagePartOf(block.attachment, helpers)
      if (part === undefined) pending += IMAGE_OMITTED
      else {
        flush()
        parts.push(part)
      }
    }
  }
  if (parts.length === 0) return pending
  flush()
  return parts
}

/** One request image as an inline `image_url` part, or undefined when its bytes are unavailable. */
function imagePartOf(ref: ImageRefOf, helpers: SerializeHelpers): WireImagePart | undefined {
  const image = helpers.requestImages?.get(String(ref.attachmentId))
  if (image === undefined) return undefined
  return {
    type: 'image_url',
    image_url: { url: `data:${image.mediaType};base64,${Buffer.from(image.data).toString('base64')}` },
  }
}

/** The image parts of a rendered part list, in order. */
function imagePartsOf(content: string | WireContentPart[]): WireImagePart[] {
  if (typeof content === 'string') return []
  return content.filter((part): part is WireImagePart => part.type === 'image_url')
}

/** The text projection of a rendered part list. */
function textOfParts(content: readonly WireContentPart[]): string {
  return content.map((part) => (part.type === 'text' ? part.text : '')).join('')
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
