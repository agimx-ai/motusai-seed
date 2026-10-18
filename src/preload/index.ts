import { contextBridge, ipcRenderer, webUtils } from 'electron';
import type {
  AuditQueryInput,
  SeedApi,
  SeedEvent,
  SeedLanguagePreference,
  SeedThemePreference,
  SeedWindowApi,
  TerminalLogUploadRange,
} from '../shared/contracts';

const ipcChannels = {
  dismissAnnouncement: 'seed:announcements:dismiss',
  activateAnnouncement: 'seed:announcements:activate',
  announcementBackground: 'seed:announcements:background',
  mountPluginView: 'seed:plugins:mount-view',
  pluginViewMessage: 'seed:plugins:view-message',
  pluginViewEvent: 'seed:plugins:view-event',
  unmountPluginView: 'seed:plugins:unmount-view',
  listOrphanedPluginData: 'seed:plugins:list-orphaned-data',
  resetOrphanedPluginData: 'seed:plugins:reset-orphaned-data',
  snapshot: 'seed:snapshot',
  signIn: 'seed:account:sign-in',
  cancelSignIn: 'seed:account:cancel-sign-in',
  personalCreditWallet: 'seed:credits:personal-wallet',
  personalCreditGrants: 'seed:credits:personal-grants',
  logout: 'seed:account:logout',
  openWebsite: 'seed:distribution:open-website',
  openPersonalWallet: 'seed:credits:open-personal-wallet',
  readProfile: 'seed:account:read-profile',
  updateProfile: 'seed:account:update-profile',
  launchAtLogin: 'seed:settings:launch-at-login',
  preventSystemSleep: 'seed:settings:prevent-system-sleep',
  languagePreference: 'seed:settings:language-preference',
  themePreference: 'seed:settings:theme-preference',
  checkForUpdates: 'seed:updates:check',
  downloadUpdate: 'seed:updates:download',
  installUpdate: 'seed:updates:install',
  clearAudit: 'seed:audit:clear',
  queryAudit: 'seed:audit:query',
  queryUsage: 'seed:usage:query',
  uploadLogs: 'seed:logs:upload',
  cancelLogUpload: 'seed:logs:cancel-upload',
  refreshPluginCatalog: 'seed:plugins:refresh-catalog',
  installPlugin: 'seed:plugins:install',
  loadMorePluginCatalog: 'seed:plugins:load-more-catalog',
  searchPluginCatalog: 'seed:plugins:search-catalog',
  uninstallPlugin: 'seed:plugins:uninstall',
  cancelPluginInstall: 'seed:plugins:cancel-install',
  windowMinimize: 'seed:window:minimize',
  windowToggleMaximize: 'seed:window:toggle-maximize',
  windowCopyText: 'seed:window:copy-text',
  windowClose: 'seed:window:close',
  windowIsMaximized: 'seed:window:is-maximized',
  windowMaximizedChanged: 'seed:window:maximized-changed',
  event: 'seed:event',
} as const;

