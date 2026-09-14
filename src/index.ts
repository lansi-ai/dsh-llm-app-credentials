/**
 * `dsh-llm-app-credentials` — an LLM adapter whose credential comes from another
 * local application's file rather than a standard API key.
 *
 * Why this exists as its own plugin: the generic OpenAI-compatible adapter
 * already covers "configure an API key". The one thing it cannot do is take the
 * credential from an application that manages its own session — so this plugin's
 * identity describes that **mechanism**, and nothing about any vendor. A route is
 * whatever key the user writes under `providers`; the shipped detection table
 * (see `detect.ts`) is a convenience layered underneath the configuration, never
 * a hard-coded upstream.
 *
 * Layering, highest wins:
 *   1. the settings user section      (`settings.installSection` user layer)
 *   2. this plugin's entry config     (composition base)
 *   3. built-in detection             (only when the credential file exists)
 *   4. schema defaults
 *
 * @module dsh-llm-app-credentials
 */

import { createRequire } from 'node:module'
import type { Context } from '@deepseek-ai/cordis'
import type { } from '@deepseek-ai/dsh-settings'
import type { AdapterRegistrationHandle } from '@deepseek-ai/dsh-llm'
import { AppCredentialsAdapter } from './adapter.js'
import { ConfigSchema } from './config.js'
import { detectProviders } from './detect.js'
import type { Config, ProviderConfig } from './types.js'

/** Plugin id; also the settings namespace and the client-half module id. */
export const name = 'llm-app-credentials'

/** The LLM seam is the whole point: the adapter is registered onto it. */
export const inject = ['llm']

/** Settings namespace. Lowercase-hyphenated, and free of any vendor name. */
export const NS = 'llm-app-credentials'

/**
 * White-label attribution identity.
 *
 * **Must be given explicitly.** Omitting it makes the adapter send the harness
 * default (`deepseek-harness`), which this upstream family refuses with HTTP 400
 * `{"code":11128,"msg":"request illegal"}`. It is also the fallback for a route
 * that declares no attribution of its own, so a forgotten field cannot turn into
 * an opaque failure.
 */
export const PLUGIN_IDENTITY = {
  product: 'app-credentials',
  version: readOwnVersion(),
  url: 'https://example.invalid',
} as const

/** Configuration schema, exported for the loader to validate the plugin row. */
export { ConfigSchema as Config } from './config.js'

/**
 * Register one adapter for every configured route.
 *
 * @param ctx - plugin context (holds `llm`, and optionally `settings`).
 * @param config - the plugin row's configuration (the composition base layer).
 */
export function apply(ctx: Context, config: Config): void {
  // Detection sits *below* the configuration: a route from `config` wins field by
  // field, so a user can correct one detected field without restating the route.
  let current: () => Config = () => ({ providers: mergeProviders(detectProviders(), config.providers) })

  const adapter = new AppCredentialsAdapter({
    providers: () => current().providers,
    fallbackIdentity: PLUGIN_IDENTITY,
    fileRequestText: (ref) => ctx.llm.fileRequestText(ref),
  })

  let registration: AdapterRegistrationHandle | undefined
  let registeredRoutes: string | undefined

  /**
   * Bring the registered route set in line with the current configuration.
   *
   * Route names are compared sorted, so a settings document that merely reorders
   * its keys is not mistaken for a route change and cannot churn the registry.
   */
  const ensureRegistration = (): void => {
    const routes = Object.keys(current().providers).sort()
    const facts = routes.join('\u0000')
    if (facts === registeredRoutes) return
    if (registration === undefined) {
      // An empty initial registration is illegal; zero routes is a dormant plugin.
      if (routes.length === 0) {
        registeredRoutes = facts
        return
      }
      registration = ctx.llm.registerAdapter(routes, adapter)
    } else {
      registration.replace(routes)
    }
    registeredRoutes = facts
  }

  ensureRegistration()

  // Settings is optional on purpose: without it the plugin still serves the entry
  // config and the detected routes, which is exactly the zero-config case.
  //
  // The whole call is wrapped because a throw HERE is contained by Cordis — the
  // boot still succeeds, the routes still work, and the only symptom is a
  // settings page that reports the namespace as unavailable with no terminal
  // trace. A registration failure has to be loud or it looks like the plugin
  // half-loaded.
  ctx.inject(['settings'], (settingsCtx) => {
    try {
      settingsCtx.settings.installSection(ctx, NS, ConfigSchema, { providers: mergeProviders(detectProviders(), config.providers) }, {
        setSource: (source) => {
          current = source
        },
        onChange: () => {
          try {
            ensureRegistration()
          } catch (error) {
            ctx.logger.error('llm-app-credentials: keeping the previously registered routes after a refused update')
            ctx.logger.error(error)
          }
        },
      })
    } catch (error) {
      ctx.logger.error(
        `llm-app-credentials: settings namespace "${NS}" could not be registered, so the settings page will show it as unavailable. ` +
          'The model routes themselves are unaffected.',
      )
      ctx.logger.error(error)
    }
  })
}

/**
 * Overlay configured routes onto detected ones.
 *
 * Merging is per field for the route's own scalars and for its nested
 * `credential` / `quirks` objects, so correcting the credential file path keeps
 * the detected token paths.
 */
function mergeProviders(
  detected: Record<string, ProviderConfig>,
  configured: Record<string, ProviderConfig>,
): Record<string, ProviderConfig> {
  const merged: Record<string, ProviderConfig> = { ...detected }
  for (const [route, profile] of Object.entries(configured)) {
    const base = detected[route]
    merged[route] = {
      ...base,
      ...profile,
      credential: { ...base?.credential, ...profile.credential },
      quirks: { ...base?.quirks, ...profile.quirks },
    }
  }
  return merged
}

/** Read this package's own version, falling back rather than failing the boot. */
function readOwnVersion(): string {
  try {
    const require = createRequire(import.meta.url)
    const pkg = require('../package.json') as { version?: unknown }
    return typeof pkg.version === 'string' && pkg.version.length > 0 ? pkg.version : '0.0.0'
  } catch {
    return '0.0.0'
  }
}
