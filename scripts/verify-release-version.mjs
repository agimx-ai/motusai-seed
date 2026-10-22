import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { test } from 'node:test'
import { checkReleaseVersions, updateClientVersion } from './update-client-version.mjs'

async function fixture(t) {
  const root = await mkdtemp(resolve(tmpdir(), 'seed-release-version-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  await mkdir(resolve(root, 'packages/seed-sdk'), { recursive: true })
  const files = {
    'package.json': { version: '0.3.9', dependencies: { '@motus-ai/seed-sdk': 'file:packages/seed-sdk' } },
    'packages/seed-sdk/package.json': { name: '@motus-ai/seed-sdk', version: '0.3.3', files: ['dist'] },
    'package-lock.json': {
      version: '0.3.9', lockfileVersion: 3,
      packages: { '': { version: '0.3.9' }, 'packages/seed-sdk': { version: '0.3.3' }, unrelated: { version: '1.0.0' } },
    },
  }
  const save = (path, value) => writeFile(resolve(root, path), `${JSON.stringify(value, null, 2)}\n`)
  await Promise.all(Object.entries(files).map(([path, value]) => save(path, value)))
  const snapshot = () => Promise.all(Object.keys(files).map((path) => readFile(resolve(root, path), 'utf8')))
  return { root, files, save, snapshot }
}

test('the next release synchronizes legacy client and SDK versions without changing dependencies', async (t) => {
  const { root, files } = await fixture(t)
  await updateClientVersion('0.3.10', root)
  assert.equal(await checkReleaseVersions(root), '0.3.10')
  const read = async (path) => JSON.parse(await readFile(resolve(root, path), 'utf8'))
  assert.deepEqual(await read('package.json'), { ...files['package.json'], version: '0.3.10' })
  assert.deepEqual(await read('packages/seed-sdk/package.json'), { ...files['packages/seed-sdk/package.json'], version: '0.3.10' })
  const lock = await read('package-lock.json')
  assert.equal(lock.version, '0.3.10')
  assert.equal(lock.packages[''].version, '0.3.10')
  assert.equal(lock.packages['packages/seed-sdk'].version, '0.3.10')
  assert.deepEqual(lock.packages.unrelated, files['package-lock.json'].packages.unrelated)
})

test('prereleases keep the full shared version and repeating a prepared version is a no-op', async (t) => {
  const { root, snapshot } = await fixture(t)
  await updateClientVersion('0.4.0-rc.1', root)
  assert.equal(await checkReleaseVersions(root), '0.4.0-rc.1')
  const before = await snapshot()
  assert.match(await updateClientVersion('0.4.0-rc.1', root), /无需修改/)
  assert.deepEqual(await snapshot(), before)
})

test('checking legacy versions is read-only and rejects a mismatched release', async (t) => {
  const { root, snapshot } = await fixture(t)
  const before = await snapshot()
  await assert.rejects(checkReleaseVersions(root), /客户端 0\.3\.9 与 SDK 0\.3\.3 版本不一致/)
  await assert.rejects(updateClientVersion('0.3.9', root), /不能沿用已有客户端版本/)
  assert.deepEqual(await snapshot(), before)
})

for (const [name, path, corrupt] of [
  ['root lock version', 'package-lock.json', (value) => { value.version = '0.3.8' }],
  ['client workspace lock version', 'package-lock.json', (value) => { value.packages[''].version = '0.3.8' }],
  ['SDK workspace lock version', 'package-lock.json', (value) => { value.packages['packages/seed-sdk'].version = '0.3.2' }],
  ['missing SDK workspace', 'package-lock.json', (value) => { delete value.packages['packages/seed-sdk'] }],
  ['invalid client version', 'package.json', (value) => { value.version = 'invalid' }],
  ['invalid SDK version', 'packages/seed-sdk/package.json', (value) => { value.version = 'invalid' }],
]) {
  test(`${name} corruption blocks checks and updates before any file is written`, async (t) => {
    const { root, files, save, snapshot } = await fixture(t)
    corrupt(files[path])
    await save(path, files[path])
    const before = await snapshot()
    await assert.rejects(checkReleaseVersions(root))
    await assert.rejects(updateClientVersion('0.3.10', root))
    assert.deepEqual(await snapshot(), before)
  })
}

test('invalid requested versions leave every file unchanged', async (t) => {
  const { root, snapshot } = await fixture(t)
  const before = await snapshot()
  for (const value of [undefined, '', 'v0.3.10', '0.3', '0.3.10-01']) {
    await assert.rejects(updateClientVersion(value, root), /用法/)
  }
  assert.deepEqual(await snapshot(), before)
})

test('bound releases reject build metadata that npm would remove', async (t) => {
  const { root, files, save, snapshot } = await fixture(t)
  const before = await snapshot()
  await assert.rejects(updateClientVersion('0.3.10+build.1', root), /构建元数据/)
  assert.deepEqual(await snapshot(), before)
  files['package.json'].version = '0.3.10+build.1'
  files['packages/seed-sdk/package.json'].version = '0.3.10+build.1'
  const lock = files['package-lock.json']
  lock.version = lock.packages[''].version = lock.packages['packages/seed-sdk'].version = '0.3.10+build.1'
  await Promise.all(Object.entries(files).map(([path, value]) => save(path, value)))
  await assert.rejects(checkReleaseVersions(root), /构建元数据/)
})
