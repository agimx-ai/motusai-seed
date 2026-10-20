import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { app, BrowserWindow, protocol } from 'electron';
import { buildPlugin } from '@motus-ai/seed-sdk/tools';

const require = createRequire(import.meta.url);
const { SeedPluginSandboxSupervisor } = require('../dist/electron/main/plugin-sandbox-host.js');
const { inspectPluginDirectory, directoryRuntimePlugin } = require('../dist/electron/main/plugin-directory.js');
const temporary = await mkdtemp(join(tmpdir(), 'seed-plugin-isolation-'));
app.setPath('userData', join(temporary, 'user-data'));
protocol.registerSchemesAsPrivileged([
  { scheme: 'seed-plugin', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } },
]);
const watchdog = setTimeout(() => {
  process.stderr.write('Electron plugin isolation smoke timed out.\n');
  app.exit(2);
}, 30_000);

async function waitFor(check) {
  const deadline = Date.now() + 10_000;
  while (!(await check())) {
    if (Date.now() >= deadline) throw new Error('Plugin recovery timed out.');
    await new Promise((done) => setTimeout(done, 50));
  }
}

app.whenReady().then(async () => {
  const reports = [];
  const supervisor = new SeedPluginSandboxSupervisor(
    async (_packageId, service) => {
      if (service === 'seed.plugin-capabilities') return null;
      throw new Error('Unexpected fixture broker: ' + service);
    },
    (packageId, event, message) => reports.push({ packageId, event, message }),
  );
  let failed = false;
  try {
    const plugins = [];
    for (const name of ['one', 'two']) {
      const root = join(temporary, name);
      await cp(resolve('packages/seed-sdk/tests/fixtures/sandbox'), root, { recursive: true });
      const manifest = JSON.parse(await readFile(join(root, 'manifest.json'), 'utf8'));
      await writeFile(join(root, 'manifest.json'), JSON.stringify({ ...manifest, id: 'com.example.' + name }));
      const { output } = await buildPlugin({ root, service: 'src/service.ts' });
      plugins.push(directoryRuntimePlugin(await inspectPluginDirectory(output), 'official'));
    }
    await supervisor.configure(plugins);
    const windows = BrowserWindow.getAllWindows();
    if (windows.length !== 2) throw new Error('Expected two isolated service processes; got ' + windows.length);
    const processes = windows.map((window) => window.webContents.getOSProcessId());
    if (new Set(processes).size !== 2) throw new Error('Plugins share a renderer process.');
    for (const plugin of plugins)
      if ((await supervisor.callService(plugin.package_id, 'status', {})) !== 'sandbox')
        throw new Error('New SDK service was not loaded.');

    windows[0].webContents.forcefullyCrashRenderer();
    await waitFor(() => reports.some((entry) => entry.event === 'plugin.process.gone'));
    await waitFor(async () => {
      try {
        return (await supervisor.callService(plugins[0].package_id, 'status', {})) === 'sandbox';
      } catch {
        return false;
      }
    });
    await waitFor(
      () =>
        BrowserWindow.getAllWindows().length === 2 &&
        !BrowserWindow.getAllWindows().some((window) => window.webContents.getOSProcessId() === processes[0]),
    );
    const recovered = BrowserWindow.getAllWindows();
    if (recovered.length !== 2 || !recovered.some((window) => window.webContents.getOSProcessId() === processes[1]))
      throw new Error('Crashing one plugin restarted its healthy sibling.');
    if (!reports.some((entry) => entry.event === 'plugin.process.gone')) throw new Error('Crash was not reported.');
    await supervisor.configure([]);
    if (BrowserWindow.getAllWindows().length !== 0) throw new Error('Unload left a plugin process running.');
    process.stdout.write(
      'New SDK sandbox services: separate processes, crash recovery, healthy sibling preserved, unload cleanup passed.\n',
    );
  } catch (error) {
    failed = true;
    process.stderr.write(String(error.stack || error) + '\n');
  } finally {
    await supervisor.destroy();
    await rm(temporary, { recursive: true, force: true });
    clearTimeout(watchdog);
    app.exit(failed ? 1 : 0);
  }
});
