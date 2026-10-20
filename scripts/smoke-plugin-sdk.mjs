import { app, protocol } from 'electron';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { buildPlugin } from '@motus-ai/seed-sdk/tools';
import { createPluginPage } from './plugin-page-smoke.mjs';
import { verifyPluginPage } from './verify-plugin-page.mjs';

const require = createRequire(import.meta.url);
const { SeedPluginViewHost } = require('../dist/electron/main/plugin-view-host.js');
const { NativePluginManager } = require('../dist/electron/main/native-plugin-manager.js');
const { SeedPluginSandboxSupervisor } = require('../dist/electron/main/plugin-sandbox-host.js');
const { inspectPluginDirectory, directoryRuntimePlugin } = require('../dist/electron/main/plugin-directory.js');
const root = await mkdtemp(join(tmpdir(), 'seed-sdk-smoke-'));
const screenshots = await mkdtemp(join(tmpdir(), 'seed-reload-preview-'));
app.setPath('userData', join(root, 'user-data'));
app.on('window-all-closed', () => {});
protocol.registerSchemesAsPrivileged([
  { scheme: 'seed-plugin', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } },
]);
let view, native, owner, sandbox, page;
const deadline = setTimeout(() => {
  process.stderr.write('SDK smoke timed out.\n');
  app.exit(1);
}, 45000);
async function run() {
  let failed = false;
  try {
    await cp(resolve('packages/seed-sdk/tests/fixtures/generic'), join(root, 'plugin'), { recursive: true });
    const source = join(root, 'plugin/src/main.ts');
    await writeFile(
      source,
      (await readFile(source, 'utf8'))
        .replace(
          'override display() {',
          "override async display() { this.containerEl.dataset.initialStatus = await this.app.service.call('status');",
        )
        .replace(
          "canvas.setAttribute('aria-label', 'Plugin-owned custom control');",
          "canvas.setAttribute('aria-label', 'Plugin-owned custom control'); canvas.className = 'w-[137px] dark:opacity-35';",
        )
        .replace(
          'this.settings = await this.loadData();',
          'this.settings = await this.loadData(); document.body.dataset.saved = JSON.stringify(this.settings);',
        ),
    );
    const built = await buildPlugin({ root: join(root, 'plugin'), runtime: 'native-host', service: 'src/service.ts' });
    const inspected = await inspectPluginDirectory(built.output);
    const plugin = directoryRuntimePlugin(inspected, 'official');
    native = new NativePluginManager(
      'SDK Smoke',
      async () => {
        throw new Error('Unexpected broker');
      },
      () => {},
      (_id, event, error) => process.stderr.write(event + ': ' + error.message + '\n'),
      () => {},
      (_id, stream, chunk) => {
        if (stream === 'stderr') process.stderr.write(chunk);
      },
    );
    await mkdir(join(root, 'data'), { recursive: true });
    const configure = (current) => ({
      type: 'configure',
      appVersion: '0.2.15',
      locale: 'en-US',
      backupRoot: join(root, 'backups'),
      pluginDataRoot: join(root, 'data'),
      plugins: [current],
    });
    await native.start(plugin, configure(plugin));
    let data = { revision: 7, data: { preference: 'kept across reload', pending: true } };
    const createView = (current) =>
      new SeedPluginViewHost(
        current,
        {
          loadData: async () => data,
          saveData: async (_id, value, revision, assertActive) => {
            assertActive();
            if (revision !== data.revision) throw new Error('Conflict');
            return (data = { revision: revision + 1, data: value });
          },
          call: (id, method, args, signal) =>
            current.runtime_kind === 'sandboxed-web'
              ? sandbox.callService(id, method, args, signal)
              : native.call(id, { type: 'service-call', method, arguments: args }),
        },
        { locale: 'en-US', theme: 'light' },
        (error) => process.stderr.write(error.stack + '\n'),
      );
    view = createView(plugin);
    page = createPluginPage({ inspected, plugin, view, root });
    owner = page.owner;
    const viewErrors = [];
    owner.webContents.on('console-message', (event) => {
      if (event.level === 'error') viewErrors.push(event.message);
    });
    await page.load();
    const contents = owner.webContents;
    const evaluate = (source) => contents.executeJavaScript(source);
    const wait = async (source) => {
      const end = Date.now() + 8000;
      while (Date.now() < end) {
        if (await evaluate(source)) return;
        await new Promise((done) => setTimeout(done, 20));
      }
      throw new Error('DOM condition not reached: ' + source + '\n' + (await evaluate('document.body.innerText')));
    };
    await wait('!!document.querySelector("canvas")');
    for (const theme of ['light', 'dark']) {
      page.appearance(theme);
      for (const width of [960, 1200]) {
        owner.setSize(width, 700);
        await wait(
          `innerWidth === ${width} && getComputedStyle(document.querySelector('canvas')).opacity === '${theme === 'dark' ? '0.35' : '1'}'`,
        );
        const visual = await evaluate(`({ width: getComputedStyle(document.querySelector('canvas')).width,
          frames: document.querySelectorAll('iframe, webview').length, node: typeof process, require: typeof require,
          overflow: document.documentElement.scrollWidth > innerWidth })`);
        if (
          visual.width !== '137px' ||
          visual.frames ||
          owner.contentView.children.length ||
          visual.node !== 'undefined' ||
          visual.require !== 'undefined' ||
          visual.overflow
        )
          throw new Error('Independent styles/direct DOM check failed: ' + JSON.stringify(visual));
      }
    }
    if (process.env.VITE_DEV_SERVER_URL) {
      if ((await evaluate('typeof window.$RefreshReg$')) !== 'function') throw new Error('Vite React preamble missing');
      await evaluate(`import(${JSON.stringify(new URL(process.env.VITE_DEV_SERVER_URL).origin + '/@vite/client')}).then(({ createHotContext }) => new Promise((resolve, reject) => {
        const hot = createHotContext('/seed-sdk-smoke'), id = crypto.randomUUID();
        const timeout = setTimeout(() => reject(new Error('HMR socket failed')), 5000);
        const receive = value => { if (value.id !== id) return; clearTimeout(timeout); hot.off('seed-smoke:pong', receive); resolve(true); };
        hot.on('seed-smoke:pong', receive); hot.send('seed-smoke:ping', { id });
      }))`);
    }
    await evaluate('document.querySelector(".seed-setting button").click()');
    await wait(`document.querySelector('.seed-settings').dataset.result === '${process.platform}'`);
    // Rebuild the same plugin version and replace its runtime generation without touching saved data.
    await writeFile(
      source,
      (await readFile(source, 'utf8')).replace('Custom view', 'Reloaded view').replace('137px', '141px'),
    );
    const service = join(root, 'plugin/src/service.ts');
    await writeFile(
      service,
      (await readFile(service, 'utf8')).replace('() => platform()', "() => platform() + '-reloaded'"),
    );
    const refreshed = await buildPlugin({
      root: join(root, 'plugin'),
      runtime: 'native-host',
      service: 'src/service.ts',
    });
    const reloaded = {
      ...directoryRuntimePlugin(await inspectPluginDirectory(refreshed.output), 'official'),
      configuration_revision: 'rebuilt',
    };
    const next = createView(reloaded);
    let releaseStartup;
    const servicesReady = new Promise((done) => { releaseStartup = done; })
      .then(() => native.start(reloaded, configure(reloaded)));
    await page.replace(reloaded, next, { servicesReady, keepSelection: true });
    view = next;
    await new Promise((done) => setTimeout(done, 150));
    if (await evaluate('!!document.querySelector("canvas") || !!document.querySelector("[role=alert]")'))
      throw new Error('Frontend opened or failed before replacement backend was ready');
    releaseStartup();
    await wait(
      '!!document.querySelector("canvas") && getComputedStyle(document.querySelector("canvas")).width === "141px"',
    );
    const restored = await evaluate('({ text: document.body.textContent, saved: document.body.dataset.saved })');
    if (!restored.text.includes('Reloaded view') || restored.saved !== JSON.stringify(data.data) || data.revision !== 7)
      throw new Error('Same-version frontend reload lost saved data');
    if (
      (await native.call(plugin.package_id, { type: 'service-call', method: 'status', arguments: {} })) !==
      process.platform + '-reloaded'
    )
      throw new Error('Service reload failed');
    if ((await evaluate('document.querySelector(".seed-settings").dataset.initialStatus')) !== process.platform + '-reloaded')
      throw new Error('The page did not initialize against its replacement backend');
    await writeFile(join(screenshots, 'dark-1200.png'), (await contents.capturePage()).toPNG());
    // Repeat while remaining on the page; a fresh navigation request must not hide a reload regression.
    for (let cycle = 0; cycle < 3; cycle++) {
      const theme = cycle === 1 ? 'dark' : 'light';
      const width = cycle === 2 ? 1200 : 960;
      page.appearance(theme);
      owner.setSize(width, 700);
      const repeated = { ...reloaded, configuration_revision: 'repeat-' + cycle };
      const repeatedView = createView(repeated);
      let release;
      const ready = new Promise((done) => { release = done; }).then(() => native.start(repeated, configure(repeated)));
      await page.replace(repeated, repeatedView, { servicesReady: ready, keepSelection: true });
      view = repeatedView;
      release();
      await wait('document.querySelector(".seed-settings")?.dataset.initialStatus === ' + JSON.stringify(process.platform + '-reloaded'));
      await wait(`innerWidth === ${width}`);
      await writeFile(join(screenshots, `${theme}-${width}.png`), (await contents.capturePage()).toPNG());
    }
    await verifyPluginPage({ contents, owner, screenshots, page });
    await evaluate('document.querySelector("header nav button").click()');
    await wait('!document.querySelector("[data-plugin-view-owner]")');
    if ((await native.call(plugin.package_id, { type: 'service-call', method: 'status', arguments: {} })) !== process.platform + '-reloaded')
      throw new Error('Navigation stopped the backend');
    await cp(resolve('packages/seed-sdk/tests/fixtures/sandbox'), join(root, 'sandbox'), { recursive: true });
    const browserBuild = await buildPlugin({ root: join(root, 'sandbox'), service: 'src/service.ts' });
    const browserPlugin = directoryRuntimePlugin(await inspectPluginDirectory(browserBuild.output), 'official');
    sandbox = new SeedPluginSandboxSupervisor(
      async () => {
        throw new Error('Unexpected sandbox broker');
      },
      (_id, event, message) => {
        if (event.endsWith('.failed')) process.stderr.write(event + ': ' + message + '\n');
      },
    );
    await sandbox.configure([browserPlugin]);
    if ((await sandbox.callService(browserPlugin.package_id, 'status', {})) !== 'sandbox')
      throw new Error('Sandbox service failed');
    const browserView = createView(browserPlugin);
    await page.replace(browserPlugin, browserView);
    view = browserView;
    await wait('!!document.querySelector(".seed-setting button")');
    await evaluate('document.querySelector(".seed-setting button").click()');
    await wait('document.querySelector(".seed-settings").dataset.result === "sandbox"');
    const cancelled = new AbortController();
    const pending = sandbox.callService(browserPlugin.package_id, 'wait', {}, cancelled.signal);
    setTimeout(() => cancelled.abort(new Error('smoke cancel')), 30);
    try {
      await pending;
      throw new Error('Cancelled sandbox call succeeded');
    } catch (error) {
      if (error.message !== 'smoke cancel') throw error;
    }
    if ((await sandbox.callService(browserPlugin.package_id, 'status', {})) !== 'sandbox')
      throw new Error('Cancellation stopped service');
    if (viewErrors.length) throw new Error('Renderer errors: ' + viewErrors.join('\n'));
    process.stdout.write(
      'SDK smoke passed: direct DOM, independent styles, native/sandbox isolation, RPC, cancellation, navigation, delayed startup and four same-version reloads on the open page with saved data.\n',
    );
    process.stdout.write('Reload screenshots: ' + screenshots + '\n');
  } catch (error) {
    failed = true;
    process.stderr.write((error instanceof Error ? error.stack : String(error)) + '\n');
  } finally {
    await view?.destroy();
    owner?.destroy();
    await native?.stopAll();
    sandbox?.destroy();
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
