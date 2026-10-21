import { app, protocol } from 'electron';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { verifyPluginPage } from './verify-plugin-page.mjs';

const require = createRequire(import.meta.url);
const { inspectPluginDirectory, directoryRuntimePlugin } = require('../dist/electron/main/plugin-directory.js');
const { SeedPluginViewHost } = require('../dist/electron/main/plugin-view-host.js');
const { NativePluginManager } = require('../dist/electron/main/native-plugin-manager.js');
const { PluginCapabilityCatalog } = require('../dist/electron/main/plugin-capability-catalog.js');
const { SeedPluginSandboxSupervisor } = require('../dist/electron/main/plugin-sandbox-host.js');
const input = process.argv[2];
if (!input)
  throw new Error('Usage: electron scripts/smoke-plugin-project.mjs <built-project-directory> [capability.method]');
const project = resolve(input);
const clientPage = process.argv.includes('--page');
// Optional, trusted project-owned browser scenario. Never touches the user's installed data.
const scenario = process.env.SEED_PLUGIN_SMOKE_SCENARIO
  ? (await import(pathToFileURL(resolve(process.env.SEED_PLUGIN_SMOKE_SCENARIO)).href)).default
  : undefined;
const root = await mkdtemp(join(tmpdir(), 'seed-project-smoke-'));
const screenshots = await mkdtemp(join(tmpdir(), 'seed-project-preview-'));
app.setPath('userData', join(root, 'user-data'));
app.on('window-all-closed', () => {});
protocol.registerSchemesAsPrivileged([
  { scheme: 'seed-plugin', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } },
]);
let view, native, sandbox, owner;
const deadline = setTimeout(
  () => {
    process.stderr.write('Plugin project smoke timed out.\n');
    app.exit(1);
  },
  45_000 + Math.min(60_000, Math.max(0, Number(process.env.SEED_PLUGIN_SMOKE_REVIEW_MS) || 0)),
);

