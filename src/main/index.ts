import { join, resolve } from 'node:path'
import { release } from 'node:os'
import { seedDeepLinkScheme, type SeedNavigationTarget } from '@motusai/seed-sdk'
import { app, BrowserWindow, Menu, Tray, crashReporter, ipcMain, nativeImage, nativeTheme, powerMonitor, protocol, session, shell } from 'electron'
import { buildConfig } from '../shared/build-config.generated'
import { ipcChannels, type SeedLanguagePreference } from '../shared/contracts'
import { registerIpc } from './ipc'
import { nativeMenuLabel, nativeMenuMessages } from './i18n/native-menu'
import { SeedRuntime } from './runtime'
import { parseSeedDeepLink, seedDeepLinkFromArguments } from './deep-link'
import { ObservationStore, errorDetails } from './observation-store'

process.title = buildConfig.appName
app.setName(buildConfig.appName)
crashReporter.start({ uploadToServer: false, productName: buildConfig.appName })
protocol.registerSchemesAsPrivileged([{
  scheme: 'seed-plugin',
  privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true },
}])
const acquiredLock = app.requestSingleInstanceLock()
if (!acquiredLock) app.quit()

if (process.defaultApp && process.argv[1]) app.setAsDefaultProtocolClient(seedDeepLinkScheme, process.execPath, [resolve(process.argv[1])])
else app.setAsDefaultProtocolClient(seedDeepLinkScheme)
if (process.defaultApp && process.argv[1]) app.setAsDefaultProtocolClient(buildConfig.appId, process.execPath, [resolve(process.argv[1])])
else app.setAsDefaultProtocolClient(buildConfig.appId)

let mainWindow: BrowserWindow | null = null
let tray: Tray | null = null
let quitting = false
let runtime: SeedRuntime | null = null
const diagnostics = new ObservationStore(app.getPath('userData'), buildConfig.appName)
ipcMain.on('seed:diagnostic:renderer', (event, input: unknown) => {
  if (event.sender !== mainWindow?.webContents || !input || typeof input !== 'object') return
  const record = input as Record<string, unknown>
  if (!['renderer.error', 'renderer.unhandled_rejection'].includes(String(record.event))) return
  diagnostics.record({ level: 'error', source: 'renderer', event: String(record.event),
    message: String(record.message || ''),
    ...(typeof record.error_name === 'string' ? { error_name: record.error_name } : {}),
    ...(typeof record.error_stack === 'string' ? { error_stack: record.error_stack } : {}),
  })
})
process.on('uncaughtExceptionMonitor', (error) => diagnostics.record({ level: 'fatal', source: 'main', event: 'process.uncaught_exception', ...errorDetails(error) }))
process.on('unhandledRejection', (reason) => {
  diagnostics.record({ level: 'fatal', source: 'main', event: 'process.unhandled_rejection', ...errorDetails(reason) })
  process.exitCode = 1
  setImmediate(() => process.exit(1))
})
let languagePreference: SeedLanguagePreference = 'system'
let shutdownComplete = false
let shutdownPromise: Promise<void> | null = null
let pendingNavigation = seedDeepLinkFromArguments(process.argv)
let pendingOAuthCallback = process.argv.find((value) => value.startsWith(`${buildConfig.appId}:/oauth/callback`)) || ''

function showMainWindow() {
  if (!mainWindow) return
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.show()
  mainWindow.focus()
}

function handleNavigationRequest(request: SeedNavigationTarget) {
  showMainWindow()
  if (runtime) void runtime.requestNavigation(request)
  else pendingNavigation = request
}

function handleDeepLink(value: string) {
  if (value.startsWith(`${buildConfig.appId}:/plugin/oauth/callback`)) {
    showMainWindow()
    runtime?.handlePluginOAuthCallback(value)
    return
  }
  if (value.startsWith(`${buildConfig.appId}:/oauth/callback`)) {
    showMainWindow()
    if (!runtime?.handleOAuthCallback(value)) pendingOAuthCallback = value
    return
  }
  const request = parseSeedDeepLink(value)
  if (request) handleNavigationRequest(request)
}

function appAsset(fileName: 'app-dark.svg' | 'app-light.svg' | 'app-icon.png' | 'tray-dark.png' | 'tray-light.png') {
  const relativePath = join('app', fileName)
  const resourcesDirectory = app.isPackaged
    ? process.resourcesPath
    : join(app.getAppPath(), 'resources')
  return join(resourcesDirectory, relativePath)
}

