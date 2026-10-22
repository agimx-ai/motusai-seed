import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { test } from 'node:test'
import { promisify } from 'node:util'
import { publishSdk } from './publish-sdk.mjs'

const packageName = '@motus-ai/seed-sdk'

test('npm build metadata normalization cannot break bound version equality', async () => {
  await assert.rejects(publishSdk('unused.tgz', '0.3.10+build.1'), /build metadata/)
})

async function fixture(t, version = '0.3.10', name = packageName) {
  const root = await mkdtemp(resolve(tmpdir(), 'seed-sdk-publication-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  await mkdir(resolve(root, 'package'))
  await writeFile(resolve(root, 'package/package.json'), JSON.stringify({ name, version }))
  const tarball = resolve(root, 'SDK fixture.tgz')
  await promisify(execFile)('tar', ['-czf', tarball, '-C', root, 'package'])
  const integrity = `sha512-${createHash('sha512').update(await readFile(tarball)).digest('base64')}`
  return { tarball, integrity }
}

for (const [version, tag] of [['0.3.10', 'latest'], ['0.4.0-rc.1', 'beta']]) {
  test(`a missing npm version publishes the exact tarball to ${tag}`, async (t) => {
    const { tarball } = await fixture(t, version)
    const calls = []
    const result = await publishSdk(tarball, version, {
      fetchMetadata: async (url) => {
        assert.equal(url, `https://registry.npmjs.org/@motus-ai%2fseed-sdk/${version}`)
        return new Response(null, { status: 404 })
      },
      publish: async (args) => calls.push(args),
    })
    assert.match(result, /Published SDK/)
    assert.deepEqual(calls, [['publish', tarball, '--access', 'public', '--tag', tag, '--registry', 'https://registry.npmjs.org/', '--ignore-scripts']])
  })
}

test('retrying a published version requires the identical tarball integrity', async (t) => {
  const { tarball, integrity } = await fixture(t)
  const result = await publishSdk(tarball, '0.3.10', {
    fetchMetadata: async () => Response.json({ name: packageName, version: '0.3.10', dist: { integrity } }),
    publish: async () => assert.fail('An identical version must not be published twice'),
  })
  assert.match(result, /already published with the same integrity/)
})

for (const existing of [
  { name: packageName, version: '0.3.10', dist: { integrity: 'sha512-other-content' } },
  { name: packageName, version: '0.3.10' },
  { name: 'unexpected-package', version: '0.3.10' },
]) {
  test(`immutable npm content mismatch is rejected: ${JSON.stringify(existing)}`, async (t) => {
    const { tarball } = await fixture(t)
    await assert.rejects(publishSdk(tarball, '0.3.10', {
      fetchMetadata: async () => Response.json(existing),
      publish: async () => assert.fail('A different package must never overwrite a published version'),
    }), /different content/)
  })
}

for (const status of [401, 500]) {
  test(`npm HTTP ${status} cannot be treated as an unpublished version`, async (t) => {
    const { tarball } = await fixture(t)
    await assert.rejects(publishSdk(tarball, '0.3.10', {
      fetchMetadata: async () => new Response(null, { status }),
      publish: async () => assert.fail('Registry errors must block publishing'),
    }), new RegExp(`HTTP ${status}`))
  })
}

test('network and npm publication failures propagate to the release gate', async (t) => {
  const { tarball } = await fixture(t)
  await assert.rejects(publishSdk(tarball, '0.3.10', {
    fetchMetadata: async () => { throw new Error('network unavailable') },
    publish: async () => assert.fail('Network errors must block publishing'),
  }), /network unavailable/)
  await assert.rejects(publishSdk(tarball, '0.3.10', {
    fetchMetadata: async () => new Response(null, { status: 404 }),
    publish: async () => { throw new Error('npm rejected publication') },
  }), /npm rejected publication/)
})

for (const [name, version] of [[packageName, '0.3.9'], ['unexpected-package', '0.3.10']]) {
  test(`the release rejects a tarball for ${name}@${version} before contacting npm`, async (t) => {
    const { tarball } = await fixture(t, version, name)
    await assert.rejects(publishSdk(tarball, '0.3.10', {
      fetchMetadata: async () => assert.fail('Invalid tarballs must not reach npm'),
      publish: async () => assert.fail('Invalid tarballs must not be published'),
    }), /tarball must contain/)
  })
}
