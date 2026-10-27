import assert from 'node:assert/strict';
import { app, protocol } from 'electron';
import { createRequire } from 'node:module';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { createPluginPage } from './plugin-page-smoke.mjs';

const require = createRequire(import.meta.url);
assert.equal(
  process.env.VITE_DEV_SERVER_URL,
  undefined,
  'Run this smoke against the production renderer, without Vite.',
);
const { SeedRuntime } = require('../dist/electron/main/runtime.js');
const { SeedPluginViewHost } = require('../dist/electron/main/plugin-view-host.js');
const { SeedPluginSandboxSupervisor } = require('../dist/electron/main/plugin-sandbox-host.js');
const { PluginCapabilityCatalog } = require('../dist/electron/main/plugin-capability-catalog.js');
const { PluginDevelopmentStatusWriter } = require('../dist/electron/main/plugin-development-status.js');
const { inspectPluginDirectory, directoryRuntimePlugin } = require('../dist/electron/main/plugin-directory.js');
const { buildPlugin } = await import('../packages/seed-sdk/dist/tools/index.mjs');
const root = await mkdtemp(join(tmpdir(), 'seed-development-mode-'));
const screenshots = await mkdtemp(join(tmpdir(), 'seed-development-mode-preview-'));
const project = join(root, 'plugin source with spaces');
const userData = join(root, 'user-data');
const directory = join(userData, 'plugins/development');
const id = 'com.example.development-mode';
app.setPath('userData', userData);
app.on('window-all-closed', () => {});
protocol.registerSchemesAsPrivileged([
  { scheme: 'seed-plugin', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } },
]);
let runtime, page, view, child;
let output = '';
const deadline = setTimeout(() => {
  console.error('Development mode smoke timed out.');
  app.exit(1);
}, 60_000);
const wait = async (check, label) => {
  const end = Date.now() + 10_000;
  while (Date.now() < end) {
    if (await check()) return;
    await delay(50);
  }
  throw new Error(label + '\n' + output);
};

