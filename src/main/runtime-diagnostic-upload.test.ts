import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { getPath: () => '/user-data', getVersion: () => '0.2.15' }, BrowserWindow: class {}, powerSaveBlocker: {}, shell: {}, ipcMain: {}, session: {} }))
vi.mock('./updater', () => ({ SeedUpdater: class {} }))
import { SeedRuntime } from './runtime'

describe('Runtime diagnostic upload', () => {
  it('passes the host latest-recording directory without inspecting any plugin identity', async () => {
    const upload = vi.fn(async () => ({ uploadId: 'upload-1', status: 'completed' as const }))
    const runtime = Object.assign(Object.create(SeedRuntime.prototype), {
      cloudAccessToken: vi.fn(async () => 'test-access-token'), user: { id: 'user-1' }, seedCloudUrl: 'https://cloud.example.com',
      store: { auditForDiagnostics: vi.fn(async () => ({ entries: [], count: 0 })), auditSystem: vi.fn() },
      installedPlugins: [], logUploader: { upload }, publishSnapshot: vi.fn(), emit: vi.fn(),
    })
    expect(await runtime.uploadLogs({ days: 1 })).toEqual({ uploadId: 'upload-1', status: 'completed' })
    expect(upload).toHaveBeenCalledWith(expect.objectContaining({
      latestRecordingDirectory: join('/user-data', 'recordings', 'latest'), plugins: [],
    }), expect.any(Object))
  })
})
