import { contextBridge, ipcRenderer } from 'electron'
import type { AuditQueryInput, InvokePluginManagementActionInput, QueryPluginConfigurationOptionsInput, QueryPluginConfigurationProfileStatusesInput, QueryPluginManagementViewInput, ReconnectPluginConfigurationProfileInput, SeedApi, SeedEvent, SeedLanguagePreference, SeedThemePreference, SeedWindowApi, TerminalLogUploadRange, UpdatePluginConfigurationInput } from '../shared/contracts'

const ipcChannels = {
  snapshot: 'seed:snapshot', signIn: 'seed:account:sign-in', cancelSignIn: 'seed:account:cancel-sign-in',
  personalCreditWallet: 'seed:credits:personal-wallet',
  personalCreditGrants: 'seed:credits:personal-grants',
  logout: 'seed:account:logout',
  openWebsite: 'seed:distribution:open-website',
  openPersonalWallet: 'seed:credits:open-personal-wallet',
  revokePluginCapabilityGrant: 'seed:plugins:revoke-capability-grant',
  respondPluginCapabilityApproval: 'seed:plugins:respond-capability-approval',
  launchAtLogin: 'seed:settings:launch-at-login', preventSystemSleep: 'seed:settings:prevent-system-sleep',
  languagePreference: 'seed:settings:language-preference',
  themePreference: 'seed:settings:theme-preference',
  pluginConfiguration: 'seed:plugins:update-configuration',
  pluginConfigurationOptions: 'seed:plugins:query-configuration-options',
  pluginConfigurationProfileStatuses: 'seed:plugins:query-configuration-profile-statuses',
  pluginConfigurationProfileReconnect: 'seed:plugins:reconnect-configuration-profile',
  pluginManagementView: 'seed:plugins:query-management-view',
  pluginManagementAction: 'seed:plugins:invoke-management-action',
  checkForUpdates: 'seed:updates:check', downloadUpdate: 'seed:updates:download', installUpdate: 'seed:updates:install',
  clearAudit: 'seed:audit:clear',
  queryAudit: 'seed:audit:query',
  queryUsage: 'seed:usage:query',
  uploadLogs: 'seed:logs:upload',
  cancelLogUpload: 'seed:logs:cancel-upload',
  refreshPluginCatalog: 'seed:plugins:refresh-catalog', installPlugin: 'seed:plugins:install',
  loadMorePluginCatalog: 'seed:plugins:load-more-catalog',
  searchPluginCatalog: 'seed:plugins:search-catalog',
  uninstallPlugin: 'seed:plugins:uninstall',
  windowMinimize: 'seed:window:minimize', windowToggleMaximize: 'seed:window:toggle-maximize',
  windowClose: 'seed:window:close', windowIsMaximized: 'seed:window:is-maximized',
  windowMaximizedChanged: 'seed:window:maximized-changed', event: 'seed:event',
} as const