function trayImage() {
  const fileName = process.platform === 'darwin'
    ? 'tray-light.png'
    : nativeTheme.shouldUseDarkColors ? 'tray-dark.png' : 'tray-light.png'
  const image = nativeImage.createFromPath(appAsset(fileName)).resize({ height: 18 })
  if (image.isEmpty()) throw new Error(`Tray icon could not be loaded: ${appAsset(fileName)}`)
  if (process.platform === 'darwin') image.setTemplateImage(true)
  return image
}

function createWindow() {
  const windowsBackgroundColor = () => nativeTheme.shouldUseDarkColors ? '#171717' : '#f4f6f1'
  const windowsBuild = process.platform === 'win32' ? Number(release().split('.')[2]) : 0
  const supportsWindowsAcrylic = windowsBuild >= 22_621
  const platformVisualEffect = process.platform === 'darwin' ? {
    backgroundColor: '#00000000',
    vibrancy: 'sidebar' as const,
    visualEffectState: 'active' as const,
  } : supportsWindowsAcrylic ? {
    backgroundColor: '#00000000',
    backgroundMaterial: 'acrylic' as const,
  } : {
    backgroundColor: windowsBackgroundColor(),
  }
  const window = new BrowserWindow({
    width: 960,
    height: 640,
    minWidth: 960,
    minHeight: 640,
    title: buildConfig.appName,
    icon: appAsset('app-icon.png'),
    ...platformVisualEffect,
    show: false,
    frame: process.platform !== 'win32',
    autoHideMenuBar: process.platform === 'win32',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    ...(process.platform === 'darwin' ? { trafficLightPosition: { x: 12, y: 16 } } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      spellcheck: false,
    },
  })
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) void shell.openExternal(url)
    return { action: 'deny' }
  })
  window.webContents.on('render-process-gone', (_event, details) => {
    diagnostics.record({ level: 'fatal', source: 'renderer', event: 'process.gone', message: details.reason, details: { exit_code: details.exitCode } })
  })
  window.webContents.on('will-navigate', (event, url) => {
    const allowed = url.startsWith('file://') || Boolean(process.env.VITE_DEV_SERVER_URL && url.startsWith(process.env.VITE_DEV_SERVER_URL))
    if (!allowed) event.preventDefault()
  })
  window.on('close', (event) => {
    if (quitting) return
    event.preventDefault()
    window.hide()
  })
  window.once('ready-to-show', () => {
    window.show()
  })
  const sendMaximizedState = () => {
    if (!window.webContents.isDestroyed()) window.webContents.send(ipcChannels.windowMaximizedChanged, window.isMaximized())
  }
  window.on('maximize', sendMaximizedState)
  window.on('unmaximize', sendMaximizedState)
  if (process.platform === 'win32' && !supportsWindowsAcrylic) {
    const updateBackgroundColor = () => window.setBackgroundColor(windowsBackgroundColor())
    nativeTheme.on('updated', updateBackgroundColor)
    window.once('closed', () => nativeTheme.off('updated', updateBackgroundColor))
  }
  if (process.env.VITE_DEV_SERVER_URL) void window.loadURL(process.env.VITE_DEV_SERVER_URL)
  else void window.loadFile(join(__dirname, '../../renderer/index.html'))
  return window
}

function updateTrayMenu() {
  const messages = nativeMenuMessages(languagePreference)
  const audio = runtime?.audioSnapshot()
  const audioActive = Boolean(audio && audio.state !== 'idle')
  tray?.setContextMenu(Menu.buildFromTemplate([
    { label: nativeMenuLabel(messages.openApp, buildConfig.appName), click: () => mainWindow?.show() },
    ...(audioActive ? [
      { type: 'separator' as const },
      { label: audio?.state === 'paused' ? messages.recordingPaused : messages.recordingActive, enabled: false },
      { label: messages.stopRecording, click: () => void runtime?.cancelAudio() },
    ] : []),
    { type: 'separator' },
    { label: messages.quit, click: () => { quitting = true; app.quit() } },
  ]))
}

function createTray() {
  tray = new Tray(trayImage())
  tray.setToolTip(buildConfig.appName)
  updateTrayMenu()
  tray.on('click', () => mainWindow?.show())
  nativeTheme.on('updated', () => tray?.setImage(trayImage()))
}

