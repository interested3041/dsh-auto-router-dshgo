// Auto Router dshgo 0.6.0 — in-place self-update for the Android/proot engine.
//
// Mobile has no PowerShell and no user-visible "reinstall" flow, so the old
// desktop-style updater was a stub. This updater:
//   1. asks GitHub for the latest release (Node fetch, not pwsh);
//   2. downloads the release tarball and extracts it to a staging dir;
//   3. launches a detached POSIX shell script that stops the host, swaps only
//      the built lib/ (preserving node_modules and auto-router state), then
//      starts the same command line again.
// The script is detached, so killing the host does not kill the updater.
import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { chmod, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';
/** GitHub repo that publishes this plugin's releases. */
export const UPDATE_REPO = 'interested3041/dsh-auto-router-dshgo';
/** Install dir = parent of lib/ (where package.json + scripts/ live). */
export function installDir() {
    return dirname(dirname(fileURLToPath(import.meta.url)));
}
export function currentVersion() {
    try {
        const pkg = JSON.parse(readFileSync(join(installDir(), 'package.json'), 'utf8'));
        return pkg.version ?? '0.0.0';
    }
    catch {
        return '0.0.0';
    }
}
/** Numeric semver-ish compare: -1 a<b, 0 equal, 1 a>b. */
export function compareVersions(a, b) {
    const pa = String(a).replace(/^v/, '').split('.').map(x => parseInt(x, 10) || 0);
    const pb = String(b).replace(/^v/, '').split('.').map(x => parseInt(x, 10) || 0);
    for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
        const da = pa[i] ?? 0;
        const db = pb[i] ?? 0;
        if (da !== db)
            return da < db ? -1 : 1;
    }
    return 0;
}
/** Node fetch with a hard timeout and an actionable error. */
async function get(url, timeoutMs = 12_000) {
    if (typeof globalThis.fetch !== 'function')
        throw new Error('当前 Node 不支持 fetch,无法检查更新');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const response = await globalThis.fetch(url, {
            signal: controller.signal,
            headers: { 'user-agent': 'dsh-auto-router-dshgo-updater' },
            redirect: 'follow',
        });
        if (!response.ok)
            throw new Error(`GitHub HTTP ${response.status}`);
        return Buffer.from(await response.arrayBuffer());
    }
    finally {
        clearTimeout(timer);
    }
}
/** Query the latest release tag via Node fetch (works in Android/proot). */
export async function checkLatest(repo = UPDATE_REPO) {
    const current = currentVersion();
    const api = `https://api.github.com/repos/${repo}/releases/latest`;
    let latest = current;
    let error;
    try {
        const body = await get(api, 10_000);
        const parsed = JSON.parse(body.toString('utf8'));
        const tag = String(parsed.tag_name ?? '').trim();
        if (/^v?\d+\.\d+\.\d+/.test(tag))
            latest = tag.replace(/^v/, '');
        else
            error = `GitHub 返回了无法识别的发布版本:${tag || '(空)'}`;
    }
    catch (cause) {
        error = `检查更新失败:${String(cause?.message ?? cause)}`;
    }
    return {
        current,
        latest,
        hasUpdate: error === undefined && compareVersions(latest, current) > 0,
        url: `https://github.com/${repo}/releases/latest`,
        ...(error === undefined ? {} : { error }),
    };
}
/**
 * Minimal ustar/gzip extractor. Codeload tarballs are small; using Node's
 * gunzip avoids depending on tar/curl being installed inside the proot image.
 */
