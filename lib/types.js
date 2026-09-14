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
export {};
