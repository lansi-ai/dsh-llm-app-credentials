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
import type { ContentBlock, GenerateOptions, Message } from '@deepseek-ai/dsh-llm';
import type { ProviderConfig, RequestImage } from './types.js';
/** A durable file reference, taken from the block union so no extra package is imported. */
export type FileRef = Extract<ContentBlock, {
    type: 'file';
}>['attachment'];
/** A durable image reference, taken from the same union for the same reason. */
export type ImageRefOf = Extract<ContentBlock, {
    type: 'image';
}>['attachment'];
/** Host-side projections the serializer needs for content it cannot render itself. */
export interface SerializeHelpers {
    /**
     * Official projection of one durable file occurrence to model-visible handle
     * text (`LlmRuntime.fileRequestText`). Absent when the runtime is unreachable,
     * in which case a plain placeholder is substituted.
     */
    fileRequestText?: (ref: FileRef) => string;
    /**
     * Prepared request images keyed by attachment id, supplied only when the
     * route's model declares `image` and the request actually carries one. Absent
     * means no image may be sent, which is what keeps a text-only route on the
     * degradation path.
     */
    requestImages?: ReadonlyMap<string, RequestImage>;
}
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
export declare function collectImageRefs(messages: readonly Message[]): ImageRefOf[];
/**
 * Build the upstream request body for one call.
 *
 * @param options - the fully assembled harness request.
 * @param provider - the route's configuration (supplies the quirk switches).
 * @param helpers - host-side projections for non-text content.
 * @returns a plain JSON-serializable body.
 */
export declare function buildRequestBody(options: GenerateOptions, provider: ProviderConfig, helpers?: SerializeHelpers): Record<string, unknown>;
