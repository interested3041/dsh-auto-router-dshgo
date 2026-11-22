/**
 * Media execution: image generation routed to the account's own image models.
 *
 * The Bailian-compatible surface serves image models through
 * `POST /images/generations` (verified against this deployment), returning a
 * short-lived URL or a base64 payload. The router converts that into a normal
 * assistant text reply: the file is saved inside the session workspace and the
 * reply carries a Markdown link, so the user gets a usable artifact instead of
 * a chat answer from a model that cannot draw.
 */
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { LlmError } from '@deepseek-ai/dsh-llm'
import type { BailianClient } from './http.js'

/** Outcome of one media generation. */
export interface MediaResult {
  /** Saved file path (absolute). */
  path: string
  /** Markdown the assistant reply carries. */
  markdown: string
  /** Model that produced the artifact. */
  model: string
}

/** Directory (inside the workspace) where generated media lands. */
const MEDIA_DIR = '.dsh-media'

/** Content type → file extension. */
function extensionOf(mediaType: string): string {
  if (mediaType.includes('png')) return 'png'
  if (mediaType.includes('jpeg') || mediaType.includes('jpg')) return 'jpg'
  if (mediaType.includes('webp')) return 'webp'
  if (mediaType.includes('wav')) return 'wav'
  if (mediaType.includes('mpeg') || mediaType.includes('mp3')) return 'mp3'
  return 'bin'
}

/**
 * Generate one image and save it under `<cwd>/.dsh-media/`.
 * @param client - endpoint client.
 * @param model - image model id.
 * @param prompt - the user's description.
 * @param cwd - session workspace directory.
 * @param signal - cancellation.
 * @returns the saved artifact description.
 */
export async function generateImage(
  client: BailianClient, model: string, prompt: string, cwd: string, signal?: AbortSignal,
): Promise<MediaResult> {
  const results = await client.generateImage(model, prompt, signal)
  const first = results[0]
  if (first === undefined || (first.url === undefined && first.b64 === undefined)) {
    throw new LlmError(`image model "${model}" returned no image payload`, 'EMPTY_RESPONSE')
  }
  let bytes: Uint8Array
  let extension = 'png'
  if (first.b64 !== undefined) {
    bytes = new Uint8Array(Buffer.from(first.b64, 'base64'))
  } else {
    const response = await fetch(first.url as string, { signal, redirect: 'follow' })
    if (!response.ok) {
      throw new LlmError(`image download failed with HTTP ${response.status}`, 'TRANSPORT')
    }
    extension = extensionOf(response.headers.get('content-type') ?? 'image/png')
    bytes = new Uint8Array(await response.arrayBuffer())
  }
  const directory = join(cwd, MEDIA_DIR)
  await mkdir(directory, { recursive: true })
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const file = join(directory, `image-${stamp}.${extension}`)
  await writeFile(file, bytes)
  const relative = `${MEDIA_DIR}/image-${stamp}.${extension}`
  return {
    path: file,
    model,
    markdown: [
      `已用 \`${model}\` 生成图片,保存在 \`${relative}\`。`,
      '',
      `![${prompt.slice(0, 60).replace(/[[\]]/g, ' ')}](${relative})`,
    ].join('\n'),
  }
}