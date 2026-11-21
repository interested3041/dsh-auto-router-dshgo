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
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { LlmError } from '@deepseek-ai/dsh-llm';
/** Directory (inside the workspace) where generated media lands. */
const MEDIA_DIR = '.dsh-media';
/** Content type → file extension. */
function extensionOf(mediaType) {
    if (mediaType.includes('png'))
        return 'png';
    if (mediaType.includes('jpeg') || mediaType.includes('jpg'))
        return 'jpg';
    if (mediaType.includes('webp'))
        return 'webp';
    if (mediaType.includes('wav'))
        return 'wav';
    if (mediaType.includes('mpeg') || mediaType.includes('mp3'))
        return 'mp3';
    return 'bin';
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
export async function generateImage(client, model, prompt, cwd, signal) {
    const results = await client.generateImage(model, prompt, signal);
    const first = results[0];
    if (first === undefined || (first.url === undefined && first.b64 === undefined)) {
        throw new LlmError(`image model "${model}" returned no image payload`, 'EMPTY_RESPONSE');
    }
    let bytes;
    let extension = 'png';
    if (first.b64 !== undefined) {
        bytes = new Uint8Array(Buffer.from(first.b64, 'base64'));
    }
    else {
        const response = await fetch(first.url, { signal, redirect: 'follow' });
        if (!response.ok) {
            throw new LlmError(`image download failed with HTTP ${response.status}`, 'TRANSPORT');
        }
        extension = extensionOf(response.headers.get('content-type') ?? 'image/png');
        bytes = new Uint8Array(await response.arrayBuffer());
    }
    const directory = join(cwd, MEDIA_DIR);
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const file = join(directory, `image-${stamp}.${extension}`);
    const relative = `${MEDIA_DIR}/image-${stamp}.${extension}`;
    try {
        await mkdir(directory, { recursive: true });
        await writeFile(file, bytes);
    }
    catch (_mobileFsUnavailable) {
        // Mobile runtimes may lack a writable filesystem: keep the image in memory
        // and surface it as a data URI rather than failing the whole turn.
        const mime = extension === 'jpg' ? 'image/jpeg' : `image/${extension}`;
        const dataUri = `data:${mime};base64,${Buffer.from(bytes).toString('base64')}`;
        return {
            path: '',
            model,
            markdown: `已用 \`${model}\` 生成图片(本环境不落盘,内嵌显示)。\n\n![${prompt.slice(0, 60).replace(/[[\]]/g, ' ')}](${dataUri})`,
        };
    }
    return {
        path: file,
        model,
        markdown: [
            `已用 \`${model}\` 生成图片,保存在 \`${relative}\`。`,
            '',
            `![${prompt.slice(0, 60).replace(/[[\]]/g, ' ')}](${relative})`,
        ].join('\n'),
    };
}
