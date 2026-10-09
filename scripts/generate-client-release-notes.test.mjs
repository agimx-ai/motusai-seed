import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it, expect } from 'vitest'
import { generateClientReleaseNotes } from './generate-client-release-notes.mjs'

async function fixture(run) {
  const root = await mkdtemp(join(tmpdir(), 'seed-release-notes-'))
  const directory = join(root, 'release-notes/seed/0.2.7')
  await mkdir(directory, { recursive: true })
  await mkdir(join(root, 'src/shared'), { recursive: true })
  await writeFile(join(root, 'package.json'), JSON.stringify({ version: '0.2.7' }))
  await writeFile(join(directory, 'metadata.json'), JSON.stringify({ version: '0.2.7' }))
  const notes = { 'zh-CN': '# Seed 0.2.7\n\n中文内容\n', en: '# Seed 0.2.7\n\nEnglish content\n' }
  for (const [locale, text] of Object.entries(notes)) await writeFile(join(directory, `${locale}.md`), text)
  try { await run({ root, directory, notes }) } finally { await rm(root, { recursive: true, force: true }) }
}

describe('Bundling local client release notes', () => {
  it('embeds exactly both local source files without any website checkout', async () => {
    await fixture(async ({ root, notes }) => {
      await generateClientReleaseNotes(root)
      const output = await readFile(join(root, 'src/shared/client-release-notes.generated.ts'), 'utf8')
      expect(output).toContain(JSON.stringify({ version: '0.2.7', notes }, null, 2))
      expect(output).not.toContain('motusai-seed-home')
      await generateClientReleaseNotes(root)
      expect(await readFile(join(root, 'src/shared/client-release-notes.generated.ts'), 'utf8')).toBe(output)
    })
  })
  it('fails for missing translation, empty contents or mismatched version', async () => {
    await fixture(async ({ root, directory }) => {
      await writeFile(join(directory, 'en.md'), '')
      await expect(generateClientReleaseNotes(root)).rejects.toThrow('Missing')
      await rm(join(directory, 'en.md'))
      await expect(generateClientReleaseNotes(root)).rejects.toThrow('ENOENT')
      await writeFile(join(directory, 'metadata.json'), JSON.stringify({ version: '0.2.6' }))
      await expect(generateClientReleaseNotes(root)).rejects.toThrow('mismatch')
    })
  })
})