const api: SeedApi = {
  dismissAnnouncement: (id) => ipcRenderer.invoke(ipcChannels.dismissAnnouncement, id),
  activateAnnouncement: (id) => ipcRenderer.invoke(ipcChannels.activateAnnouncement, id),
  announcementBackground: (id) => ipcRenderer.invoke(ipcChannels.announcementBackground, id),
  mountPluginView: (input) => ipcRenderer.invoke(ipcChannels.mountPluginView, input),
  sendPluginViewMessage: (token, message) => ipcRenderer.invoke(ipcChannels.pluginViewMessage, token, message),
  onPluginViewEvent: (listener) => {
    const receive = (_event: Electron.IpcRendererEvent, value: import('../shared/plugin-view').PluginViewEvent) =>
      listener(value);
    ipcRenderer.on(ipcChannels.pluginViewEvent, receive);
    return () => {
      ipcRenderer.removeListener(ipcChannels.pluginViewEvent, receive);
    };
  },
  unmountPluginView: (token) => ipcRenderer.invoke(ipcChannels.unmountPluginView, token),
  listOrphanedPluginData: () => ipcRenderer.invoke(ipcChannels.listOrphanedPluginData),
  resetOrphanedPluginData: (ids) => ipcRenderer.invoke(ipcChannels.resetOrphanedPluginData, ids),
  snapshot: () => ipcRenderer.invoke(ipcChannels.snapshot),
  personalCreditWallet: () => ipcRenderer.invoke(ipcChannels.personalCreditWallet),
  personalCreditGrants: (cursor?: string) => ipcRenderer.invoke(ipcChannels.personalCreditGrants, cursor),
  signIn: () => ipcRenderer.invoke(ipcChannels.signIn),
  cancelSignIn: () => ipcRenderer.invoke(ipcChannels.cancelSignIn),
  logout: () => ipcRenderer.invoke(ipcChannels.logout),
  openWebsite: () => ipcRenderer.invoke(ipcChannels.openWebsite),
  openPersonalWallet: () => ipcRenderer.invoke(ipcChannels.openPersonalWallet),
  readProfile: () => ipcRenderer.invoke(ipcChannels.readProfile),
  updateProfile: (input) => ipcRenderer.invoke(ipcChannels.updateProfile, input),
  setLaunchAtLogin: (enabled: boolean) => ipcRenderer.invoke(ipcChannels.launchAtLogin, enabled),
  setPreventSystemSleep: (enabled: boolean) => ipcRenderer.invoke(ipcChannels.preventSystemSleep, enabled),
  setLanguagePreference: (preference: SeedLanguagePreference) =>
    ipcRenderer.invoke(ipcChannels.languagePreference, preference),
  setThemePreference: (preference: SeedThemePreference) => ipcRenderer.invoke(ipcChannels.themePreference, preference),
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
  searchPluginCatalog: (query: string, cursor?: string) =>
    ipcRenderer.invoke(ipcChannels.searchPluginCatalog, query, cursor),
  installPlugin: (pluginId: string, version: string) =>
    ipcRenderer.invoke(ipcChannels.installPlugin, pluginId, version),
  cancelPluginInstall: (pluginId: string) => ipcRenderer.invoke(ipcChannels.cancelPluginInstall, pluginId),
  uninstallPlugin: (pluginId: string) => ipcRenderer.invoke(ipcChannels.uninstallPlugin, pluginId),
  subscribe(listener: (event: SeedEvent) => void) {
    const handler = (_event: Electron.IpcRendererEvent, payload: SeedEvent) => listener(payload);
    ipcRenderer.on(ipcChannels.event, handler);
    return () => ipcRenderer.removeListener(ipcChannels.event, handler);
  },
};

const windowApi: SeedWindowApi = {
  platform: process.platform,
  getPathForFile: (file) => webUtils.getPathForFile(file),
  copyText: (text) => ipcRenderer.invoke(ipcChannels.windowCopyText, text),
  reportDiagnostic: (input) => ipcRenderer.send('seed:diagnostic:renderer', input),
  minimize: () => ipcRenderer.invoke(ipcChannels.windowMinimize),
  toggleMaximize: () => ipcRenderer.invoke(ipcChannels.windowToggleMaximize),
  close: () => ipcRenderer.invoke(ipcChannels.windowClose),
  isMaximized: () => ipcRenderer.invoke(ipcChannels.windowIsMaximized),
  subscribeMaximized(listener: (maximized: boolean) => void) {
    const handler = (_event: Electron.IpcRendererEvent, maximized: boolean) => listener(maximized);
    ipcRenderer.on(ipcChannels.windowMaximizedChanged, handler);
    return () => ipcRenderer.removeListener(ipcChannels.windowMaximizedChanged, handler);
  },
};

contextBridge.exposeInMainWorld('motusSeed', api);
contextBridge.exposeInMainWorld('motusWindow', windowApi);
