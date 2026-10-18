import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';

/** Exercise the ordinary product page, never a separate rendering surface. */
export async function verifyPluginPage({ contents, owner, screenshots, page }) {
  const evaluate = (source) => contents.executeJavaScript(source);
  const wait = async (check) => {
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
      if (await check()) return;
      await new Promise((done) => setTimeout(done, 30));
    }
    throw new Error('Product page layout did not settle.');
  };
  const measure = () =>
    evaluate(`(() => {
    const surface = document.querySelector('[data-plugin-view-surface]');
    const content = surface?.firstElementChild;
    if (!content) return null;
    const a = surface.getBoundingClientRect(), b = content.getBoundingClientRect();
    const main = surface.closest('main');
    const nestedScrollers = [...content.querySelectorAll('*')].filter(element => {
      const overflow = getComputedStyle(element).overflowY;
      return ['auto', 'scroll'].includes(overflow) && element.scrollHeight > element.clientHeight + 1
        && !element.matches('textarea, [role="dialog"], [role="listbox"]')
        && !element.closest('[role="dialog"], [role="listbox"]');
    }).length;
    return { height: a.height, naturalHeight: b.height, top: a.top, contentTop: b.top,
      left: a.left, contentLeft: b.left, width: a.width, contentWidth: b.width,
      inlineHeight: surface.style.height, nestedScrollers, scrollTop: main.scrollTop,
      scrollHeight: main.scrollHeight, clientHeight: main.clientHeight,
      overflow: main.scrollWidth > main.clientWidth + 1,
      shellHiddenVisible: [...document.querySelectorAll('main .hidden')].filter(element =>
        !element.closest('[data-plugin-view-owner], [data-plugin-view-portal]') &&
        ![...element.classList].some(name => name.startsWith('dark:') && document.documentElement.dataset.theme === 'dark') &&
        element.checkVisibility()).length,
      frames: document.querySelectorAll('iframe, webview').length,
      node: typeof process, require: typeof require };
  })()`);
  const assertFlow = (value) => {
    assert.ok(value, 'Plugin is mounted in the real product page');
    assert.equal(value.height, value.naturalHeight);
    assert.equal(value.top, value.contentTop);
    assert.equal(value.left, value.contentLeft);
    assert.equal(value.width, value.contentWidth);
    assert.equal(value.inlineHeight, '');
    assert.equal(value.frames, 0);
    assert.equal(value.nestedScrollers, 0, 'Only the product page owns vertical layout scrolling');
    assert.equal(value.overflow, false, 'No horizontal content overflow');
    assert.equal(
      value.shellHiddenVisible,
      0,
      'Plugin utilities must not override hidden elements in the product shell',
    );
    assert.equal(value.node, 'undefined');
    assert.equal(value.require, 'undefined');
    assert.equal(owner.contentView.children.length, 0);
  };
  await wait(async () => Boolean(await measure()));
  await new Promise((done) => setTimeout(done, 400));
  assert.equal(
    await evaluate(`(() => {
    const foreign = document.createElement('div');
    foreign.dataset.pluginViewOwner = 'com.example.foreign-style-scope';
    foreign.style.position = 'fixed'; foreign.style.left = '-9999px';
    const content = document.createElement('span'); content.className = 'block hidden';
    foreign.append(content); document.body.append(foreign);
    const display = getComputedStyle(content).display; foreign.remove(); return display;
  })()`),
    'none',
    'Plugin utilities must not override another plugin container',
  );
  const mounts = page.mountCount(),
    originalSize = owner.getSize(),
    metrics = [];
  for (const theme of ['light', 'dark']) {
    page.appearance(theme);
    for (const size of [
      [960, 640],
      [1280, 800],
    ]) {
      owner.setSize(...size);
      await wait(async () => (await evaluate('innerWidth')) === size[0]);
      await new Promise((done) => setTimeout(done, 200));
      const value = await measure();
      assertFlow(value);
      metrics.push({ theme, size, ...value });
      await writeFile(join(screenshots, `${theme}-${size[0]}.png`), (await contents.capturePage()).toPNG());
    }
  }
  for (let cycle = 0; cycle < 2; cycle++) {
    owner.maximize();
    await wait(async () => owner.isMaximized());
    assertFlow(await measure());
    owner.unmaximize();
    await wait(async () => !owner.isMaximized());
    owner.setSize(...originalSize);
    await wait(async () => (await evaluate('innerWidth')) === originalSize[0]);
    assertFlow(await measure());
  }
  const start = await measure();
  if (start.scrollHeight > start.clientHeight + 30) {
    const point =
      await evaluate(`(() => { const r = document.querySelector('[data-plugin-view-surface]').getBoundingClientRect();
      return {x: Math.round(r.left + r.width / 2), y: Math.min(innerHeight - 50, Math.round(r.top + 60))}; })()`);
    owner.focus();
    contents.focus();
    contents.sendInputEvent({ type: 'mouseMove', ...point });
    const offsets = new Set();
    for (let index = 0; index < 20; index++) {
      contents.sendInputEvent({ type: 'mouseWheel', ...point, deltaX: 0, deltaY: -35, canScroll: true });
      await new Promise((done) => setTimeout(done, 20));
      const current = await measure();
      assertFlow(current);
      offsets.add(current.scrollTop);
    }
    assert.ok(offsets.size > 3, 'Real wheel input continuously scrolls the outer page');
  }
  await evaluate('document.querySelector("[data-plugin-view-surface]").closest("main").scrollTop = 0');
  assert.equal(page.mountCount(), mounts, 'Window/scroll changes do not remount the plugin or send geometry IPC');
  await writeFile(join(screenshots, 'layout-metrics.json'), JSON.stringify(metrics, null, 2));
}