async function run() {
  let failed = false;
  try {
    const inspected = await inspectPluginDirectory(project);
    const { manifest } = inspected;
    const plugin = { ...directoryRuntimePlugin(inspected, 'official'), installation_id: scenario?.installationId };
    const catalog = new PluginCapabilityCatalog();
    let definitions = [];
    const secrets = new Map();
    const broker = async (_id, service, args) => {
      if (service === 'seed.plugin-capabilities') {
        catalog.publish(plugin, args.definitions);
        definitions = args.definitions;
        return null;
      }
      if (service === 'seed.plugin-settings' && args.operation === 'load')
        return Object.fromEntries(args.ids.map((id) => [id, { revision: '0'.repeat(64), value: null }]));
      if (service === 'seed.plugin-secret') {
        if (args.operation === 'get') return { value: secrets.get(args.key) };
        if (args.operation === 'set') {
          secrets.set(args.key, args.value);
          return { ok: true };
        }
        if (args.operation === 'delete') {
          secrets.delete(args.key);
          return { ok: true };
        }
      }
      if (
        service === 'seed.capabilities.invoke' &&
        args.invocation?.capability === 'agent_sessions' &&
        args.invocation?.method === 'models.list'
      )
        return { models: [] };
      if (service === 'seed.cloud.models' || service === 'seed.capabilities.list') return [];
      if (service === 'seed.audio' && args.operation === 'capture.sessions') return { sessions: [] };
      if (service === 'seed.plugin-event') {
        view?.sendEvent(args.name, args.data);
        return null;
      }
      if (service === 'seed.plugin.audit' || service === 'seed.plugin.diagnostic') return null;
      throw new Error('Unexpected broker request: ' + service);
    };
    native = new NativePluginManager(
      'Plugin Project Smoke',
      broker,
      () => undefined,
      (_id, event, error) => process.stderr.write(event + ': ' + error.message + '\n'),
      () => undefined,
      (_id, stream, chunk) => {
        if (stream === 'stderr') process.stderr.write(chunk);
      },
    );
    await mkdir(join(root, 'data'), { recursive: true });
    let snapshot;
    if (plugin.runtime_kind === 'sandboxed-web') {
      sandbox = new SeedPluginSandboxSupervisor(broker, (_id, event, message) => {
        if (event.endsWith('.failed')) process.stderr.write(message + '\n');
      });
      await sandbox.configure([plugin], 'zh-CN');
      snapshot = { capabilities: definitions.map((entry) => entry.id), capabilityDefinitions: definitions };
    } else
      snapshot = await native.start(plugin, {
        type: 'configure',
        appVersion: '0.2.15',
        locale: 'zh-CN',
        backupRoot: join(root, 'backups'),
        pluginDataRoot: join(root, 'data'),
        plugins: [plugin],
      });
    if (!snapshot.capabilityDefinitions?.length || Object.hasOwn(manifest.jsonManifest, 'capabilities'))
      throw new Error('The example must register capabilities from code, not the manifest.');
    if (catalog.capabilities(plugin).length !== snapshot.capabilityDefinitions.length)
      throw new Error('Host billing catalog did not receive code registrations.');
    if (process.argv[3] && !clientPage) {
      const [capability, method] = process.argv[3].split('.');
      const result = await native.call(plugin.package_id, {
        type: 'invoke',
        capability,
        method,
        chain: [],
        invocation: {
          request_id: 'project-smoke',
          arguments: { command: 'printf seed-project-smoke', timeout: 5 },
          context: { source: 'plugin', value: { cwd: root } },
        },
      });
      if (result.output?.trim() !== 'seed-project-smoke' || result.exit_code !== 0)
        throw new Error('Compiled command behavior changed.');
    }
    view = new SeedPluginViewHost(
      plugin,
      {
        loadData: async () => scenario?.loadData ? scenario.loadData() : ({ revision: 0, data: null }),
        saveData: async (_id, data, revision, assertActive) => {
          assertActive();
          if (scenario?.saveData) return scenario.saveData(data, revision);
          throw new Error('The example unexpectedly wrote user data.');
        },
        call: (id, method, args) => {
          if (scenario?.call) return scenario.call(method, args);
          return sandbox
            ? sandbox.callService(id, method, args)
            : native.call(id, { type: 'service-call', method, arguments: args });
        },
      },
      { locale: 'zh-CN', theme: 'light' },
      (error) => process.stderr.write(error.stack + '\n'),
    );
    const viewErrors = [];
    const { createPluginPage } = await import('./plugin-page-smoke.mjs');
    const page = createPluginPage({ inspected, plugin, view, root, writeClipboardText: scenario?.writeClipboardText });
    owner = page.owner;
    const contents = owner.webContents;
    contents.on('console-message', (event) => {
      if (event.level === 'error') viewErrors.push(event.message);
    });
    await page.load();
    await contents.executeJavaScript(`new Promise((resolve, reject) => {
      const deadline = Date.now() + 10000;
      const check = () => {
        if (document.querySelector('[data-plugin-view-owner]')?.textContent.trim()) return resolve(true);
        if (Date.now() >= deadline) return reject(new Error('Plugin DOM did not mount'));
        setTimeout(check, 25);
      }; check();
    })`);
    if (clientPage) {
      if (!scenario?.verifyPage) throw new Error('Client-page smoke requires a project-owned verifyPage scenario.');
      await scenario.verifyPage({ contents, view, owner, screenshots, page });
    } else {
      await verifyPluginPage({ contents, view, owner, screenshots, page });
      for (const theme of ['light', 'dark']) {
        page.appearance(theme);
        await new Promise((done) => setTimeout(done, 150));
        const state = await contents.executeJavaScript(`({
          node: typeof process, require: typeof require,
          text: document.querySelector('[data-plugin-view-owner]').textContent,
          overflow: document.documentElement.scrollWidth > innerWidth,
          frames: document.querySelectorAll('iframe, webview').length
        })`);
        if (
          state.node !== 'undefined' ||
          state.require !== 'undefined' ||
          !state.text.trim() ||
          state.overflow ||
          state.frames ||
          owner.contentView.children.length
        )
          throw new Error('Direct DOM plugin rendering failed: ' + JSON.stringify(state));
        await writeFile(join(screenshots, theme + '.png'), (await contents.capturePage()).toPNG());
      }
      if (scenario?.verify) await scenario.verify({ contents, view, owner, screenshots, page });
    }
    if (viewErrors.length) throw new Error('Plugin view console errors: ' + viewErrors.join('\n'));
    view.unmount();
    if (!snapshot.capabilities.length) throw new Error('The backend has no active functions.');
    process.stdout.write(
      JSON.stringify({
        plugin: plugin.package_id,
        capabilities: snapshot.capabilities,
        screenshots,
        status: 'passed',
      }) + '\n',
    );
  } catch (error) {
    failed = true;
    if (owner && !owner.isDestroyed()) {
      process.stderr.write((await owner.webContents.executeJavaScript('document.body.innerText')) + '\n');
    }
    process.stderr.write((error instanceof Error ? error.stack : String(error)) + '\n');
    process.stderr.write('Screenshots: ' + screenshots + '\n');
  } finally {
    await view?.destroy();
    owner?.destroy();
    sandbox?.destroy();
    await native?.stopAll();
    clearTimeout(deadline);
    await rm(root, { recursive: true, force: true });
    app.exit(failed ? 1 : 0);
  }
}
app
  .whenReady()
  .then(run)
  .catch((error) => {
    process.stderr.write(String(error) + '\n');
    app.exit(1);
  });