function createApplicationMenu() {
  if (process.platform !== 'darwin') {
    Menu.setApplicationMenu(null)
    return
  }
  const messages = nativeMenuMessages(languagePreference)
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: buildConfig.appName, submenu: [{ role: 'about', label: nativeMenuLabel(messages.about, buildConfig.appName) }, { type: 'separator' }, { role: 'hide', label: nativeMenuLabel(messages.hide, buildConfig.appName) }, { role: 'hideOthers', label: messages.hideOthers }, { role: 'unhide', label: messages.showAll }, { type: 'separator' }, { role: 'quit', label: nativeMenuLabel(messages.quitApp, buildConfig.appName) }] },
    { label: messages.file, submenu: [{ role: 'close', label: messages.closeWindow }] },
    { label: messages.edit, submenu: [{ role: 'undo', label: messages.undo }, { role: 'redo', label: messages.redo }, { type: 'separator' }, { role: 'cut', label: messages.cut }, { role: 'copy', label: messages.copy }, { role: 'paste', label: messages.paste }, { role: 'selectAll', label: messages.selectAll }] },
    { label: messages.view, submenu: [{ role: 'reload', label: messages.reload }, { role: 'togglefullscreen', label: messages.toggleFullScreen }] },
    { label: messages.window, submenu: [{ role: 'minimize', label: messages.minimize }, { role: 'zoom', label: messages.zoom }, { role: 'front', label: messages.bringAllToFront }] },
  ]))
}

function setLanguagePreference(preference: SeedLanguagePreference) {
  languagePreference = preference
  createApplicationMenu()
  if (tray) updateTrayMenu()
}

app.on('open-url', (event, url) => {
  event.preventDefault()
  handleDeepLink(url)
})

app.on('second-instance', (_event, commandLine) => {
  const pluginOAuthCallback = commandLine.find((value) => value.startsWith(`${buildConfig.appId}:/plugin/oauth/callback`))
  if (pluginOAuthCallback) {
    handleDeepLink(pluginOAuthCallback)
    return
  }
  const oauthCallback = commandLine.find((value) => value.startsWith(`${buildConfig.appId}:/oauth/callback`))
  if (oauthCallback) {
    handleDeepLink(oauthCallback)
    return
  }
  const request = seedDeepLinkFromArguments(commandLine)
  if (request) {
    handleNavigationRequest(request)
    return
  }
  showMainWindow()
})

app.whenReady().then(async () => {
  app.dock?.setIcon(nativeImage.createFromPath(appAsset('app-icon.png')))
  app.setAboutPanelOptions({ applicationName: buildConfig.appName, applicationVersion: app.getVersion() })
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    const development = Boolean(process.env.VITE_DEV_SERVER_URL)
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        ...(!development ? {
          'Content-Security-Policy': ["default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; font-src 'self'; connect-src 'none'; object-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none'"],
        } : {}),
      },
    })
  })
  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false))
  createApplicationMenu()
  mainWindow = createWindow()
  createTray()
  runtime = new SeedRuntime(() => mainWindow, setLanguagePreference, () => { quitting = true }, updateTrayMenu, diagnostics)
  registerIpc(runtime)
  await runtime.initialize()
  powerMonitor.on('resume', () => runtime?.resumeNetworkConnections())
  if (pendingOAuthCallback) {
    const callback = pendingOAuthCallback
    pendingOAuthCallback = ''
    runtime.handleOAuthCallback(callback)
  }
  if (pendingNavigation) {
    const request: SeedNavigationTarget = pendingNavigation
    pendingNavigation = null
    await runtime.requestNavigation(request)
  }
})

app.on('before-quit', (event) => {
  quitting = true
  if (shutdownComplete) return
  event.preventDefault()
  mainWindow?.hide()
  tray?.destroy()
  tray = null
  shutdownPromise ??= (runtime?.stop() ?? Promise.resolve())
    .catch((error) => console.error('Seed shutdown failed', error))
    .finally(async () => {
      try { await diagnostics.close() } catch (error) { console.error('Seed observation store close failed', error) }
      shutdownComplete = true
      app.quit()
    })
})

app.on('activate', () => {
  if (!mainWindow) mainWindow = createWindow()
  mainWindow.show()
})
