/**
 * Key identity, connection de-duplication and display-name helpers.
 *
 * A "key" is the unit of the local token ledger. Saved accounts use their
 * stable id; auto-discovered connections and bare endpoints are fingerprinted
 * from endpoint + credential so the same physical key keeps one ledger even
 * when it is reached through different discovery paths.
 */
import { createHash } from 'node:crypto'
import { PROVIDER, VIRTUAL_MODEL } from './catalog.js'

const sha1 = (text: string): string => createHash('sha1').update(text).digest('hex').slice(0, 16)

/** Stable ledger id of a user-saved account. */
export function accountKeyId(accountId: string): string {
  return `acct:${accountId}`
}

/** Ledger id of an auto-discovered connection (endpoint + credential + hint). */
export function discoveredKeyId(baseURL: string, credentialRef: string, keyHint: string): string {
  return `disc:${sha1(`${baseURL.replace(/\/+$/, '')}|${credentialRef}|${keyHint}`)}`
}

/** Ledger id of a bare configured endpoint (no saved account, no discovery). */
export function endpointKeyId(baseURL: string, apiKeyEnv: string): string {
  return `ep:${sha1(`${baseURL.replace(/\/+$/, '')}|${apiKeyEnv}`)}`
}

/** Resolve the ledger id for the connection actually in use. */
export function resolveKeyId(input: {
  activeAccountId?: string
  discovered?: { credentialRef: string; keyHint: string }
  baseURL: string
  apiKeyEnv: string
}): string {
  if (input.activeAccountId) return accountKeyId(input.activeAccountId)
  if (input.discovered) return discoveredKeyId(input.baseURL, input.discovered.credentialRef, input.discovered.keyHint)
  return endpointKeyId(input.baseURL, input.apiKeyEnv)
}

/** One discoverable / saved connection as the panel lists it. */
export interface ConnectionView {
  id: string
  name: string
  providerId?: string
  baseURL: string
  credentialRef?: string
  keyHint?: string
  vendor?: string
  /** 'saved' | 'discovered' | 'endpoint' */
  kind: 'saved' | 'discovered' | 'endpoint'
}

/** Fingerprint used to collapse duplicate connections to the same physical key. */
export function connectionFingerprint(connection: ConnectionView): string {
  return `${connection.baseURL.replace(/\/+$/, '')}|${connection.credentialRef ?? ''}|${connection.keyHint ?? ''}`
}

/**
 * Drop the plugin's own provider / virtual model (never a switchable account)
 * and collapse duplicates that point at the same endpoint + credential.
 */
export function dedupeConnections(connections: readonly ConnectionView[]): ConnectionView[] {
  const seen = new Set<string>()
  const out: ConnectionView[] = []
  // The plugin's own rows (current, package and legacy component ids) are never
  // switchable accounts.
  const selfIds = new Set(['auto-router', 'dsh-auto-router', 'bailian-auto-router'])
  for (const connection of connections) {
    const idText = `${connection.id} ${connection.providerId ?? ''} ${connection.name}`
    if (idText.includes(PROVIDER) || idText.includes(VIRTUAL_MODEL)
      || selfIds.has(connection.id) || selfIds.has(connection.providerId ?? '')) continue
    const fingerprint = connectionFingerprint(connection)
    if (seen.has(fingerprint)) continue
    seen.add(fingerprint)
    out.push(connection)
  }
  return out
}

/** Primary label: the user's own name; secondary: provider id (never id-first). */
export function connectionLabel(connection: ConnectionView): string {
  return connection.name || connection.providerId || connection.id
}

/**
 * 0.6 user-pinned model directive on a plain-text message: a leading
 * `/model <id>` or `@model:<id>` token pins the next request; the token is
 * stripped from the text sent upstream. Null when no directive is present.
 */
export function parseUserModelDirective(text: string): { model: string; rest: string } | null {
  const match = /^\s*(?:\/model\s+|@model:)([A-Za-z0-9._/-]+)\s*/.exec(text)
  if (match === null) return null
  const model = match[1] ?? ''
  return { model, rest: text.slice(match[0].length) }
}
