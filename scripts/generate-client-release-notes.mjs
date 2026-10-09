import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const root = resolve(import.meta.dirname, '..')

// This only embeds local source files. The existing release CI remains the
// authority for editorial/content validation and website synchronization.
export async function generateClientReleaseNotes(projectRoot) {
  const { version } = JSON.parse(await readFile(resolve(projectRoot, 'package.json'), 'utf8'))
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) throw new Error('Invalid client version.')
  const directory = resolve(projectRoot, 'release-notes', 'seed', version)
  const metadata = JSON.parse(await readFile(resolve(directory, 'metadata.json'), 'utf8'))
  if (metadata.version !== version) throw new Error('Release note version mismatch.')
  const notes = Object.fromEntries(await Promise.all(['zh-CN', 'en'].map(async (locale) => {
    const markdown = await readFile(resolve(directory, `${locale}.md`), 'utf8')
    if (!markdown.trim()) throw new Error(`Missing client release notes: ${locale}.`)
    return [locale, markdown]
  })))
  const contents = '// Generated from local release-notes source. Do not edit or commit.\n'
    + `export const clientReleaseNotes = ${JSON.stringify({ version, notes }, null, 2)} as const\n`
  const target = resolve(projectRoot, 'src/shared/client-release-notes.generated.ts')
  let previous
  try { previous = await readFile(target, 'utf8') } catch { /* First generation. */ }
  if (previous !== contents) await writeFile(target, contents)
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) await generateClientReleaseNotes(root)
