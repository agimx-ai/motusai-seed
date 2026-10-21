// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Component, PluginSettingTab, createTour, type App, type Plugin } from '@motus-ai/seed-sdk';

let root: HTMLElement;
beforeEach(() => {
  document.documentElement.lang = 'en';
  root = document.createElement('section');
  root.dataset.pluginViewOwner = 'com.example.tour';
  root.innerHTML = '<button id="first">First</button><button id="second">Second</button>';
  document.body.append(root);
  vi.spyOn(HTMLElement.prototype, 'getClientRects').mockImplementation(function (this: HTMLElement) {
    return (this.isConnected && !this.closest('[hidden]') ? [new DOMRect(20, 20, 100, 40)] : []) as unknown as DOMRectList;
  });
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(new DOMRect(20, 20, 100, 40));
  HTMLElement.prototype.scrollIntoView = vi.fn();
  window.matchMedia = vi.fn().mockReturnValue({ matches: true });
});
afterEach(() => {
  document.dispatchEvent(new Event('seed:tour-start'));
  document.body.replaceChildren();
  vi.restoreAllMocks();
});
const shown = () => vi.waitFor(() => expect(document.querySelector('.seed-tour')).not.toBeNull());
const steps = () => [
  { target: '#first', title: 'First step', description: '<img src=x onerror=alert(1)> & details' },
  { target: '#second', title: 'Second step', description: 'Second details' },
];