const api: SeedApi = {
  snapshot: () => ipcRenderer.invoke(ipcChannels.snapshot),
  personalCreditWallet: () => ipcRenderer.invoke(ipcChannels.personalCreditWallet),
  personalCreditGrants: (cursor?: string) => ipcRenderer.invoke(ipcChannels.personalCreditGrants, cursor),
  signIn: () => ipcRenderer.invoke(ipcChannels.signIn),
  cancelSignIn: () => ipcRenderer.invoke(ipcChannels.cancelSignIn),
  logout: () => ipcRenderer.invoke(ipcChannels.logout),
  openWebsite: () => ipcRenderer.invoke(ipcChannels.openWebsite),
  openPersonalWallet: () => ipcRenderer.invoke(ipcChannels.openPersonalWallet),
  revokePluginCapabilityGrant: (id: string) => ipcRenderer.invoke(ipcChannels.revokePluginCapabilityGrant, id),
  respondPluginCapabilityApproval: (requestId: string, allowed: boolean) => ipcRenderer.invoke(ipcChannels.respondPluginCapabilityApproval, requestId, allowed),
  setLaunchAtLogin: (enabled: boolean) => ipcRenderer.invoke(ipcChannels.launchAtLogin, enabled),
  setPreventSystemSleep: (enabled: boolean) => ipcRenderer.invoke(ipcChannels.preventSystemSleep, enabled),
  setLanguagePreference: (preference: SeedLanguagePreference) => ipcRenderer.invoke(ipcChannels.languagePreference, preference),
  setThemePreference: (preference: SeedThemePreference) => ipcRenderer.invoke(ipcChannels.themePreference, preference),
  updatePluginConfiguration: (input: UpdatePluginConfigurationInput) => ipcRenderer.invoke(ipcChannels.pluginConfiguration, input),
  queryPluginConfigurationOptions: (input: QueryPluginConfigurationOptionsInput) => ipcRenderer.invoke(ipcChannels.pluginConfigurationOptions, input),
  queryPluginConfigurationProfileStatuses: (input: QueryPluginConfigurationProfileStatusesInput) => ipcRenderer.invoke(ipcChannels.pluginConfigurationProfileStatuses, input),
  reconnectPluginConfigurationProfile: (input: ReconnectPluginConfigurationProfileInput) => ipcRenderer.invoke(ipcChannels.pluginConfigurationProfileReconnect, input),
  queryPluginManagementView: (input: QueryPluginManagementViewInput) => ipcRenderer.invoke(ipcChannels.pluginManagementView, input),
  invokePluginManagementAction: (input: InvokePluginManagementActionInput) => ipcRenderer.invoke(ipcChannels.pluginManagementAction, input),
  checkForUpdates: () => ipcRenderer.invoke(ipcChannels.checkForUpdates),
  downloadUpdate: () => ipcRenderer.invoke(ipcChannels.downloadUpdate),
  installUpdate: () => ipcRenderer.invoke(ipcChannels.installUpdate),
  clearAudit: () => ipcRenderer.invoke(ipcChannels.clearAudit),
  queryAudit: (input: AuditQueryInput) => ipcRenderer.invoke(ipcChannels.queryAudit, input),
  queryUsage: () => ipcRenderer.invoke(ipcChannels.queryUsage),
  uploadLogs: (input: TerminalLogUploadRange) => ipcRenderer.invoke(ipcChannels.uploadLogs, input),
  cancelLogUpload: () => ipcRenderer.invoke(ipcChannels.cancelLogUpload),
  refreshPluginCatalog: () => ipcRenderer.invoke(ipcChannels.refreshPluginCatalog),
  loadMorePluginCatalog: () => ipcRenderer.invoke(ipcChannels.loadMorePluginCatalog),
  searchPluginCatalog: (query: string, cursor?: string) => ipcRenderer.invoke(ipcChannels.searchPluginCatalog, query, cursor),
  installPlugin: (pluginId: string, version: string) => ipcRenderer.invoke(ipcChannels.installPlugin, pluginId, version),
  uninstallPlugin: (pluginId: string) => ipcRenderer.invoke(ipcChannels.uninstallPlugin, pluginId),
  subscribe(listener: (event: SeedEvent) => void) {
    const handler = (_event: Electron.IpcRendererEvent, payload: SeedEvent) => listener(payload)
    ipcRenderer.on(ipcChannels.event, handler)
    return () => ipcRenderer.removeListener(ipcChannels.event, handler)
  },
}

const windowApi: SeedWindowApi = {
  platform: process.platform,
  reportDiagnostic: (input) => ipcRenderer.send('seed:diagnostic:renderer', input),
  minimize: () => ipcRenderer.invoke(ipcChannels.windowMinimize),
  toggleMaximize: () => ipcRenderer.invoke(ipcChannels.windowToggleMaximize),
  close: () => ipcRenderer.invoke(ipcChannels.windowClose),
  isMaximized: () => ipcRenderer.invoke(ipcChannels.windowIsMaximized),
  subscribeMaximized(listener: (maximized: boolean) => void) {
    const handler = (_event: Electron.IpcRendererEvent, maximized: boolean) => listener(maximized)
    ipcRenderer.on(ipcChannels.windowMaximizedChanged, handler)
    return () => ipcRenderer.removeListener(ipcChannels.windowMaximizedChanged, handler)
  },
}

contextBridge.exposeInMainWorld('motusSeed', api)
contextBridge.exposeInMainWorld('motusWindow', windowApi)
