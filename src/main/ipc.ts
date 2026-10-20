import { app, BrowserWindow, clipboard, ipcMain } from 'electron';
import { z } from 'zod';
import {
  auditQuerySchema,
  installPluginSchema,
  mountPluginViewSchema,
  pluginIdSchema,
  terminalLogUploadRangeSchema,
} from '../shared/validation';
import { ipcChannels } from '../shared/contracts';
import type { SeedRuntime } from './runtime';

function assertTrustedSender(event: Electron.IpcMainInvokeEvent) {
  if (event.senderFrame !== event.sender.mainFrame) throw new Error('拒绝来自子页面的 IPC 请求。');
  const url = event.senderFrame?.url || '';
  const trusted =
    url.startsWith('file://') || (process.env.VITE_DEV_SERVER_URL && url.startsWith(process.env.VITE_DEV_SERVER_URL));
  if (!trusted) throw new Error('拒绝来自未知页面的 IPC 请求。');
}

function handle<T extends unknown[], R>(
  channel: string,
  action: (event: Electron.IpcMainInvokeEvent, ...args: T) => R | Promise<R>,
) {
  ipcMain.handle(channel, async (event, ...args: T) => {
    assertTrustedSender(event);
    return action(event, ...args);
  });
}

export function registerIpc(runtime: SeedRuntime) {
  handle(ipcChannels.pluginViewMessage, (event, token, message) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    if (!window) throw new Error('Plugin view requires the product window.');
    return runtime.sendPluginViewMessage(window, z.string().uuid().parse(token), message);
  });
  handle(ipcChannels.mountPluginView, (event, input) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    if (!window) throw new Error('Plugin view requires the product window.');
    return runtime.mountPluginView(window, mountPluginViewSchema.parse(input));
  });
  handle(ipcChannels.unmountPluginView, (event, token) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    if (window) runtime.unmountPluginView(window, z.string().uuid().parse(token));
  });
  handle(ipcChannels.snapshot, () => runtime.snapshot());
  handle(ipcChannels.personalCreditWallet, () => runtime.personalCreditWallet());
  handle(ipcChannels.personalCreditGrants, (_event, cursor) =>
    runtime.personalCreditGrants(z.string().regex(/^\d+$/).optional().parse(cursor)),
  );
  handle(ipcChannels.signIn, () => runtime.signIn());
  handle(ipcChannels.dismissAnnouncement, (_event, id) => runtime.dismissAnnouncement(z.uuid().parse(id)));
  handle(ipcChannels.activateAnnouncement, (_event, id) => runtime.activateAnnouncement(z.uuid().parse(id)));
  handle(ipcChannels.announcementBackground, (_event, id) => runtime.announcementBackground(z.uuid().parse(id)));
  handle(ipcChannels.cancelSignIn, () => runtime.cancelSignIn());
  handle(ipcChannels.logout, () => runtime.logout());
  handle(ipcChannels.openWebsite, () => runtime.openWebsite());
  handle(ipcChannels.openPersonalWallet, () => runtime.openPersonalWallet());
  handle(ipcChannels.readProfile, () => runtime.readProfile());
  handle(ipcChannels.updateProfile, (_event, input) =>
    runtime.updateProfile(
      z
        .object({
          displayName: z.string().trim().min(1).max(120),
          username: z
            .string()
            .trim()
            .regex(/^[A-Za-z0-9][A-Za-z0-9_.-]{2,79}$/),
          avatarDataUrl: z.string().max(512_000).startsWith('data:image/webp;base64,').optional(),
        })
        .strict()
        .parse(input),
    ),
  );
  handle(ipcChannels.launchAtLogin, (_event, enabled) => runtime.setLaunchAtLogin(z.boolean().parse(enabled)));
  handle(ipcChannels.preventSystemSleep, (_event, enabled) =>
    runtime.setPreventSystemSleep(z.boolean().parse(enabled)),
  );
  handle(ipcChannels.autoUpdatePlugins, (_event, enabled) =>
    runtime.setAutoUpdatePlugins(z.boolean().parse(enabled)),
  );
  handle(ipcChannels.languagePreference, (_event, preference) =>
    runtime.setLanguagePreference(z.enum(['system', 'zh-CN', 'en-US']).parse(preference)),
  );
  handle(ipcChannels.themePreference, (_event, preference) =>
    runtime.setThemePreference(z.enum(['light', 'dark', 'system']).parse(preference)),
  );
  handle(ipcChannels.checkForUpdates, () => runtime.checkForUpdates());
  handle(ipcChannels.downloadUpdate, () => runtime.downloadUpdate());
  handle(ipcChannels.installUpdate, () => runtime.installUpdate());
  handle(ipcChannels.clearAudit, () => runtime.clearAudit());
  handle(ipcChannels.queryAudit, (_event, input) => runtime.queryAudit(auditQuerySchema.parse(input)));
  handle(ipcChannels.queryUsage, () => runtime.queryUsage());
  handle(ipcChannels.uploadLogs, (_event, input) => runtime.uploadLogs(terminalLogUploadRangeSchema.parse(input)));
  handle(ipcChannels.cancelLogUpload, () => runtime.cancelLogUpload());
  handle(ipcChannels.refreshPluginCatalog, () => runtime.refreshPluginCatalog());
  handle(ipcChannels.loadMorePluginCatalog, () => runtime.loadMorePluginCatalog());
  handle(ipcChannels.searchPluginCatalog, (_event, query, cursor) =>
    runtime.searchPluginCatalog(z.string().max(500).parse(query), z.string().max(1_000).optional().parse(cursor)),
  );
  handle(ipcChannels.installPlugin, (_event, pluginId, version) => {
    const input = installPluginSchema.parse({ pluginId, version });
    return runtime.installPlugin(input.pluginId, input.version);
  });
  handle(ipcChannels.updateAllPlugins, () => runtime.updateAllPlugins());
  handle(ipcChannels.cancelPluginInstall, (_event, pluginId) =>
    runtime.cancelPluginInstall(pluginIdSchema.parse(pluginId)),
  );
  handle(ipcChannels.uninstallPlugin, (_event, pluginId) => runtime.uninstallPlugin(pluginIdSchema.parse(pluginId)));
  handle(ipcChannels.listOrphanedPluginData, () => runtime.listOrphanedPluginData());
  handle(ipcChannels.resetOrphanedPluginData, (_event, ids) =>
    runtime.resetOrphanedPluginData(z.array(pluginIdSchema).max(500).parse(ids)),
  );
  handle(ipcChannels.windowCopyText, (_event, text) => {
    clipboard.writeText(z.string().max(10_000_000).parse(text));
  });
  handle(ipcChannels.windowMinimize, (event) => {
    BrowserWindow.fromWebContents(event.sender)?.minimize();
  });
  handle(ipcChannels.windowToggleMaximize, (event) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    if (!window) return false;
    if (window.isMaximized()) window.unmaximize();
    else window.maximize();
    return window.isMaximized();
  });
  handle(ipcChannels.windowClose, (event) => {
    BrowserWindow.fromWebContents(event.sender)?.close();
  });
  handle(ipcChannels.windowIsMaximized, (event) => BrowserWindow.fromWebContents(event.sender)?.isMaximized() ?? false);

  app.once('will-quit', () => {
    for (const channel of Object.values(ipcChannels)) {
      if (channel !== ipcChannels.event && channel !== ipcChannels.windowMaximizedChanged)
        ipcMain.removeHandler(channel);
    }
  });
}
