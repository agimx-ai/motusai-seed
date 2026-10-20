import { BrowserWindow, ipcMain, session } from 'electron';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

const require = createRequire(import.meta.url);
const { SeedRuntime } = require('../dist/electron/main/runtime.js');
const { registerIpc } = require('../dist/electron/main/ipc.js');
const { registerPluginViewProtocol } = require('../dist/electron/main/plugin-view-host.js');
const { pluginHostContentSecurityPolicy } = require('../dist/electron/main/plugin-host-policy.js');
const { ipcChannels } = require('../dist/electron/shared/contracts.js');

/** Real product renderer and IPC/mount path, with isolated platform data and no Cloud/user writes. */
export function createPluginPage({ inspected, plugin, view, root, writeClipboardText }) {
  const installed = {
    id: plugin.package_id,
    visibility: 'public',
    name: inspected.manifest.name,
    description: inspected.manifest.description,
    labels: [],
    version: plugin.version,
    publisher: 'MotusAI',
    publisherType: 'official',
    runtimeKind: plugin.runtime_kind,
    manifestDigest: inspected.manifestDigest,
    iconDataUrl: inspected.iconDataUrl,
    iconDarkDataUrl: inspected.iconDarkDataUrl,
    capabilities: [],
    permissions: plugin.permissions,
    source: 'development',
    status: 'ready',
    enabled: true,
  };
  const snapshot = {
    appName: 'MotusAI Seed',
    appVersion: '0.2.15',
    platform: process.platform,
    architecture: process.arch,
    startup: { status: 'ready' },
    auth: { status: 'signed_in' },
    user: { id: 'layout-test', displayName: '隔离布局测试' },
    plugins: [installed],
    installedPluginsStatus: 'ready',
    catalogPlugins: [],
    pluginCatalogStatus: 'ready',
    localClients: [],
    audit: [],
    launchAtLogin: false,
    preventSystemSleep: false,
    languagePreference: 'zh-CN',
    locale: 'zh-CN',
    themePreference: 'light',
    update: { status: 'idle' },
    audio: { state: 'idle', durationMs: 0 },
    mascot: { state: 'idle', changedAt: new Date().toISOString(), activeTaskCount: 0 },
    navigationRequest: { id: 'layout-test', destination: 'plugins', pluginId: plugin.package_id },
  };
  const runtime = Object.assign(Object.create(SeedRuntime.prototype), {
    stopping: false,
    runtimePlugins: [plugin],
    pluginViewHosts: new Map([[plugin.package_id, view]]),
    pluginViewMounts: new Map(),
    pluginIsAuthorized: () => true,
    snapshot: () => structuredClone(snapshot),
    personalCreditWallet: async () => ({ available: 100 }),
  });
  let mountCount = 0;
  const mount = runtime.mountPluginView.bind(runtime);
  runtime.mountPluginView = (...args) => {
    mountCount++;
    return mount(...args);
  };
  registerIpc(runtime);
  if (writeClipboardText) {
    ipcMain.removeHandler(ipcChannels.windowCopyText);
    ipcMain.handle(ipcChannels.windowCopyText, (_event, text) => writeClipboardText(text));
  }
  const partition = 'seed-page-smoke-' + root.split('/').at(-1);
  const hostSession = session.fromPartition(partition);
  registerPluginViewProtocol(hostSession);
  hostSession.webRequest.onHeadersReceived((details, callback) =>
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [
          pluginHostContentSecurityPolicy('product', details, process.env.VITE_DEV_SERVER_URL),
        ],
      },
    }),
  );
  const owner = new BrowserWindow({
    title: 'MotusAI Seed — plugin page test',
    width: 960,
    height: 640,
    minWidth: 960,
    minHeight: 640,
    show: false,
    frame: process.platform !== 'win32',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    ...(process.platform === 'darwin' ? { trafficLightPosition: { x: 12, y: 16 } } : {}),
    webPreferences: {
      partition,
      preload: join(import.meta.dirname, '../dist/electron/preload/index.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
    },
  });
  return {
    runtime,
    owner,
    mountCount: () => mountCount,
    async replace(nextPlugin, nextView, { servicesReady = Promise.resolve(), keepSelection = false } = {}) {
      await view.destroy();
      runtime.pluginServicesReady = servicesReady;
      runtime.runtimePlugins = [nextPlugin];
      runtime.pluginViewHosts = new Map([[nextPlugin.package_id, nextView]]);
      runtime.pluginViewMounts.clear();
      view = nextView;
      plugin = nextPlugin;
      installed.id = nextPlugin.package_id;
      installed.name = nextPlugin.sdk_manifest.name;
      installed.runtimeKind = nextPlugin.runtime_kind;
      installed.manifestDigest = randomUUID();
      installed.version = nextPlugin.version;
      if (!keepSelection)
        snapshot.navigationRequest = { id: randomUUID(), destination: 'plugins', pluginId: nextPlugin.package_id };
      owner.webContents.send('seed:event', { type: 'snapshot.changed', snapshot: structuredClone(snapshot) });
    },
    async load() {
      if (process.env.VITE_DEV_SERVER_URL) await owner.loadURL(process.env.VITE_DEV_SERVER_URL);
      else await owner.loadFile(join(import.meta.dirname, '../dist/renderer/index.html'));
      owner.showInactive();
    },
    appearance(theme) {
      snapshot.themePreference = theme;
      owner.webContents.send('seed:event', { type: 'snapshot.changed', snapshot: structuredClone(snapshot) });
      view.setAppearance({ locale: 'zh-CN', theme });
    },
  };
}