async function run() {
  let failed = false;
  try {
    await mkdir(join(project, 'src'), { recursive: true });
    await writeFile(
      join(project, 'manifest.json'),
      JSON.stringify({
        id,
        name: 'Development probe',
        version: '1.0.0',
        minAppVersion: '0.3.11',
        description: 'Isolated test',
        author: 'Example',
      }),
    );
    await writeFile(
      join(project, 'package.json'),
      JSON.stringify({ private: true, type: 'module', keywords: ['utilities'] }),
    );
    await writeFile(
      join(project, 'build.mjs'),
      `import { buildPlugin } from ${JSON.stringify(pathToFileURL(resolve('packages/seed-sdk/dist/tools/index.mjs')).href)}; await buildPlugin({ root: import.meta.dirname, service: 'src/service.ts' });`,
    );
    await writeFile(
      join(project, 'src/main.ts'),
      "import { Plugin } from '@motus-ai/seed-sdk'; export default class extends Plugin {}\n",
    );
    const source =
      "import { PluginService } from '@motus-ai/seed-sdk'; export default class extends PluginService { onload() { this.registerMethod('value', () => 'first'); } }\n";
    await writeFile(join(project, 'src/service.ts'), source);
    await buildPlugin({ root: project, service: 'src/service.ts' });
    let enabled = false;
    runtime = Object.assign(Object.create(SeedRuntime.prototype), {
      stopping: false,
      pluginReloadWork: Promise.resolve(),
      pluginServicesReady: Promise.resolve(),
      pluginDevelopmentWork: Promise.resolve(),
      developmentPluginStates: {},
      runtimePlugins: [],
      installedPlugins: [],
      pluginInstaller: {
        pruneInactiveVersions: async () => {},
        listInstalled: async () => [],
        listRuntimePlugins: async () => [],
      },
      store: {
        auditSystem: async () => {},
        pluginDevelopmentEnabled: () => enabled,
        setPluginDevelopmentEnabled: async (value) => {
          enabled = value;
        },
        languagePreference: () => 'zh-CN',
      },
      diagnostics: { record: () => {} },
      nativeHost: { stop: async () => {} },
      pluginBrowserAuthorization: { cancelPlugin: () => {} },
      creditBilling: { closePluginRelayStreams: async () => {} },
      billedRelayStreams: new Map(),
      capabilityCalls: new Map(),
      sandboxCalls: new Map(),
      sandboxTasks: new Map(),
      pluginCapabilityCatalog: new PluginCapabilityCatalog(),
      pluginEvents: { closePlugin: () => {} },
      systemNotifications: { clear: () => {} },
      pluginViewHosts: new Map(),
      publishSnapshot: async () => {
        if (page)
          page.owner.webContents.send('seed:event', { type: 'snapshot.changed', snapshot: page.runtime.snapshot() });
      },
      configureWorker: async () => {
        for (const plugin of runtime.runtimePlugins)
          await runtime.handleWorkerEvent({
            type: 'plugin.runtime.ready',
            packageId: plugin.package_id,
            configurationRevision: plugin.configuration_revision,
          });
      },
    });
    runtime.sandboxHost = new SeedPluginSandboxSupervisor(
      async (_id, service) => {
        if (service === 'seed.plugin-capabilities' || service === 'seed.plugin.diagnostic') return null;
        throw new Error('Unexpected broker service: ' + service);
      },
      (packageId, event, message, details) => {
        if (event === 'plugin.configure.failed')
          void runtime.handleWorkerEvent({
            type: 'plugin.runtime.failed',
            packageId,
            message,
            configurationRevision: details?.configuration_revision,
          });
      },
    );
    runtime.developmentStatus = new PluginDevelopmentStatusWriter(
      directory,
      '0.3.11',
      () => ({ enabled, plugins: { ...runtime.developmentPluginStates } }),
      (error) => {
        throw error;
      },
    );
    await runtime.developmentStatus.start();
    child = spawn(
      process.execPath,
      [resolve('packages/seed-sdk/dist/tools/cli.mjs'), 'dev', '--directory', directory],
      {
        cwd: project,
        env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    child.stdout.on('data', (chunk) => {
      output += chunk.toString();
    });
    child.stderr.on('data', (chunk) => {
      output += chunk.toString();
    });
    await wait(() => output.includes('mode off'), 'CLI did not identify disabled mode');

    const inspected = await inspectPluginDirectory(join(project, 'dist'));
    const plugin = directoryRuntimePlugin(inspected, 'official');
    view = new SeedPluginViewHost(
      plugin,
      {
        loadData: async () => ({ revision: 0, data: null }),
        saveData: async () => {
          throw new Error('Unexpected write');
        },
        call: (owner, method, args) => runtime.sandboxHost.callService(owner, method, args),
      },
      { locale: 'zh-CN', theme: 'light' },
      (error) => {
        throw error;
      },
    );
    page = createPluginPage({ inspected, plugin, view, root });
    const snapshot = page.runtime.snapshot;
    let theme = 'light';
    page.runtime.snapshot = () => ({
      ...snapshot(),
      navigationRequest: undefined,
      themePreference: theme,
      plugins: runtime.installedPlugins,
      autoUpdatePlugins: true,
      pluginDevelopmentEnabled: enabled,
    });
    page.runtime.setPluginDevelopmentEnabled = (value) => runtime.setPluginDevelopmentEnabled(value);
    await page.load();
    page.owner.webContents.setBackgroundThrottling(false);
    page.owner.hide();
    page.owner.webContents.on('console-message', (event) => {
      if (event.level === 'error') console.error('Renderer:', event.message);
    });
    const evaluate = (source) => page.owner.webContents.executeJavaScript(source);
    await wait(
      async () => await evaluate(`Boolean(document.querySelector('[aria-controls="account-menu"]'))`),
      'Account menu did not render',
    );
    await evaluate(`document.querySelector('[aria-controls="account-menu"]').click()`);
    await wait(
      async () => await evaluate('Boolean(document.querySelector("#account-menu"))'),
      'Account menu did not open',
    );
    await evaluate(
      `Array.from(document.querySelectorAll('#account-menu button')).find(button => button.textContent.trim() === '设置').click()`,
    );
    await wait(
      async () => await evaluate(`Boolean(document.querySelector('nav[aria-label="集成"] button'))`),
      'Settings navigation did not render',
    );
    await evaluate(`document.querySelector('nav[aria-label="集成"] button').click()`);
    const toggle = 'document.querySelector(\'[role=switch][aria-label="插件开发模式"]\')';
    await wait(async () => await evaluate(`Boolean(${toggle})`), 'Development switch did not render');
    assert.equal(await evaluate(`${toggle}.getAttribute('aria-checked')`), 'false');
    await evaluate(`${toggle}.click()`);
    await wait(() => output.includes('Seed loaded this build'), 'CLI did not receive a real backend acknowledgement');
    assert.equal(await runtime.sandboxHost.callService(id, 'value', {}), 'first');
    await writeFile(join(project, 'src/service.ts'), source.replace("'first'", "'second'"));
    await wait(async () => {
      try {
        return (await runtime.sandboxHost.callService(id, 'value', {})) === 'second';
      } catch {
        return false;
      }
    }, 'Source change did not reach the isolated backend');
    await wait(
      () => (output.match(/Seed loaded this build/g) ?? []).length >= 2,
      'New build was not acknowledged separately',
    );
    await writeFile(
      join(project, 'src/service.ts'),
      source.replace("this.registerMethod('value', () => 'first');", "throw new Error('isolated startup failure');"),
    );
    await wait(
      () => output.includes('Seed could not load this build: isolated startup failure'),
      'Startup failure was reported as successful loading',
    );
    await writeFile(join(project, 'src/service.ts'), source.replace("'first'", "'recovered'"));
    await wait(async () => {
      try {
        return (await runtime.sandboxHost.callService(id, 'value', {})) === 'recovered';
      } catch {
        return false;
      }
    }, 'A fixed build did not recover');

    await wait(
      () => (output.match(/Seed loaded this build/g) ?? []).length >= 3,
      'Recovered build was not acknowledged',
    );
    for (const appearance of ['light', 'dark']) {
      theme = appearance;
      await runtime.publishSnapshot();
      await delay(100);
      await writeFile(join(screenshots, theme + '.png'), (await page.owner.webContents.capturePage()).toPNG());
    }
    await evaluate(`${toggle}.click()`);
    await wait(
      () => !enabled && runtime.runtimePlugins.length === 0,
      'Disabling mode did not unload the development backend',
    );
    await wait(
      () => output.lastIndexOf('mode off') > output.lastIndexOf('Seed loaded this build'),
      'CLI did not observe disabling mode',
    );
    await assert.rejects(async () => runtime.sandboxHost.callService(id, 'value', {}));
    console.log(
      JSON.stringify({
        status: 'passed',
        mode: 'production renderer without Vite',
        checks: [
          'UI opt-in and opt-out',
          'real sandbox readiness',
          'exact-build CLI acknowledgement',
          'hot reload',
          'startup failure and recovery',
          'backend unload',
        ],
        screenshots,
      }),
    );
  } catch (error) {
    failed = true;
    console.error(error);
    if (page && !page.owner.isDestroyed())
      console.error(await page.owner.webContents.executeJavaScript('document.body.innerText'));
    console.error(output);
  } finally {
    clearTimeout(deadline);
    if (runtime) {
      runtime.stopping = true;
      await runtime.developmentPlugins?.stop();
      await runtime.pluginReloadWork.catch(() => {});
      await runtime.developmentStatus?.stop();
      runtime.sandboxHost?.destroy();
    }
    await view?.destroy();
    page?.owner.destroy();
    if (child && child.exitCode === null && child.signalCode === null) {
      const closed = new Promise((resolve) => child.once('close', resolve));
      child.kill(process.platform === 'win32' ? undefined : 'SIGINT');
      await closed;
    }
    await rm(root, { recursive: true, force: true });
    app.exit(failed ? 1 : 0);
  }
}
app
  .whenReady()
  .then(run)
  .catch((error) => {
    console.error(error);
    app.exit(1);
  });
