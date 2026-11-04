import { app, protocol } from 'electron';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import { buildPlugin } from '@motus-ai/seed-sdk/tools';
import { createPluginPage } from './plugin-page-smoke.mjs';

const require = createRequire(import.meta.url);
const { SeedPluginViewHost } = require('../dist/electron/main/plugin-view-host.js');
const { inspectPluginDirectory, directoryRuntimePlugin } = require('../dist/electron/main/plugin-directory.js');
const root = await mkdtemp(join(tmpdir(), 'seed-sidebar-smoke-'));
const screenshots = await mkdtemp(join(tmpdir(), 'seed-sidebar-preview-'));
app.setPath('userData', join(root, 'user-data'));
app.on('window-all-closed', () => {});
protocol.registerSchemesAsPrivileged([{ scheme: 'seed-plugin', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } }]);
const deadline = setTimeout(() => app.exit(1), 90000);
const views = [];
let owner;
app.whenReady().then(async () => {
  let failed = false;
  try {
    const fixture = async (name, parent) => {
      const path = join(root, name);
      await cp(resolve('packages/seed-sdk/tests/fixtures/generic'), path, { recursive: true });
      const manifest = JSON.parse(await readFile(join(path, 'manifest.json'), 'utf8'));
      manifest.id = 'com.example.' + name;
      await writeFile(join(path, 'manifest.json'), JSON.stringify(manifest));
      await writeFile(join(path, 'src/main.ts'), `
        import { Plugin, View } from '@motus-ai/seed-sdk';
        class Page extends View {
          route = {}; getViewType() { return 'page'; } getDisplayText() { return '${name}'; }
          async setState(state) { this.route = state; }
          async onOpen() {
            this.containerEl.dataset.fixture = '${name}';
            this.containerEl.dataset.record = this.route.record;
            if (this.route.record === 'broken') throw new Error('Page failed to open');
            this.containerEl.innerHTML = '<p>${name}</p><input aria-label="Draft"/><div style="height:1400px"></div><p>End of plugin page</p>';
          }
        }
        export default class Example extends Plugin {
          onload() {
            this.registerView('page', host => new Page(this.app, host), { toolbar: false });
            const root = this.addNavigationItem({ id: 'root', title: '${name}', icon: 'folder', ${parent ? `parent: { host: '${parent}' },` : ''} });
            const page = this.addNavigationItem({ id: 'record', title: '${name} record', icon: 'messages-square', view: 'page', parent: { item: 'root' }, params: { record: '123' }, badge: 2 });
            this.addNavigationItem({ id: 'broken', title: '${name} broken', view: 'page', parent: { item: 'root' }, params: { record: 'broken' } });
            if (!this.app.sidebar?.supportsHost?.('quick-actions')) throw new Error('Missing quick actions host');
            this.addNavigationItem({
              id: 'create', title: '${name} create', icon: 'message-circle', parent: { host: 'quick-actions' },
              onSelect: () => { document.body.dataset.quickAction = '${name}'; },
            });
            this.registerEvent(this.app.events.on('appearance-change', () => page.update({ title: this.app.locale === 'en-US' ? '${name} record' : '${name} 记录' })));
          }
        }
      `);
      const built = await buildPlugin({ root: path, runtime: 'native-host', service: 'src/service.ts' });
      const inspected = await inspectPluginDirectory(built.output);
      const plugin = directoryRuntimePlugin(inspected, 'official');
      const view = new SeedPluginViewHost(plugin, {
        loadData: async () => ({ revision: 0, data: null }),
        saveData: async () => { throw new Error('No writes allowed in sidebar smoke'); },
        call: async () => { throw new Error('No business calls allowed in sidebar smoke'); },
      }, { locale: 'en-US', theme: 'light' }, error => { throw error; });
      views.push(view);
      return { inspected, plugin, view };
    };
    const docs = await fixture('documents', 'overview');
    const monitor = await fixture('monitor');
    const page = createPluginPage({ ...docs, root, extraPlugins: [monitor] });
    owner = page.owner;
    const snapshot = page.runtime.snapshot();
    delete snapshot.navigationRequest;
    snapshot.locale = snapshot.languagePreference = 'en-US';
    page.runtime.snapshot = () => structuredClone(snapshot);
    const errors = [];
    owner.webContents.on('console-message', event => { if (event.level === 'error') errors.push(event.message); });
    await page.load();
    const evaluate = source => owner.webContents.executeJavaScript(source);
    const wait = async source => {
      const until = Date.now() + 8000;
      while (Date.now() < until) { if (await evaluate(source)) return; await new Promise(resolve => setTimeout(resolve, 30)); }
      throw new Error('Sidebar condition timed out: ' + source);
    };
    const clickLabel = label => evaluate(`(()=>{const label=[...document.querySelectorAll('aside button span')].find(el=>el.textContent===${JSON.stringify(label)});if(!label)throw Error('Missing navigation button');label.closest('button').click()})()`);
    await wait(`document.querySelector('aside')?.textContent.includes('documents record') && document.querySelector('aside')?.textContent.includes('monitor record')`);
    assert.equal(await evaluate(`(() => {
      const buttons = Array.from(document.querySelectorAll('aside nav button'));
      const levels = [buttons[0], ...['documents', 'documents record'].map(title =>
        buttons.find(button => button.querySelector('span')?.textContent === title))];
      const iconPositions = levels.map(button => button.querySelector('svg').getBoundingClientRect().left);
      const rows = levels.map(button => button.closest('li').firstElementChild.getBoundingClientRect());
      return iconPositions[1] - iconPositions[0] === 12 && iconPositions[2] - iconPositions[1] === 12 &&
        rows.every(row => row.left === rows[0].left && row.right === rows[0].right);
    })()`), true, 'Each child level indents its content while keeping a full-width row');
    const quickTrigger = 'aside button[aria-haspopup="menu"][aria-label="Quick actions"]';
    const quickMenu = `document.querySelector('[role="menu"][aria-label="Quick actions"], [role="menu"][aria-label="快捷操作"]')`;
    const openQuickActions = () => evaluate(`document.querySelector(${JSON.stringify(quickTrigger)}).click()`);
    assert.equal(await evaluate(`!document.querySelector('aside nav')?.textContent.includes('documents create')`), true);
    await openQuickActions();
    await wait(`document.activeElement?.textContent === 'documents create'`);
    await evaluate(`document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }))`);
    await wait(`document.activeElement?.textContent === 'monitor create'`);
    await evaluate(`document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
    await wait(`document.activeElement === document.querySelector(${JSON.stringify(quickTrigger)}) && !${quickMenu}`);
    await openQuickActions();
    await wait(`!!${quickMenu}`);
    await evaluate(`document.querySelector('main').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))`);
    await wait(`!${quickMenu}`);
    await openQuickActions();
    await wait(`!!${quickMenu}`);
    await evaluate(`[...${quickMenu}.querySelectorAll('button')].find(item => item.textContent === 'monitor create').click()`);
    await wait(`document.body.dataset.quickAction === 'monitor' && !${quickMenu}`);
    assert.equal(await evaluate(`!![...document.querySelectorAll('aside button')].find(el=>el.textContent.includes('documents record'))?.querySelector('svg.lucide-messages-square')`), true);
    assert.equal(await evaluate('!!document.querySelector("[data-plugin-view-surface]")'), false, 'Navigation registered before any plugin detail was opened');
    await clickLabel('documents record');
    await wait(`document.querySelector('[data-fixture="documents"]')?.dataset.record === '123'`);
    assert.equal(await evaluate('document.querySelector(".seed-plugin-toolbar").hidden'), true);
    await clickLabel('documents broken');
    await wait(`document.querySelector('main [role="alert"]')?.textContent === 'Page failed to open'`);
    assert.equal(await evaluate(`document.querySelector('aside')?.textContent.includes('documents record')`), true);
    await clickLabel('documents record');
    await wait(`document.querySelector('[data-fixture="documents"]')?.dataset.record === '123' && !document.querySelector('main [role="alert"]')`);
    await clickLabel('monitor record');
    await wait(`!!document.querySelector('[data-fixture="monitor"]')`);
    assert.equal(await evaluate('document.querySelectorAll("[data-plugin-view-owner]").length'), 1);
    assert.equal(await evaluate('document.querySelectorAll("iframe, webview").length'), 0);
    for (const theme of ['light', 'dark']) for (const width of [960, 1280]) for (const locale of ['zh-CN', 'en-US']) {
      Object.assign(snapshot, { themePreference: theme, locale, languagePreference: locale });
      owner.webContents.send('seed:event', { type: 'snapshot.changed', snapshot: structuredClone(snapshot) });
      for (const view of views) view.setAppearance({ theme, locale });
      owner.setSize(width, 720);
      const title = locale === 'en-US' ? 'monitor record' : 'monitor 记录';
      await wait(`document.documentElement.lang === ${JSON.stringify(locale)} && document.documentElement.dataset.theme === ${JSON.stringify(theme)} && document.querySelector('aside')?.textContent.includes(${JSON.stringify(title)})`);
      assert.equal(await evaluate('document.documentElement.scrollWidth > innerWidth'), false);
      await writeFile(join(screenshots, `${theme}-${width}-${locale}.png`), (await owner.webContents.capturePage()).toPNG());
      const triggerSelector = `aside button[aria-label="${locale === 'en-US' ? 'Quick actions' : '快捷操作'}"]`;
      await evaluate(`document.querySelector(${JSON.stringify(triggerSelector)}).click()`);
      await wait(`!!${quickMenu}`);
      assert.equal(await evaluate(`(() => {
        const sidebar = document.querySelector('aside').getBoundingClientRect();
        const trigger = document.querySelector(${JSON.stringify(triggerSelector)}).getBoundingClientRect();
        const popup = ${quickMenu};
        const menu = popup.getBoundingClientRect();
        const pointer = popup.querySelector('svg').getBoundingClientRect();
        const center = trigger.left + trigger.width / 2;
        const centered = Math.abs(center - menu.left - menu.width / 2) < 1;
        const pointed = Math.abs(center - pointer.left - pointer.width / 2) < 1 && pointer.top < menu.top;
        return centered && pointed && menu.right > sidebar.right && menu.right <= innerWidth - 8;
      })()`), true);
      if (width === 960) {
        await evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
        await writeFile(join(screenshots, `quick-actions-${theme}-${locale}.png`), (await owner.webContents.capturePage({ x: 0, y: 30, width: 320, height: 160 })).toPNG());
      }
      await evaluate(`document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
      await wait(`!${quickMenu}`);
    }
    owner.maximize(); await wait('innerWidth > 1280');
    owner.unmaximize(); await wait('innerWidth === 1280');
    await evaluate('document.querySelector("main").scrollTop = 0');
    owner.webContents.sendInputEvent({ type: 'mouseWheel', x: 700, y: 500, deltaY: -500, deltaX: 0, canScroll: true });
    await wait('document.querySelector("main").scrollTop > 0');
    const monitorInstalled = snapshot.plugins.find(plugin => plugin.id === monitor.plugin.package_id);
    monitorInstalled.enabled = false;
    owner.webContents.send('seed:event', { type: 'snapshot.changed', snapshot: structuredClone(snapshot) });
    await wait(`!document.querySelector('aside')?.textContent.includes('monitor record') && !document.querySelector('[data-fixture="monitor"]')`);
    await openQuickActions();
    await wait(`!!${quickMenu}`);
    assert.equal(await evaluate(`${quickMenu}.textContent`), 'documents create');
    await monitor.view.destroy();
    assert.deepEqual(errors, []);
    process.stdout.write('Sidebar smoke passed: two unrelated SDK plugins, background registration, host and top-level groups, isolated view routing/state, no redundant toolbar, disable cleanup, light/dark, Chinese/English, 960/1280, maximize/restore and native scrolling.\nScreenshots: ' + screenshots + '\n');
  } catch (error) {
    failed = true;
    process.stderr.write((error.stack ?? String(error)) + '\n');
    if (owner && !owner.isDestroyed()) await writeFile(join(screenshots, 'failure.png'), (await owner.webContents.capturePage()).toPNG());
    process.stderr.write('Screenshots: ' + screenshots + '\n');
  } finally {
    await Promise.allSettled(views.map(view => view.destroy()));
    owner?.destroy(); clearTimeout(deadline);
    await rm(root, { recursive: true, force: true });
    app.exit(failed ? 1 : 0);
  }
});
