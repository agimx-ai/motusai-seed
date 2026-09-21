import { chmod, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SeedPluginRuntimeDefinition } from '../shared/contracts'
import type { FileBroker } from './brokers/files'
import { SidecarProcessService } from './sidecar-process-service'

const temporaryDirectories: string[] = []
afterEach(async () => Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))))

async function fixture(source: string, report = vi.fn()) {
  const root = await mkdtemp(join(tmpdir(), 'seed-sidecar-test-'))
  temporaryDirectories.push(root)
  const executable = join(root, 'sidecar')
  await writeFile(executable, `#!/bin/sh\n${source}\n`)
  await chmod(executable, 0o700)
  const plugin: SeedPluginRuntimeDefinition = {
    package_id: 'com.example.sidecar', version: '1.0.0', publisher_type: 'official', runtime_kind: 'sandboxed-web',
    root_path: root, entry_path: join(root, 'dist/index.mjs'), sidecars: [{ id: 'tool', path: executable }],
    permissions: ['process.sidecar'], consumes: [], capabilities: [],
  }
  const files = { resolveProcessDirectory: async () => root } as unknown as FileBroker
  return { service: new SidecarProcessService(() => [plugin], files, report), root, report }
}

describe('Sidecar process service', () => {
  it.runIf(process.platform !== 'win32')('captures sidecar stderr even when the process exits successfully', async () => {
    const { service, report } = await fixture('echo "internal warning" >&2')
    await service.invoke('com.example.sidecar', { operation: 'run', request_id: 'warn-1', sidecar_id: 'tool', root_id: 'root-1', args: [] })
    expect(report).toHaveBeenCalledWith('com.example.sidecar', 'sidecar.stderr', expect.stringContaining('internal warning'),
      expect.objectContaining({ request_id: 'warn-1' }))
  })

  it.runIf(process.platform !== 'win32')('runs only a declared sidecar inside an authorized directory', async () => {
    const { service } = await fixture('printf "%s:%s" "$1" "$OFFICECLI_SKIP_UPDATE"')
    await expect(service.invoke('com.example.sidecar', {
      operation: 'run', request_id: 'run-1', sidecar_id: 'tool', root_id: 'root-1', args: ['hello'], env: { OFFICECLI_SKIP_UPDATE: '1' },
    })).resolves.toMatchObject({ output: 'hello:1', exit_code: 0, timed_out: false })
    await expect(service.invoke('com.example.sidecar', {
      operation: 'run', request_id: 'run-2', sidecar_id: 'missing', root_id: 'root-1', args: [],
    })).rejects.toMatchObject({ code: 'sidecar_not_declared' })
  })

  it.runIf(process.platform !== 'win32')('runs in the package directory without a user grant', async () => {
    const { service, root } = await fixture('printf "%s" "$PWD"')
    await expect(service.invoke('com.example.sidecar', {
      operation: 'run', request_id: 'run-package', sidecar_id: 'tool', cwd_scope: 'package', args: [],
    })).resolves.toMatchObject({ output: await realpath(root), exit_code: 0, timed_out: false })
  })

  it.runIf(process.platform !== 'win32')('rejects writes in the package directory', async () => {
    const { service } = await fixture('cat')
    await expect(service.invoke('com.example.sidecar', {
      operation: 'run', request_id: 'run-package-write', sidecar_id: 'tool', cwd_scope: 'package', access: 'write', args: [],
    })).rejects.toMatchObject({ code: 'sidecar_cwd_scope_invalid' })
  })

  it.runIf(process.platform !== 'win32')('cancels the whole active process group', async () => {
    const { service } = await fixture('sleep 30')
    const running = service.invoke('com.example.sidecar', {
      operation: 'run', request_id: 'run-cancel', sidecar_id: 'tool', root_id: 'root-1', args: [],
    })
    const rejection = expect(running).rejects.toMatchObject({ code: 'sidecar_cancelled' })
    await new Promise((resolve) => setTimeout(resolve, 50))
    await expect(service.invoke('com.example.sidecar', { operation: 'cancel', request_id: 'run-cancel' })).resolves.toEqual({ cancelled: true })
    await rejection
  })
})
