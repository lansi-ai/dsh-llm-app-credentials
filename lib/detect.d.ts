/**
 * Built-in detection of credential files already on this machine.
 *
 * ## Why a vendor table lives in the code at all
 *
 * The plugin's package name, plugin id and settings namespace deliberately carry
 * **no vendor name**, because the plugin's identity is "credentials come from
 * another local application" — not "credentials come from application X". Adding
 * a second application is a configuration edit, never a code change.
 *
 * Auto-detection is the one place that cannot avoid naming an application: to
 * find a file without being told, the plugin must know where that application
 * keeps it. So the knowledge is confined here, as a plain data table, and it is
 * strictly an **optional convenience**:
 *
 *   - an explicit `providers` entry always wins over a detected one, per field;
 *   - with the table emptied or absent, the plugin still works fully — every
 *     route simply has to be configured by hand.
 *
 * Detection only runs when the file actually exists, and it never reads the file
 * (contents, including the token, are read per request by `credential.ts`).
 *
 * @module dsh-llm-app-credentials/detect
 */
import type { ProviderConfig } from './types.js';
/** The directory those applications keep their credential files in, or undefined when undetectable. */
export declare function authDirectory(): string | undefined;
/**
 * Build the detected route set for this machine.
 *
 * @returns route → profile for every known source whose credential file exists;
 *   an empty object when nothing is installed (a perfectly valid deployment).
 */
export declare function detectProviders(): Record<string, ProviderConfig>;
