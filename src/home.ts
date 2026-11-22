/**
 * Local user-data path helpers.
 *
 * Implemented here rather than imported so the plugin loads with no
 * `@deepseek-ai/*` import beyond the two it cannot avoid (the LLM adapter base
 * class and the Config schema builder) — fewer specifiers to resolve means
 * fewer ways for a directory install to fail activation.
 */
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'

/** Environment variable that overrides the default harness home. */
const DSH_HOME_ENV = 'DSH_HOME'

/**
 * Resolve the DeepSeek Harness home: `$DSH_HOME`, then `~/.dsh`.
 * @param env - environment mapping, defaults to the process environment.
 * @returns the absolute home directory.
 */
export function resolveDshHome(env: Record<string, string | undefined> = process.env): string {
  const configured = env[DSH_HOME_ENV]
  const selected = configured !== undefined && configured.trim().length > 0 ? configured : join(homedir(), '.dsh')
  return resolve(selected)
}

/**
 * Join path segments onto the harness home.
 * @param segments - segments appended after the home.
 */
export function dshHomePath(...segments: string[]): string {
  return join(resolveDshHome(), ...segments)
}