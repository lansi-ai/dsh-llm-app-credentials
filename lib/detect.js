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
import { existsSync } from 'node:fs';
import { join } from 'node:path';
/**
 * Credential-file locations, relative to `%LOCALAPPDATA%`.
 *
 * Model lists are the ones verified against each deployment by the reference
 * gateway (`wb-proxy.js`). They are **per-deployment**: the two editions are
 * independent installs whose catalogs only partially overlap, so the list must
 * travel with the endpoint. Only the capacities that were actually documented
 * are declared; the rest are left unset rather than guessed.
 *
 * `inputModalities` is declared **only** where the deployment is known to accept
 * image input (the V4.1 model does). It is a statement about what this plugin may
 * send, and the harness refuses an image on a route that omits it, so a wrong
 * declaration here is visible immediately rather than silent. A deployment whose
 * gateway rejects images should drop the field for that model in the user
 * settings layer.
 */
const AUTH_DIR = join('CodeBuddyExtension', 'Data', 'Public', 'auth');
const KNOWN_SOURCES = [
    {
        route: 'workbuddy',
        displayName: 'WorkBuddy',
        baseURL: 'https://www.workbuddy.ai/v2',
        authFileName: 'workbuddy-desktop-ai.info',
        models: [
            {
                id: 'deepseek-v4.1-flash',
                name: 'DeepSeek V4.1 Flash',
                contextWindow: 300000,
                maxTokens: 128000,
                inputModalities: ['text', 'image'],
            },
            { id: 'glm-5.3' },
            { id: 'glm-5.2' },
            { id: 'minimax-m3' },
            { id: 'kimi-k2.7' },
            { id: 'kimi-k2.6' },
            { id: 'kimi-k2.5' },
            { id: 'hy4-preview' },
            { id: 'hy3' },
            { id: 'gpt-6-astra' },
            { id: 'gpt-5.6-sol' },
            { id: 'gpt-5.6-terra' },
        ],
    },
    {
        route: 'workbuddy-cn',
        displayName: 'WorkBuddy（国内版）',
        baseURL: 'https://www.codebuddy.cn/v2',
        authFileName: 'workbuddy-desktop.info',
        models: [
            { id: 'deepseek-v4.1-flash', inputModalities: ['text', 'image'] },
            { id: 'deepseek-v4-pro' },
            { id: 'deepseek-v4-flash' },
            { id: 'deepseek-v3-2-volc' },
            { id: 'glm-5.3' },
            { id: 'glm-5.3-flash' },
            { id: 'glm-5.2' },
            { id: 'minimax-m3' },
            { id: 'kimi-k3-1' },
            { id: 'kimi-k2.7' },
            { id: 'kimi-k2.6' },
            { id: 'kimi-k2.5' },
            { id: 'hy4-preview' },
            { id: 'hy4-preview-dev' },
            { id: 'hy3' },
            { id: 'hy3-x' },
        ],
    },
];
/** Shared credential dot paths for the known sources (verified against the live file). */
const CREDENTIAL_PATHS = { token: 'auth.accessToken', uid: 'account.uid', expiresAt: 'auth.expiresAt' };
/** The directory those applications keep their credential files in, or undefined when undetectable. */
export function authDirectory() {
    const localAppData = process.env['LOCALAPPDATA'];
    if (localAppData === undefined || localAppData.length === 0)
        return undefined;
    return join(localAppData, AUTH_DIR);
}
/**
 * Build the detected route set for this machine.
 *
 * @returns route → profile for every known source whose credential file exists;
 *   an empty object when nothing is installed (a perfectly valid deployment).
 */
export function detectProviders() {
    const directory = authDirectory();
    if (directory === undefined)
        return {};
    const detected = {};
    for (const source of KNOWN_SOURCES) {
        const file = join(directory, source.authFileName);
        if (!existsSync(file))
            continue;
        detected[source.route] = {
            displayName: source.displayName,
            baseURL: source.baseURL,
            credential: { file, ...CREDENTIAL_PATHS },
            models: source.models,
        };
    }
    return detected;
}
