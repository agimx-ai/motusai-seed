import { app, BrowserWindow, clipboard, ipcMain } from 'electron'
import { z } from 'zod'
import { auditQuerySchema, installPluginSchema, pluginIdSchema, terminalLogUploadRangeSchema } from '../shared/validation'
import { ipcChannels } from '../shared/contracts'
import type { SeedRuntime } from './runtime'

function assertTrustedSender(event: Electron.IpcMainInvokeEvent) {
  const url = event.senderFrame?.url || ''
  const trusted = url.startsWith('file://') || (process.env.VITE_DEV_SERVER_URL && url.startsWith(process.env.VITE_DEV_SERVER_URL))
  if (!trusted) throw new Error('拒绝来自未知页面的 IPC 请求。')
}

function handle<T extends unknown[], R>(channel: string, action: (event: Electron.IpcMainInvokeEvent, ...args: T) => R | Promise<R>) {
  ipcMain.handle(channel, async (event, ...args: T) => {
    assertTrustedSender(event)
    return action(event, ...args)
  })
}

export function registerIpc(runtime: SeedRuntime) {
  handle(ipcChannels.snapshot, () => runtime.snapshot())
  handle(ipcChannels.personalCreditWallet, () => runtime.personalCreditWallet())
  handle(ipcChannels.personalCreditGrants, (_event, cursor) => runtime.personalCreditGrants(
    z.string().regex(/^\d+$/).optional().parse(cursor),
  ))
  handle(ipcChannels.signIn, () => runtime.signIn())
  handle(ipcChannels.cancelSignIn, () => runtime.cancelSignIn())
  handle(ipcChannels.logout, () => runtime.logout())
  handle(ipcChannels.openWebsite, () => runtime.openWebsite())
  handle(ipcChannels.openPersonalWallet, () => runtime.openPersonalWallet())
  handle(ipcChannels.readProfile, () => runtime.readProfile())
  handle(ipcChannels.updateProfile, (_event, input) => runtime.updateProfile(z.object({
    displayName: z.string().trim().min(1).max(120),
    username: z.string().trim().regex(/^[A-Za-z0-9][A-Za-z0-9_.-]{2,79}$/),
    avatarDataUrl: z.string().max(512_000).startsWith('data:image/webp;base64,').optional(),
  }).strict().parse(input)))
  handle(ipcChannels.launchAtLogin, (_event, enabled) => runtime.setLaunchAtLogin(z.boolean().parse(enabled)))
  handle(ipcChannels.preventSystemSleep, (_event, enabled) => runtime.setPreventSystemSleep(z.boolean().parse(enabled)))
  handle(ipcChannels.languagePreference, (_event, preference) => runtime.setLanguagePreference(z.enum(['system', 'zh-CN', 'en-US']).parse(preference)))
  handle(ipcChannels.themePreference, (_event, preference) => runtime.setThemePreference(z.enum(['light', 'dark', 'system']).parse(preference)))
  handle(ipcChannels.pluginConfiguration, (_event, input) => runtime.updatePluginConfiguration(z.object({
    pluginId: pluginIdSchema,
    configurationId: z.string().regex(/^[a-z][a-z0-9_.-]{0,127}$/),
    values: z.record(z.string(), z.string().max(65_536)).refine((values) => Object.keys(values).length <= 32, '插件配置字段过多。'),
  }).strict().parse(input)))
  handle(ipcChannels.pluginConfigurationOptions, (_event, input) => runtime.queryPluginConfigurationOptions(z.object({
    pluginId: pluginIdSchema,
    configurationId: z.string().regex(/^[a-z][a-z0-9_.-]{0,127}$/),
    fieldKey: z.string().regex(/^[a-z][a-z0-9_.-]{0,127}$/),
    values: z.record(z.string(), z.string().max(65_536)).refine((values) => Object.keys(values).length <= 32, '插件配置字段过多。'),
  }).strict().parse(input)))
  handle(ipcChannels.pluginConfigurationProfileStatuses, (_event, input) => runtime.queryPluginConfigurationProfileStatuses(z.object({
    pluginId: pluginIdSchema,
    configurationId: z.string().regex(/^[a-z][a-z0-9_.-]{0,127}$/),
  }).strict().parse(input)))
  handle(ipcChannels.pluginConfigurationProfileReconnect, (_event, input) => runtime.reconnectPluginConfigurationProfile(z.object({
    pluginId: pluginIdSchema,
    configurationId: z.string().regex(/^[a-z][a-z0-9_.-]{0,127}$/),
    profileId: z.string().regex(/^[a-z][a-z0-9-]{0,127}$/),
  }).strict().parse(input)))
  handle(ipcChannels.pluginManagementView, (_event, input) => runtime.queryPluginManagementView(z.object({
    pluginId: pluginIdSchema,
    viewId: z.string().regex(/^[a-z][a-z0-9_.-]{0,127}$/),
    sourceId: z.string().regex(/^[a-z][a-z0-9_.-]{0,127}$/).optional(),
    arguments: z.record(z.string(), z.unknown()).refine((value) => Object.keys(value).length <= 16, '插件管理详情参数过多。').optional(),
  }).strict().parse(input)))
  handle(ipcChannels.pluginManagementAction, (_event, input) => runtime.invokePluginManagementAction(z.object({
    pluginId: pluginIdSchema,
    viewId: z.string().regex(/^[a-z][a-z0-9_.-]{0,127}$/),
    actionId: z.string().regex(/^[a-z][a-z0-9_.-]{0,127}$/),
    arguments: z.record(z.string(), z.unknown()).refine((value) => Object.keys(value).length <= 32, '插件管理动作参数过多。'),
  }).strict().parse(input)))
  handle(ipcChannels.checkForUpdates, () => runtime.checkForUpdates())
  handle(ipcChannels.downloadUpdate, () => runtime.downloadUpdate())
  handle(ipcChannels.installUpdate, () => runtime.installUpdate())
  handle(ipcChannels.clearAudit, () => runtime.clearAudit())
  handle(ipcChannels.queryAudit, (_event, input) => runtime.queryAudit(auditQuerySchema.parse(input)))
  handle(ipcChannels.queryUsage, () => runtime.queryUsage())
  handle(ipcChannels.uploadLogs, (_event, input) => runtime.uploadLogs(terminalLogUploadRangeSchema.parse(input)))
  handle(ipcChannels.cancelLogUpload, () => runtime.cancelLogUpload())
  handle(ipcChannels.refreshPluginCatalog, () => runtime.refreshPluginCatalog())
  handle(ipcChannels.loadMorePluginCatalog, () => runtime.loadMorePluginCatalog())
  handle(ipcChannels.searchPluginCatalog, (_event, query, cursor) => runtime.searchPluginCatalog(
    z.string().max(500).parse(query),
    z.string().max(1_000).optional().parse(cursor),
  ))
  handle(ipcChannels.installPlugin, (_event, pluginId, version) => {
    const input = installPluginSchema.parse({ pluginId, version })
    return runtime.installPlugin(input.pluginId, input.version)
  })
  handle(ipcChannels.cancelPluginInstall, (_event, pluginId) => runtime.cancelPluginInstall(pluginIdSchema.parse(pluginId)))
  handle(ipcChannels.uninstallPlugin, (_event, pluginId) => runtime.uninstallPlugin(pluginIdSchema.parse(pluginId)))
  handle(ipcChannels.windowCopyText, (_event, text) => {
    clipboard.writeText(z.string().max(10_000_000).parse(text))
  })
  handle(ipcChannels.windowMinimize, (event) => {
    BrowserWindow.fromWebContents(event.sender)?.minimize()
  })
  handle(ipcChannels.windowToggleMaximize, (event) => {
    const window = BrowserWindow.fromWebContents(event.sender)
    if (!window) return false
    if (window.isMaximized()) window.unmaximize()
    else window.maximize()
    return window.isMaximized()
  })
  handle(ipcChannels.windowClose, (event) => {
    BrowserWindow.fromWebContents(event.sender)?.close()
  })
  handle(ipcChannels.windowIsMaximized, (event) => BrowserWindow.fromWebContents(event.sender)?.isMaximized() ?? false)

  app.once('will-quit', () => {
    for (const channel of Object.values(ipcChannels)) {
      if (channel !== ipcChannels.event && channel !== ipcChannels.windowMaximizedChanged) ipcMain.removeHandler(channel)
    }
  })
}
