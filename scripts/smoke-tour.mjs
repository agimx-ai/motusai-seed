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
const root = await mkdtemp(join(tmpdir(), 'seed-tour-smoke-'));
const screenshots = await mkdtemp(join(tmpdir(), 'seed-tour-preview-'));
app.setPath('userData', join(root, 'user-data'));
app.on('window-all-closed', () => {});
protocol.registerSchemesAsPrivileged([
  { scheme: 'seed-plugin', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } },
]);
let view, owner;
const deadline = setTimeout(() => app.exit(1), 60000);

app.whenReady().then(async () => {
  let failed = false;
  try {
    const pluginRoot = join(root, 'plugin');
    await cp(resolve('packages/seed-sdk/tests/fixtures/generic'), pluginRoot, { recursive: true });
    await writeFile(join(pluginRoot, 'src/main.ts'), `
      import {Plugin, PluginSettingTab, Modal, createTour} from '@motus-ai/seed-sdk';
      import {ActionButton} from '@motus-ai/seed-sdk/react';
      import {createRoot} from 'react-dom/client';
      import {createElement} from 'react';
      class Settings extends PluginSettingTab {
        display() {
          this.containerEl.innerHTML = '<h2>SDK 引导验证</h2><p>隔离测试页面，不读写用户配置。</p><button class="seed-button" id="start-tour">Start tour</button> <button class="seed-button" id="start-hint">Feature hint</button><button class="seed-button" id="tour-feature" style="display:block;margin-top:32px">New feature</button><div style="height:380px"></div><button class="seed-button" id="tour-options">Feature options</button>';
          const reference = document.createElement('div');
          reference.style.cssText='position:absolute;left:-10000px';
          this.containerEl.append(reference);
          const react = createRoot(reference);
          react.render(createElement(ActionButton,{tone:'primary','data-tour-reference':true},'Reference'));
          this.register(()=>react.unmount());
          let modal;
          const closeModal = async () => { await modal?.close(); modal = undefined; };
          this.register(closeModal);
          const start = (hint) => {
            document.body.dataset.tourResult = '';
            const en = document.body.dataset.tourLocale === 'en';
            const tour = createTour({root:this.containerEl,owner:this,locale:en?'en':'zh-CN',steps:[
              {target:'#tour-feature',title:en?'New feature':'新功能',description:en?'Use this control to open the new feature. Long descriptions stay inside the window and wrap naturally without changing the page layout. '.repeat(8):'从这里打开新功能。引导样式与客户端保持一致。',beforeEnter:closeModal},
              ...hint?[]:[
                {target:'#tour-options',title:en?'Feature options':'功能选项',description:en?'The page scrolls to the highlighted control.':'页面会滚动到高亮控件。',beforeEnter:closeModal},
                {target:'#tour-dialog-feature',title:en?'Dialog option':'弹窗选项',description:en?'This hint stays above the native dialog. Finishing the tour leaves the dialog open.':'提示显示在原生弹窗之上，结束引导不会关闭业务弹窗。',beforeEnter:async()=>{
                  modal = new Modal(this.app);
                  modal.modalEl.dataset.pluginViewPortal = this.plugin.manifest.id;
                  modal.modalEl.style.cssText='margin:auto;width:360px';
                  modal.contentEl.innerHTML='<h2>Native SDK dialog</h2><button class="seed-button" id="tour-dialog-feature">Dialog option</button><button class="seed-button" id="close-tour-dialog">Close dialog</button>';
                  modal.contentEl.querySelector('#close-tour-dialog').onclick=()=>void closeModal();
                  await modal.open();
                }}
              ]
            ]});
            void tour.start().then(result=>document.body.dataset.tourResult=JSON.stringify(result));
          };
          this.containerEl.querySelector('#start-tour').onclick=()=>start(false);
          this.containerEl.querySelector('#start-hint').onclick=()=>start(true);
        }
      }
      export default class Example extends Plugin { onload(){this.addSettingTab(new Settings(this.app,this))} }
    `);
    const built = await buildPlugin({ root: pluginRoot, runtime: 'native-host', service: 'src/service.ts' });
    const inspected = await inspectPluginDirectory(built.output);
    const plugin = directoryRuntimePlugin(inspected, 'official');
    const createView = () => new SeedPluginViewHost(plugin, {
      loadData: async () => ({ revision: 0, data: null }),
      saveData: async () => { throw new Error('Tour must not save data'); },
      call: async () => { throw new Error('Tour must not call business services'); },
    }, { locale: 'zh-CN', theme: 'light' }, (error) => { throw error; });
    view = createView();
    const page = createPluginPage({ inspected, plugin, view, root });
    owner = page.owner;
    const errors = [];
    owner.webContents.on('console-message', (event) => { if (event.level === 'error') errors.push(event.message); });
    await page.load();
    const contents = owner.webContents;
    const evaluate = (source) => contents.executeJavaScript(source);
    const wait = async (source) => {
      const end = Date.now() + 6000;
      while (Date.now() < end) {
        if (await evaluate(source)) return;
        await new Promise((done) => setTimeout(done, 30));
      }
      throw new Error('Tour condition timed out: ' + source);
    };
    const clickNext = async () => {
      await wait('document.activeElement?.classList.contains("driver-popover-next-btn")');
      await evaluate('document.querySelector(".driver-popover-next-btn").click()');
    };
    const settled = () => wait(`(() => {
      const popover=document.querySelector('.seed-tour'), overlay=document.querySelector('.driver-overlay');
      return popover && overlay && document.activeElement?.classList.contains('driver-popover-next-btn') &&
        Number(getComputedStyle(popover).opacity) > .99 && Number(getComputedStyle(overlay).opacity) > .99;
    })()`);
    const checkGeometry = async () => {
      const metrics = await evaluate(`(() => {
        const popover = document.querySelector('.seed-tour'), r = popover.getBoundingClientRect();
        const point = document.elementFromPoint(r.left + 12, r.top + 12);
        const button = popover.querySelector('.driver-popover-next-btn'), b = getComputedStyle(button);
        const reference = document.querySelector('[data-tour-reference]'), s = getComputedStyle(reference);
        return {left:r.left,top:r.top,right:r.right,bottom:r.bottom,width:innerWidth,height:innerHeight,
          background:getComputedStyle(popover).backgroundColor,
          visible:popover===point||popover.contains(point),
          focus:popover.contains(document.activeElement),scope:popover.dataset.pluginViewPortal,
          overflow:popover.scrollWidth>popover.clientWidth+1,
          button:{height:button.getBoundingClientRect().height,fontSize:b.fontSize,radius:b.borderRadius,padding:b.padding,background:b.backgroundColor},
          reference:{height:reference.getBoundingClientRect().height,fontSize:s.fontSize,radius:s.borderRadius,padding:s.padding,background:s.backgroundColor}};
      })()`);
      assert(metrics.left >= 0 && metrics.top >= 0 && metrics.right <= metrics.width && metrics.bottom <= metrics.height);
      assert.equal(metrics.visible, true, 'Popover must be above the native dialog');
      assert.equal(metrics.focus, true);
      assert.equal(metrics.scope, plugin.package_id);
      assert.equal(metrics.overflow, false);
      assert.deepEqual(metrics.button, metrics.reference, 'Tour must use the existing ActionButton tokens and geometry');
      return metrics;
    };
    await wait('!!document.querySelector("#start-tour")');
    const metrics = [];
    for (const theme of ['light', 'dark']) for (const width of [960, 1280]) for (const locale of ['en', 'zh-CN']) {
      page.appearance(theme);
      owner.setSize(width, 720);
      await wait('innerWidth === ' + width + ' && document.documentElement.dataset.theme === ' + JSON.stringify(theme));
      await evaluate(`document.body.dataset.tourLocale=${JSON.stringify(locale)};document.querySelector('#start-tour').focus();document.querySelector('#start-tour').click()`);
      await settled();
      metrics.push({ theme, width, locale, ...(await checkGeometry()) });
      await writeFile(join(screenshots, theme + '-' + width + '-' + locale + '.png'), (await contents.capturePage()).toPNG());
      await clickNext();
      await wait('document.querySelector("#tour-options")?.classList.contains("driver-active-element")');
      await clickNext();
      await wait('!!document.querySelector("dialog[open] .driver-layer .seed-tour") && document.activeElement?.classList.contains("driver-popover-next-btn")');
      await settled();
      await checkGeometry();
      await writeFile(join(screenshots, theme + '-' + width + '-' + locale + '-dialog.png'), (await contents.capturePage()).toPNG());
      if (theme === 'light' && width === 960 && locale === 'en') {
        await evaluate('document.querySelector(".driver-popover-prev-btn").click()');
        await wait('!document.querySelector("dialog[open]") && document.querySelector("#tour-options")?.classList.contains("driver-active-element")');
        await clickNext();
        await wait('!!document.querySelector("dialog[open] .seed-tour")');
        await settled();
      }
      await clickNext();
      await wait('!!document.body.dataset.tourResult');
      assert.equal(await evaluate('JSON.parse(document.body.dataset.tourResult).status'), 'completed');
      assert.equal(await evaluate('!!document.querySelector("dialog[open]")'), true);
      assert.equal(await evaluate('document.activeElement.id'), 'tour-dialog-feature');
      assert.equal(await evaluate('!!document.querySelector(".seed-tour, .driver-overlay, .driver-layer")'), false);
      await evaluate('document.querySelector("#close-tour-dialog").click()');
    }
    owner.focus(); contents.focus();
    contents.debugger.attach('1.3');
    await contents.debugger.sendCommand('Emulation.setEmulatedMedia', {
      features: [{ name: 'prefers-reduced-motion', value: 'reduce' }],
    });
    await evaluate('document.querySelector("#start-hint").focus();document.querySelector("#start-hint").click()');
    await wait('document.activeElement?.classList.contains("driver-popover-next-btn")');
    assert.equal(await evaluate('document.body.classList.contains("driver-simple")'), true);
    assert.equal(await evaluate('getComputedStyle(document.querySelector(".seed-tour")).animationName'), 'none');
    contents.sendInputEvent({ type: 'keyDown', keyCode: 'Tab' });
    contents.sendInputEvent({ type: 'keyUp', keyCode: 'Tab' });
    await wait('document.querySelector(".seed-tour")?.contains(document.activeElement)');
    contents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
    contents.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' });
    await wait('!document.querySelector(".seed-tour")');
    assert.equal(await evaluate('JSON.parse(document.body.dataset.tourResult).reason'), 'escape');
    assert.equal(await evaluate('document.activeElement.id'), 'start-hint');
    contents.debugger.detach();
    await evaluate('document.querySelector("#start-tour").click()');
    await wait('!!document.querySelector(".seed-tour")');
    const next = createView();
    await page.replace(plugin, next, { keepSelection: true });
    view = next;
    await wait('!!document.querySelector("#start-tour") && !document.querySelector(".seed-tour, .driver-overlay, .driver-layer")');
    assert.deepEqual(errors, []);
    await writeFile(join(screenshots, 'metrics.json'), JSON.stringify(metrics, null, 2));
    process.stdout.write('Tour smoke passed: real product renderer, light/dark, 960/1280, Chinese/English, long copy, shared ActionButton tokens, scrolling, native dialog layer/back navigation, keyboard, focus, reduced motion, hot reload; no user data writes.\nScreenshots: ' + screenshots + '\n');
  } catch (error) {
    failed = true;
    process.stderr.write((error.stack ?? String(error)) + '\n');
    if (owner && !owner.isDestroyed()) {
      await writeFile(join(screenshots, 'failure.png'), (await owner.webContents.capturePage()).toPNG());
      const detail = await owner.webContents.executeJavaScript(`({body:document.body.className,focus:document.activeElement?.outerHTML,popover:document.querySelector('.seed-tour')?.outerHTML,result:document.body.dataset.tourResult})`);
      process.stderr.write(JSON.stringify(detail) + '\nScreenshots: ' + screenshots + '\n');
    }
  } finally {
    await view?.destroy();
    owner?.destroy();
    clearTimeout(deadline);
    await rm(root, { recursive: true, force: true });
    app.exit(failed ? 1 : 0);
  }
});
