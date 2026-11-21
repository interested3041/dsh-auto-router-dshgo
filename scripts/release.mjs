/**
 * Create the GitHub Release for a tag, with the body taken verbatim from the
 * matching CHANGELOG section. Reads and writes everything as UTF-8 so the
 * Chinese text is not mangled by the shell's code page.
 *
 * Usage: node scripts/release.mjs <tag> <release-title>
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const [tag, title] = process.argv.slice(2)
if (!tag || !title) {
  console.error('usage: node scripts/release.mjs <tag> <title>')
  process.exit(2)
}

const text = readFileSync(join(root, 'CHANGELOG.md'), 'utf8')
const marker = `## [${tag.replace(/^v/, '')}]`
const start = text.indexOf(marker)
if (start < 0) {
  console.error(`CHANGELOG has no section for ${marker}`)
  process.exit(1)
}
const next = text.indexOf('\n## [', start + marker.length)
const section = next > start ? text.slice(start, next) : text.slice(start)
const body = section.replace(new RegExp(`^## \\[${tag.replace(/^v/, '').replace(/\./g, '\\.')}\\][^\\n]*\\n`), '').trim()

const credentials = readFileSync('C:\\Users\\30410\\.git-credentials', 'utf8')
  .split('\n')
  .map(line => /^https?:\/\/([^:]+):(.+)@github\.com/.exec(line.trim()))
  .find(match => match !== null)
if (!credentials) {
  console.error('no github.com credential found')
  process.exit(1)
}
const token = credentials[2]

const payload = JSON.stringify({
  tag_name: tag,
  name: title,
  body,
  draft: false,
  prerelease: false,
})

const response = await fetch('https://api.github.com/repos/interested3041/dsh-auto-router-dshgo/releases', {
  method: 'POST',
  headers: {
    authorization: `Bearer ${token}`,
    'user-agent': 'dsh-release',
    accept: 'application/vnd.github+json',
    'content-type': 'application/json; charset=utf-8',
  },
  body: payload,
})
const result = await response.json()
if (!response.ok) {
  console.error(`release creation failed: HTTP ${response.status}`)
  console.error(JSON.stringify(result).slice(0, 600))
  process.exit(1)
}
console.log(`release id   : ${result.id}`)
console.log(`tag          : ${result.tag_name}`)
console.log(`name         : ${result.name}`)
console.log(`draft        : ${result.draft} | prerelease: ${result.prerelease}`)
console.log(`body length  : ${(result.body ?? '').length} chars`)
console.log(`url          : ${result.html_url}`)