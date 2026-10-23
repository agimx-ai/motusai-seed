import { app, protocol } from 'electron';
import { cp, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { buildPlugin } from '@motus-ai/seed-sdk/tools';
import { createPluginPage } from './plugin-page-smoke.mjs';
import { verifyPluginPage } from './verify-plugin-page.mjs';

const require = createRequire(import.meta.url);
const { SeedPluginViewHost } = require('../dist/electron/main/plugin-view-host.js');
const { inspectPluginDirectory, directoryRuntimePlugin } = require('../dist/electron/main/plugin-directory.js');
const root = await mkdtemp(join(tmpdir(), 'seed-navigation-smoke-'));
const screenshots = await mkdtemp(join(tmpdir(), 'seed-navigation-preview-'));
app.setPath('userData', join(root, 'user-data'));
app.on('window-all-closed', () => {});
protocol.registerSchemesAsPrivileged([
  { scheme: 'seed-plugin', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } },
]);
let view, owner;
const deadline = setTimeout(() => app.exit(1), 90000);

app.whenReady().then(async () => {
  let failed = false;
  try {
    const pluginRoot = join(root, 'plugin');
    await cp(resolve('packages/seed-sdk/tests/fixtures/generic'), pluginRoot, { recursive: true });
    await writeFile(join(pluginRoot, 'src/main.ts'), `
      import {Plugin, PluginSettingTab} from '@motus-ai/seed-sdk';
      class Settings extends PluginSettingTab {
        display() {
          this.containerEl.dataset.pageGeneration = crypto.randomUUID();
          this.containerEl.innerHTML = '<p id="route">Root</p><input id="draft" aria-label="Draft"/><button class="seed-button" id="open">Open detail</button><button class="seed-button" id="back">Back</button><button class="seed-button" id="release">Finish navigation</button><div style="height:1400px"></div><p>Natural document flow</p>';
          let depth = 0, finish;
          const labels = () => this.app.locale === 'en-US'
            ? ['Rules','Morning briefing','Execution detail'] : ['规则','早间简报','执行详情'];
          const path = () => labels().slice(0, depth).map((label,index) => ({id:String(index),label:document.body.dataset.longPath==='true'&&index===0?label.repeat(12):label}));
          const route = this.containerEl.querySelector('#route');
          const navigation = this.app.navigation.create({signal:this.signal,onNavigate:async(id,signal)=>{
            document.body.dataset.requests=String(Number(document.body.dataset.requests||0)+1);
            if(document.body.dataset.mode==='decline') return false;
            if(document.body.dataset.mode==='wait') await new Promise(resolve=>finish=resolve);
            signal.throwIfAborted();
            depth=id===null?0:Number(id)+1;
            route.textContent=depth?labels()[depth-1]:'Root';
          }});
          this.register(navigation.dispose);
          this.registerEvent(this.app.events.on('appearance-change',()=>navigation.setPath(path())));
          this.containerEl.querySelector('#open').onclick=()=>{
            try {depth=3;navigation.setPath(path());route.textContent=labels()[2];}
            catch(error){document.body.dataset.stale=error.message;}
          };
          this.containerEl.querySelector('#back').onclick=()=>void navigation.back().then(result=>document.body.dataset.backResult=String(result));
          this.containerEl.querySelector('#release').onclick=()=>finish?.();
        }
      }
      export default class Example extends Plugin {onload(){this.addSettingTab(new Settings(this.app,this))}}
    `);
    const built = await buildPlugin({ root: pluginRoot, runtime: 'native-host', service: 'src/service.ts' });
    const inspected = await inspectPluginDirectory(built.output);
    const plugin = directoryRuntimePlugin(inspected, 'official');
    const createView = () => new SeedPluginViewHost(plugin, {
      loadData: async () => ({ revision: 0, data: null }),
      saveData: async () => { throw new Error('Navigation smoke must not save data'); },
      call: async () => { throw new Error('Navigation smoke must not call business services'); },
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
      throw new Error('Navigation condition timed out: ' + source);
    };
    const current = async (text) => {
      await wait(`document.querySelector('.seed-app-header [aria-current="page"]')?.textContent === ${JSON.stringify(text)}`);
      const info = await evaluate(`(() => ({
        child:document.querySelectorAll('.seed-header-breadcrumb').length>1,
        visible:document.querySelector('[data-plugin-information]')?.checkVisibility(),
      }))()`);
      assert.equal(info.visible, !info.child, 'Plugin information follows the SDK path');
    };
    const headerButton = (index) => `.seed-app-header nav button:nth-of-type(${index})`;
    const click = (selector) => evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
    const capture = async (name) => {
      await evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
      await writeFile(join(screenshots, name + '.png'), (await contents.capturePage()).toPNG());
    };
    const appearance = (theme, locale) => {
      const snapshot = page.runtime.snapshot();
      Object.assign(snapshot, { themePreference: theme, locale, languagePreference: locale });
      page.runtime.snapshot = () => structuredClone(snapshot);
      contents.send('seed:event', { type: 'snapshot.changed', snapshot });
      view.setAppearance({ locale, theme });
    };
    await wait('!!document.querySelector("#open")');
    const originalMounts = page.mountCount();
    const baseline = await evaluate(`(() => {
      const nav=document.querySelector('.seed-app-header nav'), label=nav.querySelector('[aria-current]'), arrow=nav.querySelector('svg'), style=getComputedStyle(nav);
      return {font:style.fontSize,weight:style.fontWeight,gap:style.gap,color:getComputedStyle(label).color,arrow:arrow.getBoundingClientRect().width};
    })()`);
    await evaluate('document.querySelector("#draft").value="Unsaved draft"');
    await click('#open');
    await current('执行详情');
    assert.deepEqual(await evaluate(`(() => {
      const nav=document.querySelector('.seed-app-header nav'), label=nav.querySelector('[aria-current]'), arrow=nav.querySelector('svg'), style=getComputedStyle(nav);
      return {font:style.fontSize,weight:style.fontWeight,gap:style.gap,color:getComputedStyle(label).color,arrow:arrow.getBoundingClientRect().width};
    })()`), baseline, 'Existing header typography, color, spacing and arrow geometry are preserved');
    await click(headerButton(3));
    await current('规则');
    assert.equal(await evaluate('document.querySelector("#draft").value'), 'Unsaved draft');
    await click('#open');
    await click('#back');
    await current('早间简报');
    await click('#back');
    await current('规则');
    await click('#back');
    await current('Generic SDK fixture');
    await click('#back');
    await wait('document.body.dataset.backResult === "false"');

    await click('#open');
    await evaluate('document.body.dataset.mode="decline"');
    await click(headerButton(2));
    await wait('!document.querySelector(".seed-app-header nav").hasAttribute("aria-busy")');
    await current('执行详情');
    await evaluate('document.body.dataset.mode="wait"');
    const requests = await evaluate('Number(document.body.dataset.requests)');
    await click(headerButton(2));
    await wait('document.querySelector(".seed-app-header nav").getAttribute("aria-busy")==="true"');
    await click('#back');
    assert.equal(await evaluate('Number(document.body.dataset.requests)'), requests + 1);
    assert.equal(await evaluate('document.querySelector(' + JSON.stringify(headerButton(2)) + ').disabled'), true);
    await click('#release');
    await current('Generic SDK fixture');
    await evaluate('delete document.body.dataset.mode');

    for (const theme of ['light', 'dark']) for (const width of [960, 1280]) for (const locale of ['zh-CN', 'en-US']) {
      appearance(theme, locale);
      owner.setSize(width, 720);
      await wait('innerWidth === ' + width + ' && document.documentElement.dataset.theme === ' + JSON.stringify(theme) + ' && document.documentElement.lang === ' + JSON.stringify(locale));
      await evaluate('document.body.dataset.longPath="true"');
      await click('#open');
      await wait('document.querySelectorAll(".seed-header-breadcrumb--middle").length === 2');
      contents.sendInputEvent({ type: 'mouseMove', x: 50, y: 400 });
      const metrics = await evaluate(`(() => {
        const nav=document.querySelector('.seed-app-header nav'), end=nav.querySelector('[aria-current]'), r=nav.getBoundingClientRect(), e=end.getBoundingClientRect();
        return {left:r.left,right:r.right,end:e.right,width:innerWidth,scrollWidth:nav.scrollWidth,clientWidth:nav.clientWidth,overflow:document.documentElement.scrollWidth>innerWidth,
          tails:[...nav.querySelectorAll('.seed-header-breadcrumb--tail')].map(el=>{const label=el.firstElementChild||el;return label.scrollWidth<=label.clientWidth+1})};
      })()`);
      assert.equal(metrics.overflow, false);
      assert(metrics.right <= metrics.width && metrics.end <= metrics.right + 1 && metrics.scrollWidth <= metrics.clientWidth + 1, JSON.stringify(metrics));
      assert(metrics.tails.every(Boolean), 'The last two levels have priority before hovering');
      await capture(theme + '-' + width + '-' + locale);
      if (width === 960) {
        const point = await evaluate(`(() => {const r=document.querySelectorAll('.seed-header-breadcrumb--middle')[1].getBoundingClientRect();return {x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2)}})()`);
        contents.sendInputEvent({ type: 'mouseMove', ...point });
        await wait(`(() => {
          const n=document.querySelector('.seed-app-header nav'),m=n.querySelectorAll('.seed-header-breadcrumb--middle')[1],label=m.firstElementChild;
          return m.matches(':hover') && label.scrollWidth<=label.clientWidth+1 && [...n.querySelectorAll('.seed-header-breadcrumb--tail')].some(el=>{const l=el.firstElementChild||el;return l.scrollWidth>l.clientWidth+1});
        })()`);
        await capture(theme + '-' + width + '-' + locale + '-hover');
        contents.sendInputEvent({ type: 'mouseMove', x: 50, y: 400 });
        await wait(`(() => {const n=document.querySelector('.seed-app-header nav');return [...n.querySelectorAll('.seed-header-breadcrumb--tail')].every(el=>{const l=el.firstElementChild||el;return l.scrollWidth<=l.clientWidth+1})})()`);
      }
      await evaluate('delete document.body.dataset.longPath');
    }

    appearance('light', 'en-US');
    await click('#open');
    await current('Execution detail');
    owner.focus(); contents.focus();
    await evaluate('document.querySelector(' + JSON.stringify(headerButton(2)) + ').focus()');
    await wait('document.activeElement === document.querySelector(' + JSON.stringify(headerButton(2)) + ')');
    contents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
    contents.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' });
    await current('Execution detail');
    contents.sendInputEvent({ type: 'keyDown', keyCode: 'Return' });
    contents.sendInputEvent({ type: 'char', keyCode: '\r' });
    contents.sendInputEvent({ type: 'keyUp', keyCode: 'Return' });
    await current('Generic SDK fixture');
    assert.equal(page.mountCount(), originalMounts, 'Breadcrumb updates and returns preserve the plugin DOM mount');
    await verifyPluginPage({ contents, owner, screenshots, page });

    await click('#open');
    const previousGeneration = await evaluate('document.querySelector(".seed-settings").dataset.pageGeneration');
    await evaluate('globalThis.staleOpen=document.querySelector("#open")');
    const next = createView();
    await page.replace(plugin, next, { keepSelection: true });
    view = next;
    appearance('light', 'en-US');
    await wait('document.querySelector(".seed-settings")?.dataset.pageGeneration !== ' + JSON.stringify(previousGeneration) + ' && !!document.querySelector("#open")');
    await current('Generic SDK fixture');
    await wait('!!document.querySelector("#open")');
    await evaluate('staleOpen.click()');
    assert.equal(await evaluate('document.body.dataset.stale'), 'Plugin navigation is no longer active.');
    await current('Generic SDK fixture');

    // A pending return cannot write into the header after the page has been hidden.
    await click('#open');
    await evaluate('document.body.dataset.mode="wait"; globalThis.finishOld=document.querySelector("#release")');
    await click(headerButton(2));
    await click(headerButton(1));
    await wait('!document.querySelector("[data-plugin-view-surface]")');
    await evaluate('finishOld.click(); delete document.body.dataset.mode');
    const snapshot = page.runtime.snapshot();
    snapshot.navigationRequest = { id: randomUUID(), destination: 'plugins', pluginId: plugin.package_id };
    page.runtime.snapshot = () => structuredClone(snapshot);
    contents.send('seed:event', { type: 'snapshot.changed', snapshot });
    await wait('!!document.querySelector("#open")');
    await current('Generic SDK fixture');
    assert.deepEqual(errors, []);
    process.stdout.write('Navigation smoke passed: real product header and SDK plugin, ancestors/back/root, plugin information collapsed on child paths and restored at root, decline/async locking, unchanged header styles, draft/mount retention, light/dark, 960/1280, Chinese/English, middle ellipsis/inline hover expansion/tail compression and restoration, keyboard, hide/reload fencing, maximize/restore and native scrolling.\nScreenshots: ' + screenshots + '\n');
  } catch (error) {
    failed = true;
    process.stderr.write((error.stack ?? String(error)) + '\n');
    if (owner && !owner.isDestroyed()) {
      await writeFile(join(screenshots, 'failure.png'), (await owner.webContents.capturePage()).toPNG());
      process.stderr.write(JSON.stringify(await owner.webContents.executeJavaScript(`(() => {
        const nav=document.querySelector('.seed-app-header nav');
        return {header:nav?.outerHTML,headerWidth:nav?.clientWidth,bodyWidth:innerWidth,route:document.querySelector('#route')?.textContent,focus:document.activeElement?.tagName};
      })()`)) + '\n');
      process.stderr.write('Screenshots: ' + screenshots + '\n');
    }
  } finally {
    await view?.destroy();
    owner?.destroy();
    clearTimeout(deadline);
    await rm(root, { recursive: true, force: true });
    app.exit(failed ? 1 : 0);
  }
});
