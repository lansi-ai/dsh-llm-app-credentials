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
import type { ContentBlock, GenerateOptions } from '@deepseek-ai/dsh-llm';
import type { ProviderConfig } from './types.js';
/** A durable file reference, taken from the block union so no extra package is imported. */
export type FileRef = Extract<ContentBlock, {
    type: 'file';
}>['attachment'];
/** Host-side projections the serializer needs for content it cannot render itself. */
export interface SerializeHelpers {
    /**
     * Official projection of one durable file occurrence to model-visible handle
     * text (`LlmRuntime.fileRequestText`). Absent when the runtime is unreachable,
     * in which case a plain placeholder is substituted.
     */
    fileRequestText?: (ref: FileRef) => string;
}
/**
 * Build the upstream request body for one call.
 *
 * @param options - the fully assembled harness request.
 * @param provider - the route's configuration (supplies the quirk switches).
 * @param helpers - host-side projections for non-text content.
 * @returns a plain JSON-serializable body.
 */
export declare function buildRequestBody(options: GenerateOptions, provider: ProviderConfig, helpers?: SerializeHelpers): Record<string, unknown>;
