import { beforeEach, describe, expect, it, vi } from 'vitest'

const { app, autoUpdater, openExternal } = vi.hoisted(() => ({
  app: { getVersion: vi.fn(() => '0.1.63'), isPackaged: true },
  autoUpdater: {
    autoDownload: true,
    autoInstallOnAppQuit: true,
    allowPrerelease: false,
    on: vi.fn(),
    setFeedURL: vi.fn(),
    checkForUpdates: vi.fn(),
    downloadUpdate: vi.fn(),
    quitAndInstall: vi.fn(),
  },
  openExternal: vi.fn(async () => undefined),
}))

vi.mock('electron', () => ({ app, shell: { openExternal } }))
vi.mock('electron-updater', () => ({ autoUpdater }))
import { macDmgDownloadUrl, SeedUpdater } from './updater'

describe('SeedUpdater macOS manual downloads', () => {
  beforeEach(() => vi.clearAllMocks())

  it('activates manual and scheduled checks when configuration arrives after startup', async () => {
    vi.useFakeTimers()
    try {
      const changed = vi.fn()
      const updater = new SeedUpdater(changed, vi.fn(), { platform: 'darwin', openExternal })
      updater.start()

      expect(updater.snapshot().status).toBe('disabled')
      expect(autoUpdater.on).toHaveBeenCalledWith('update-not-available', expect.any(Function))

      updater.configure('https://downloads.example.test/stable/mac-arm64')
      expect(updater.snapshot().status).toBe('idle')
      expect(autoUpdater.setFeedURL).toHaveBeenCalledWith({
        provider: 'generic',
        url: 'https://downloads.example.test/stable/mac-arm64',
        channel: 'latest',
      })

      const notAvailable = autoUpdater.on.mock.calls.find(([event]) => event === 'update-not-available')?.[1]
      autoUpdater.checkForUpdates.mockImplementationOnce(async () => notAvailable?.())
      await expect(updater.check()).resolves.toBe(true)
      expect(updater.snapshot().status).toBe('up-to-date')

      autoUpdater.checkForUpdates.mockClear()
      autoUpdater.checkForUpdates.mockResolvedValueOnce(undefined)
      await vi.advanceTimersByTimeAsync(10_000)
      expect(autoUpdater.checkForUpdates).toHaveBeenCalledOnce()
      await vi.advanceTimersByTimeAsync(60 * 60 * 1000)
      expect(autoUpdater.checkForUpdates).toHaveBeenCalledTimes(2)
      updater.stop()
    } finally {
      vi.useRealTimers()
    }
  })

  it('resolves the DMG from macOS update metadata against the configured feed', () => {
    expect(macDmgDownloadUrl({
      version: '0.1.64',
      files: [
        { url: 'MotusAI-Seed-0.1.64-mac-arm64.zip', sha512: 'zip' },
        { url: 'MotusAI-Seed-0.1.64-mac-arm64.dmg', sha512: 'dmg' },
      ],
      path: 'MotusAI-Seed-0.1.64-mac-arm64.zip',
      sha512: 'zip',
      releaseDate: '2026-09-14T00:00:00.000Z',
    }, 'https://downloads.example.test/stable/mac-arm64')).toBe(
      'https://downloads.example.test/stable/mac-arm64/MotusAI-Seed-0.1.64-mac-arm64.dmg',
    )
  })

  it('opens the DMG externally instead of invoking the automatic updater on macOS', async () => {
    const updater = new SeedUpdater(vi.fn(), vi.fn(), { platform: 'darwin', openExternal })
    updater.configure('https://downloads.example.test/stable/mac-arm64')
    updater.start()
    const available = autoUpdater.on.mock.calls.find(([event]) => event === 'update-available')?.[1]
    available?.({
      version: '0.1.64',
      files: [{ url: 'MotusAI-Seed-0.1.64-mac-arm64.dmg', sha512: 'dmg' }],
    })

    await expect(updater.download()).resolves.toBe(true)
    expect(openExternal).toHaveBeenCalledWith(
      'https://downloads.example.test/stable/mac-arm64/MotusAI-Seed-0.1.64-mac-arm64.dmg',
    )
    expect(autoUpdater.downloadUpdate).not.toHaveBeenCalled()
    updater.stop()
  })

  it('keeps the automatic download path on Windows', async () => {
    const updater = new SeedUpdater(vi.fn(), vi.fn(), { platform: 'win32', openExternal })
    updater.configure('https://downloads.example.test/stable/mac-arm64')
    updater.start()
    const available = autoUpdater.on.mock.calls.find(([event]) => event === 'update-available')?.[1]
    available?.({
      version: '0.1.64',
      files: [{ url: 'MotusAI-Seed-0.1.64-win-x64.exe', sha512: 'exe' }],
    })

    await expect(updater.download()).resolves.toBe(true)
    expect(autoUpdater.downloadUpdate).toHaveBeenCalledOnce()
    expect(openExternal).not.toHaveBeenCalled()
    updater.stop()
  })
})
