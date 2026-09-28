import { createHash } from 'node:crypto'
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { SeedPluginRuntimeDefinition } from '../shared/contracts'
import { PythonEnvironmentService } from './python-environment-service'
import { verifySeedPackage } from './seed-package'

const created: string[] = []
afterEach(async () => Promise.all(created.splice(0).map((path) => rm(path, { recursive: true, force: true }))))

async function fixture(permissions = ['process.python']) {
  const root = await mkdtemp(join(tmpdir(), 'seed-python-plugin-'))
  const data = await mkdtemp(join(tmpdir(), 'seed-python-data-'))
  created.push(root, data)
  const skill = join(root, 'skills', 'test-skill')
  await mkdir(join(skill, 'scripts'), { recursive: true })
  await mkdir(join(skill, 'wheels'), { recursive: true })
  await writeFile(join(skill, 'SKILL.md'), '---\nname: test-skill\ndescription: Test Python Skill.\n---\n')
  await writeFile(join(skill, 'pyproject.toml'), '[project]\nname = "test"\nversion = "1.0.0"\nrequires-python = ">=3.12"\n')
  await writeFile(join(skill, 'uv.lock'), 'version = 1\n')
  await writeFile(join(skill, 'requirements.txt'), '')
  await writeFile(join(skill, 'scripts', 'demo.py'), 'import sys\nprint("hello " + sys.argv[1])\n')
  const plugin: SeedPluginRuntimeDefinition = {
    package_id: 'com.example.python', version: '1.0.0', publisher_type: 'official', runtime_kind: 'native-host',
    root_path: root, entry_path: join(root, 'dist/index.mjs'), sidecars: [], permissions, consumes: [], capabilities: [],
  }
  const bundled = resolve(import.meta.dirname, '../../resources/python')
  return { service: new PythonEnvironmentService(() => [plugin], data, bundled), root }
}

describe('Python environment service', () => {
  it('rejects plugins without Python permission', async () => {
    const { service } = await fixture([])
    await expect(service.invoke('com.example.python', { operation: 'prepare', skill_id: 'test-skill' })).rejects.toMatchObject({ code: 'broker_permission_denied' })
  })

  it('rejects scripts outside the packaged scripts directory', async () => {
    const { service } = await fixture()
    await expect(service.invoke('com.example.python', {
      operation: 'run', request_id: 'one', script: './skills/test-skill/scripts/../outside.py', args: [],
    })).rejects.toMatchObject({ code: 'python_script_invalid' })
  })

  it('requires the uv project lockfile', async () => {
    const { service, root } = await fixture()
    await rm(join(root, 'skills', 'test-skill', 'uv.lock'))
    await expect(service.invoke('com.example.python', { operation: 'prepare', skill_id: 'test-skill' })).rejects.toThrow()
  })

  it('prepares and runs with the bundled interpreter without network', async () => {
    const { service } = await fixture()
    const bundled = resolve(import.meta.dirname, '../../resources/python', process.platform === 'win32' ? 'python.exe' : 'bin/python3.12')
    if (!await access(bundled).then(() => true, () => false)) return
    await expect(service.invoke('com.example.python', { operation: 'prepare', skill_id: 'test-skill' })).resolves.toMatchObject({ ready: true, version: '3.12' })
    await expect(service.invoke('com.example.python', {
      operation: 'run', request_id: 'two', script: './skills/test-skill/scripts/demo.py', args: ['Seed'],
    })).resolves.toMatchObject({ output: 'hello Seed\n', exit_code: 0 })
  })

  it.runIf(Boolean(process.env.SEED_TEST_PYTHON_DEMO_PACKAGE))('runs the packaged Demo with its offline wheel', async () => {
    const packageBytes = await readFile(process.env.SEED_TEST_PYTHON_DEMO_PACKAGE!)
    const verified = await verifySeedPackage(packageBytes, {
      expectedPackageSha256: createHash('sha256').update(packageBytes).digest('hex'),
      expectedPluginId: 'com.motusai.seed.python-demo',
    })
    const root = await mkdtemp(join(tmpdir(), 'seed-python-demo-package-'))
    const data = await mkdtemp(join(tmpdir(), 'seed-python-demo-env-'))
    created.push(root, data)
    for (const [path, body] of verified.files) {
      const destination = join(root, path)
      await mkdir(resolve(destination, '..'), { recursive: true })
      await writeFile(destination, body)
    }
    const plugin: SeedPluginRuntimeDefinition = {
      package_id: verified.manifest.id, version: verified.manifest.version,
      publisher_type: 'official', runtime_kind: 'native-host', root_path: root,
      entry_path: join(root, 'dist/index.mjs'), sidecars: [],
      permissions: verified.manifest.permissions, consumes: [], capabilities: [],
    }
    const service = new PythonEnvironmentService(() => [plugin], data, resolve(import.meta.dirname, '../../resources/python'))
    await expect(service.invoke(plugin.package_id, {
      operation: 'run', request_id: 'demo', script: './skills/python-greeting-demo/scripts/greet.py', args: ['Seed'],
    })).resolves.toMatchObject({ output: expect.stringContaining('Hello, Seed!'), exit_code: 0 })
    await expect(service.invoke(plugin.package_id, {
      operation: 'run', request_id: 'stats', script: './skills/python-text-stats-demo/scripts/stats.py', args: ['hello Seed'],
    })).resolves.toMatchObject({ output: 'Characters: 10; Words: 2\n', exit_code: 0 })
    for (const skillId of ['python-greeting-demo', 'python-text-stats-demo']) {
      await expect(access(join(data, plugin.package_id, plugin.version, skillId, 'ready.json'))).resolves.toBeUndefined()
    }
  })
})
