import { app, shell } from 'electron'
import { autoUpdater, type ProgressInfo, type UpdateInfo } from 'electron-updater'
import type { AppUpdateState } from '../shared/contracts'

const firstCheckDelayMs = 10_000
const recurringCheckDelayMs = 60 * 60 * 1000
function releaseChannel(updateUrl: string): 'stable' | 'beta' {
  if (!updateUrl) return 'stable'
  try {
    const segments = new URL(updateUrl).pathname.split('/').filter(Boolean)
    return segments.at(-2) === 'beta' ? 'beta' : 'stable'
  } catch {
    return 'stable'
  }
}

function versionFrom(info: UpdateInfo) {
  return typeof info.version === 'string' ? info.version : ''
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

export function macDmgDownloadUrl(info: UpdateInfo, updateUrl: string) {
  const dmg = info.files.find((file) => new URL(file.url, 'https://seed.invalid/').pathname.toLowerCase().endsWith('.dmg'))
  if (!dmg) return null
  const baseUrl = updateUrl.endsWith('/') ? updateUrl : `${updateUrl}/`
  return new URL(dmg.url, baseUrl).toString()
}

export class SeedUpdater {
  private state: AppUpdateState = {
    status: 'idle',
    currentVersion: app.getVersion(),
  }
  private firstCheckTimer: ReturnType<typeof setTimeout> | null = null
  private recurringCheckTimer: ReturnType<typeof setInterval> | null = null
  private started = false
  private updateUrl = ''
  private updateChannel: 'stable' | 'beta' = 'stable'
  private manualDownloadUrl: string | null = null
  private readonly platform: NodeJS.Platform
  private readonly openExternal: (url: string) => Promise<void>

  constructor(
    private readonly changed: (state: AppUpdateState) => void,
    private readonly prepareToInstall: () => void,
    options: { platform?: NodeJS.Platform; openExternal?: (url: string) => Promise<void> } = {},
  ) {
    this.platform = options.platform ?? process.platform
    this.openExternal = options.openExternal ?? ((url) => shell.openExternal(url))
  }

  configure(updateUrl: string | null) {
    this.updateUrl = updateUrl || ''
    this.updateChannel = releaseChannel(this.updateUrl)
    if (!this.started || !app.isPackaged) return
    if (!this.updateUrl) {
      this.clearCheckTimers()
      this.manualDownloadUrl = null
      this.setState({ status: 'disabled' })
      return
    }
    this.applyFeedConfiguration()
    this.scheduleChecks()
    if (this.state.status === 'disabled') this.setState({ status: 'idle' })
  }

  private applyFeedConfiguration() {
    autoUpdater.setFeedURL({ provider: 'generic', url: this.updateUrl, channel: this.updateChannel === 'stable' ? 'latest' : 'beta' })
    autoUpdater.allowPrerelease = this.updateChannel === 'beta'
  }

  snapshot() {
    return { ...this.state }
  }

  start() {
    if (this.started) return
    this.started = true
    if (!app.isPackaged) {
      this.setState({ status: 'disabled' })
      return
    }

    autoUpdater.autoDownload = false
    autoUpdater.autoInstallOnAppQuit = false
    autoUpdater.on('checking-for-update', () => this.setState({ status: 'checking', error: undefined }))
    autoUpdater.on('update-available', (info) => {
      this.manualDownloadUrl = this.platform === 'darwin' ? macDmgDownloadUrl(info, this.updateUrl) : null
      this.setState({
        status: 'available',
        availableVersion: versionFrom(info),
        error: undefined,
      })
    })
    autoUpdater.on('update-not-available', () => this.setState({
      status: 'up-to-date',
      availableVersion: undefined,
      percent: undefined,
      error: undefined,
    }))
    autoUpdater.on('download-progress', (progress) => this.onDownloadProgress(progress))
    autoUpdater.on('update-downloaded', (info) => this.setState({
      status: 'downloaded',
      availableVersion: versionFrom(info),
      percent: 100,
      error: undefined,
    }))
    autoUpdater.on('error', (error) => this.setState({ status: 'error', error: errorMessage(error) }))

    if (!this.updateUrl) {
      this.setState({ status: 'disabled' })
      return
    }
    this.applyFeedConfiguration()
    this.scheduleChecks()
  }

  private scheduleChecks() {
    if (this.firstCheckTimer || this.recurringCheckTimer) return
    this.firstCheckTimer = setTimeout(() => void this.check().catch(() => undefined), firstCheckDelayMs)
    this.recurringCheckTimer = setInterval(() => void this.check().catch(() => undefined), recurringCheckDelayMs)
  }

  stop() {
    this.clearCheckTimers()
  }

  private clearCheckTimers() {
    if (this.firstCheckTimer) clearTimeout(this.firstCheckTimer)
    if (this.recurringCheckTimer) clearInterval(this.recurringCheckTimer)
    this.firstCheckTimer = null
    this.recurringCheckTimer = null
  }

  async check() {
    this.assertEnabled()
    if (this.state.status === 'checking' || this.state.status === 'downloading') return false
    await autoUpdater.checkForUpdates()
    return this.state.status === 'up-to-date'
  }

  async download() {
    this.assertEnabled()
    if (this.state.status !== 'available' && !(this.state.status === 'error' && this.state.availableVersion)) {
      throw new Error('当前没有可下载的新版本。')
    }
    if (this.platform === 'darwin') {
      if (!this.manualDownloadUrl) throw new Error('更新源没有提供 macOS DMG 安装包。')
      await this.openExternal(this.manualDownloadUrl)
      return true
    }
    this.setState({ status: 'downloading', percent: 0, error: undefined })
    await autoUpdater.downloadUpdate()
    return true
  }

  install() {
    this.assertEnabled()
    if (this.state.status !== 'downloaded') throw new Error('更新尚未下载完成。')
    this.prepareToInstall()
    setImmediate(() => autoUpdater.quitAndInstall(false, true))
    return true
  }

  private assertEnabled() {
    if (!app.isPackaged || !this.updateUrl) throw new Error('客户端未配置应用更新源。')
  }

  private onDownloadProgress(progress: ProgressInfo) {
    this.setState({
      status: 'downloading',
      percent: Math.max(0, Math.min(100, progress.percent)),
      transferred: progress.transferred,
      total: progress.total,
      bytesPerSecond: progress.bytesPerSecond,
      error: undefined,
    })
  }

  private setState(patch: Partial<AppUpdateState>) {
    this.state = { ...this.state, ...patch }
    this.changed(this.snapshot())
  }
}