async function extractTarGzArchive(tarGz, destination) {
    const tar = gunzipSync(tarGz);
    let offset = 0;
    while (offset + 512 <= tar.length) {
        const header = tar.subarray(offset, offset + 512);
        const name = header.subarray(0, 100).toString('utf8').replace(/\0.*$/, '');
        const prefix = header.subarray(345, 500).toString('utf8').replace(/\0.*$/, '');
        const full = prefix.length > 0 ? `${prefix}/${name}` : name;
        const sizeRaw = header.subarray(124, 136).toString('utf8').trim();
        const size = sizeRaw.length === 0 ? 0 : parseInt(sizeRaw, 8) || 0;
        const type = String.fromCharCode(header[156] || 48);
        offset += 512;
        if (full.length === 0)
            continue;
        const clean = resolve(destination, full);
        if (!clean.startsWith(resolve(destination) + '/') && clean !== resolve(destination)) {
            throw new Error(`tar 包含越界路径:${full}`);
        }
        if (type === '5' || full.endsWith('/')) {
            await mkdir(clean, { recursive: true });
        }
        else if (type === '0' || type === '\0' || type === '7') {
            await mkdir(dirname(clean), { recursive: true });
            const file = tar.subarray(offset, offset + size);
            if (file.length !== size)
                throw new Error(`tar 文件被截断:${full}`);
            await writeFile(clean, file);
        }
        offset += Math.ceil(size / 512) * 512;
    }
}
/** POSIX single-quote safe literal. */
function shq(value) {
    return `'${value.replace(/'/g, `'\\''`)}'`;
}
/** Capture the exact command line that started this host, for respawn. */
function restartCommand() {
    const argv = process.argv.slice(1);
    return { node: process.execPath, args: argv, cwd: process.cwd() };
}
/**
 * Download, verify, and launch the detached in-place updater. Returns before
 * the host is stopped so the RPC reply can reach the panel.
 */
export async function applyUpdate(tag, repo = UPDATE_REPO) {
    const normalized = String(tag).replace(/^v/, '');
    if (!/^\d+\.\d+\.\d+$/.test(normalized))
        throw new Error('版本号格式不对,应形如 0.6.0');
    const dir = installDir();
    const stateDir = process.env.DSH_HOME
        ? join(process.env.DSH_HOME, 'auto-router')
        : join(dir, '.update');
    const work = join(stateDir, `update-${normalized}`);
    const archive = join(work, 'release.tar.gz');
    const stage = join(work, 'stage');
    await rm(work, { recursive: true, force: true });
    await mkdir(stage, { recursive: true });
    const url = `https://codeload.github.com/${repo}/tar.gz/refs/tags/v${normalized}`;
    let download;
    try {
        download = await get(url, 30_000);
    }
    catch (cause) {
        throw new Error(`下载 v${normalized} 失败:${String(cause?.message ?? cause)}`);
    }
    await writeFile(archive, download);
    await extractTarGzArchive(download, stage);
    const dirs = (await readdir(stage, { withFileTypes: true }))
        .filter(entry => entry.isDirectory())
        .map(entry => entry.name);
    if (dirs.length !== 1)
        throw new Error(`发布包结构异常:顶层目录 ${dirs.length} 个`);
    const root = join(stage, dirs[0] ?? '');
    const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
    if (pkg.name !== 'dsh-auto-router-dshgo')
        throw new Error(`发布包不是 dsh-auto-router-dshgo(${pkg.name ?? '?'})`);
    if (pkg.version !== normalized)
        throw new Error(`发布包版本不符:期望 ${normalized},实际 ${pkg.version ?? '?'}`);
    if (!existsSync(join(root, 'lib', 'index.js')))
        throw new Error('发布包缺少 lib/index.js');
    const command = restartCommand();
    const pid = process.pid;
    const shell = join(stage, 'apply-update.sh');
    const args = command.args.map(shq).join(' ');
    const port = process.env.DSH_PORT ?? process.env.DSH_WEB_PORT ?? process.env.PORT ?? '';
    const script = [
        '#!/bin/sh',
        'set -eu',
        `LOG=${shq(join(work, 'update.log'))}`,
        'exec >>"$LOG" 2>&1',
        `echo "[auto-router] update v${normalized} starting at $(date)"`,
        'sleep 2',
        `PID=${pid}`,
        `INSTALL=${shq(dir)}`,
        `NEW=${shq(root)}`,
        `PORT=${shq(port)}`,
        `BACKUP="$INSTALL/lib.bak-$(date +%s)"`,
        'kill -TERM "$PID" 2>/dev/null || true',
        'i=0',
        'while kill -0 "$PID" 2>/dev/null && [ "$i" -lt 20 ]; do sleep 1; i=$((i+1)); done',
        'kill -KILL "$PID" 2>/dev/null || true',
        'if [ -d "$INSTALL/lib" ]; then mv "$INSTALL/lib" "$BACKUP"; fi',
        'if ! mv "$NEW/lib" "$INSTALL/lib"; then',
        '  [ -d "$BACKUP" ] && mv "$BACKUP" "$INSTALL/lib"',
        '  echo "[auto-router] lib swap failed; old lib restored"',
        '  exit 1',
        'fi',
        `cp "$NEW/package.json" "$INSTALL/package.json"`,
        `[ -f "$NEW/README.md" ] && cp "$NEW/README.md" "$INSTALL/README.md" || true`,
        `[ -f "$NEW/CHANGELOG.md" ] && cp "$NEW/CHANGELOG.md" "$INSTALL/CHANGELOG.md" || true`,
        'echo "[auto-router] lib swapped; restarting host"',
        'if [ -n "$PORT" ] && command -v curl >/dev/null 2>&1; then',
        '  i=0',
        '  while [ "$i" -lt 15 ]; do',
        '    if curl -fsS "http://127.0.0.1:$PORT/" >/dev/null 2>&1; then echo "[auto-router] host already back"; exit 0; fi',
        '    sleep 1; i=$((i+1))',
        '  done',
        'fi',
        `cd ${shq(command.cwd)}`,
        `nohup ${shq(command.node)} ${args} >>"$LOG" 2>&1 &`,
        'echo "[auto-router] respawned pid $!"',
    ].join('\n');
    await writeFile(shell, script, 'utf8');
    await chmod(shell, 0o755);
    try {
        const child = spawn('sh', [shell], {
            detached: true,
            stdio: 'ignore',
            cwd: stateDir,
            env: process.env,
        });
        child.unref();
    }
    catch (cause) {
        throw new Error(`更新脚本启动失败:${String(cause?.message ?? cause)}`);
    }
    return {
        started: true,
        restarting: true,
        message: `v${normalized} 已下载并校验,正在停宿主→替换 lib→重启;约 30 秒后刷新页面。若页面未自动恢复,请在 DSH 里点一次“重启引擎”(配置与 node_modules 均保留,不需要重装)。`,
    };
}