describe('scoped product tours', () => {
  it('moves forward and back, treats copy as text, completes and restores the original focus', async () => {
    const original = root.querySelector<HTMLButtonElement>('#first')!;
    original.focus();
    const tour = createTour({ root, steps: steps() });
    const result = tour.start();
    expect(tour.start()).toBe(result);
    await shown();
    expect(original.scrollIntoView).toHaveBeenCalledWith({ behavior: 'instant', block: 'center', inline: 'nearest' });
    expect(document.querySelector('.seed-tour')?.getAttribute('data-plugin-view-portal')).toBe('com.example.tour');
    expect(document.querySelector('.driver-popover-description')?.textContent).toBe('<img src=x onerror=alert(1)> & details');
    expect(document.querySelector('.seed-tour img')).toBeNull();
    await tour.next();
    expect(document.querySelector('.driver-popover-title')?.textContent).toBe('Second step');
    await tour.previous();
    expect(document.querySelector('.driver-popover-title')?.textContent).toBe('First step');
    await tour.next();
    await tour.next();
    expect(await result).toEqual({ status: 'completed', reason: 'done', stepIndex: 1 });
    expect(tour.active).toBe(false);
    expect(document.querySelector('.seed-tour, .driver-overlay')).toBeNull();
    expect(document.body.classList.contains('driver-active')).toBe(false);
    expect(document.activeElement).toBe(original);
  });

  it('waits for a dynamic target in its owned portal instead of matching another plugin', async () => {
    const other = document.createElement('div');
    other.dataset.pluginViewOwner = 'com.example.other';
    other.innerHTML = '<button id="delayed">Wrong owner</button>';
    document.body.append(other);
    const tour = createTour({ root, steps: [{ target: '#delayed', description: 'Dynamic target' }] });
    const result = tour.start();
    await Promise.resolve();
    expect(document.querySelector('.seed-tour')).toBeNull();
    const portal = document.createElement('div');
    portal.dataset.pluginViewPortal = 'com.example.tour';
    portal.innerHTML = '<button id="delayed">Owned target</button>';
    document.body.append(portal);
    await shown();
    expect(portal.querySelector('button')?.classList.contains('driver-active-element')).toBe(true);
    expect(other.querySelector('button')?.classList.contains('driver-active-element')).toBe(false);
    tour.cancel();
    expect((await result).reason).toBe('cancelled');
  });

  it('rejects element and function targets from another plugin', async () => {
    const outside = document.createElement('button');
    document.body.append(outside);
    for (const target of [outside, () => outside]) {
      const result = await createTour({ root, steps: [{ target, description: 'Wrong owner' }] }).start();
      expect(result).toMatchObject({ status: 'cancelled', reason: 'error' });
      expect(String(result.error)).toContain('outside its root');
    }
    expect(document.querySelector('.seed-tour, .driver-overlay')).toBeNull();
  });

  it('ends with target-missing on timeout without a floating fallback', async () => {
    const result = await createTour({ root, waitForTarget: 15, steps: [{ target: '#absent', description: 'Missing' }] }).start();
    expect(result).toEqual({ status: 'cancelled', reason: 'target-missing', stepIndex: 0 });
    expect(document.querySelector('.seed-tour, .driver-overlay')).toBeNull();
  });

  it('replaces an earlier tour, even while it is waiting for its first target', async () => {
    const first = createTour({ root, steps: [{ target: '#absent', description: 'Waiting' }] });
    const firstResult = first.start();
    const second = createTour({ root, steps: steps() });
    second.start();
    await shown();
    expect(await firstResult).toMatchObject({ status: 'cancelled', reason: 'replaced' });
    expect(document.querySelectorAll('.seed-tour')).toHaveLength(1);
    second.cancel();
  });

  it.each(['skip', 'escape', 'overlay'] as const)('reports user exit through %s', async (reason) => {
    const tour = createTour({ root, steps: steps(), closeOnOverlayClick: reason === 'overlay' });
    const result = tour.start();
    await shown();
    if (reason === 'escape') document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    else {
      const element = document.querySelector<HTMLElement>(reason === 'skip' ? '.driver-popover-close-btn' : '.driver-overlay path')!;
      element.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    }
    expect(await result).toMatchObject({ status: 'skipped', reason });
    expect(document.querySelector('.seed-tour, .driver-overlay')).toBeNull();
  });

  it('keeps the current step open when the overlay is clicked by default', async () => {
    const tour = createTour({ root, steps: steps() });
    const result = tour.start();
    await shown();
    document.querySelector('.driver-overlay path')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(tour.active).toBe(true);
    expect(document.querySelector('.driver-popover-title')?.textContent).toBe('First step');
    tour.cancel();
    expect(await result).toMatchObject({ status: 'cancelled', reason: 'cancelled' });
  });

  it('cleans up owner unload, root removal and an external abort', async () => {
    const owner = new Component();
    const owned = createTour({ root, owner, steps: steps() });
    const ownedResult = owned.start();
    await shown();
    await owner.unload();
    expect((await ownedResult).status).toBe('cancelled');
    const detached = createTour({ root, steps: steps() });
    const detachedResult = detached.start();
    await shown();
    root.remove();
    expect(await detachedResult).toMatchObject({ status: 'cancelled', reason: 'unmounted' });
    document.body.append(root);
    const abort = new AbortController();
    const waiting = createTour({ root, signal: abort.signal, steps: [{ target: '#absent', description: 'Waiting' }] });
    const waitingResult = waiting.start();
    abort.abort();
    expect(await waitingResult).toMatchObject({ status: 'cancelled', reason: 'aborted' });
    expect(document.querySelector('.seed-tour, .driver-overlay')).toBeNull();
  });

  it('ignores stale async preparation after cancellation and can replay', async () => {
    let release!: () => void;
    const gate = new Promise<void>((done) => { release = done; });
    const tour = createTour({ root, steps: [{ target: '#first', description: 'Prepared', beforeEnter: () => gate }] });
    const result = tour.start();
    tour.cancel();
    release();
    expect((await result).status).toBe('cancelled');
    await Promise.resolve();
    expect(document.querySelector('.seed-tour')).toBeNull();
    const replay = tour.start();
    await shown();
    await tour.next();
    expect((await replay).status).toBe('completed');
  });

  it('ties a settings tour to the display lifetime when the settings page is hidden', async () => {
    let result!: ReturnType<ReturnType<typeof createTour>['start']>;
    class Settings extends PluginSettingTab {
      override display() {
        this.containerEl.innerHTML = '<button id="tab-feature">Feature</button>';
        result = createTour({
          root: this.containerEl, owner: this,
          steps: [{ target: '#tab-feature', description: 'Settings feature' }],
        }).start();
      }
    }
    const settings = new Settings({} as App, {} as Plugin);
    root.append(settings.containerEl);
    await settings.show();
    await shown();
    await settings.hide();
    expect(await result).toMatchObject({ status: 'cancelled', reason: 'disposed' });
    expect(document.querySelector('.seed-tour, .driver-overlay')).toBeNull();
    await settings.unload();
  });

  it('does not activate a detached root or a previously aborted lifetime', async () => {
    root.remove();
    expect(await createTour({ root, steps: steps() }).start()).toMatchObject({ reason: 'unmounted' });
    document.body.append(root);
    expect(await createTour({ root, signal: AbortSignal.abort(), steps: steps() }).start()).toMatchObject({ reason: 'aborted' });
    expect(document.querySelector('.seed-tour, .driver-overlay')).toBeNull();
  });

  it('does not replace a visible tour when a new tour has already been aborted', async () => {
    const tour = createTour({ root, steps: steps() });
    tour.start();
    await shown();
    await createTour({ root, signal: AbortSignal.abort(), steps: steps() }).start();
    expect(tour.active).toBe(true);
    expect(document.querySelectorAll('.seed-tour')).toHaveLength(1);
    tour.cancel();
  });

  it('keeps keyboard focus in the tour, supports arrows, and localizes its controls', async () => {
    const tour = createTour({ root, locale: 'zh-CN', steps: steps() });
    tour.start();
    await shown();
    expect(document.querySelector('.driver-popover-next-btn')?.textContent).toBe('下一步');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
    expect(document.querySelector('.seed-tour')?.contains(document.activeElement)).toBe(true);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    await vi.waitFor(() => expect(document.querySelector('.driver-popover-title')?.textContent).toBe('Second step'));
    expect(document.querySelector('.driver-popover-next-btn')?.textContent).toBe('完成');
    tour.cancel();
  });
});
