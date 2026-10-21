import { driver, type Driver, type PopoverDOM } from 'driver.js';
import type { Component } from './component.js';
import { actionButtonClassName } from './button-style.js';

export type TourTarget = string | HTMLElement | (() => HTMLElement | null | undefined);
export type TourStep = {
  target: TourTarget;
  title?: string;
  description: string;
  side?: 'top' | 'right' | 'bottom' | 'left';
  align?: 'start' | 'center' | 'end';
  allowInteraction?: boolean;
  waitForTarget?: number;
  beforeEnter?: (context: { signal: AbortSignal; index: number }) => void | Promise<void>;
};
export type TourLabels = {
  previous: string;
  next: string;
  done: string;
  skip: string;
  progress: string;
};
export type TourResult = {
  status: 'completed' | 'skipped' | 'cancelled';
  reason: 'done' | 'skip' | 'escape' | 'overlay' | 'cancelled' | 'disposed' | 'aborted' | 'unmounted' | 'replaced' | 'target-missing' | 'error';
  stepIndex: number;
  error?: unknown;
};
export type TourOptions = {
  root: HTMLElement;
  steps: readonly TourStep[];
  owner?: Pick<Component, 'register' | 'signal'>;
  signal?: AbortSignal;
  locale?: string;
  labels?: Partial<TourLabels>;
  closeOnOverlayClick?: boolean;
  waitForTarget?: number;
};
export type Tour = {
  readonly active: boolean;
  start(): Promise<TourResult>;
  next(): Promise<void>;
  previous(): Promise<void>;
  cancel(): void;
};

const startEvent = 'seed:tour-start';
const labelsByLanguage: Record<string, TourLabels> = {
  en: { previous: 'Previous', next: 'Next', done: 'Done', skip: 'Skip', progress: '{{current}} / {{total}}' },
  zh: { previous: '上一步', next: '下一步', done: '完成', skip: '跳过', progress: '{{current}} / {{total}}' },
};

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!);
}

/** Browser-only, scoped UI. Callers own steps, triggers and completion storage. */
export function createTour(options: TourOptions): Tour {
  const { root } = options;
  const document = root.ownerDocument;
  const window = document.defaultView;
  if (!window || document !== globalThis.document || !options.steps.length)
    throw new Error('A tour requires a root in the current browser window and at least one step.');
  const steps = [...options.steps];
  for (const step of steps) {
    if (!step.target || !Number.isFinite(step.waitForTarget ?? options.waitForTarget ?? 3000) || (step.waitForTarget ?? options.waitForTarget ?? 3000) < 0)
      throw new Error('Invalid tour target or waitForTarget.');
  }
  const scope = root.closest('[data-plugin-view-owner], [data-plugin-view-portal]');
  const pluginId = scope?.getAttribute('data-plugin-view-owner') ?? scope?.getAttribute('data-plugin-view-portal');
  const language = (options.locale || document.documentElement.lang || window.navigator.language).split('-')[0];
  const labels = { ...(labelsByLanguage[language] ?? labelsByLanguage.en), ...options.labels };
  let run: {
    driver: Driver;
    index: number;
    busy: boolean;
    target?: HTMLElement;
    navigation?: AbortController;
    lifetime: AbortController;
    result: Promise<TourResult>;
    resolve: (result: TourResult) => void;
    previousFocus: Element | null;
    observer: MutationObserver;
    layer?: HTMLElement;
    overlay?: SVGElement;
  } | undefined;
  type Run = NonNullable<typeof run>;

  function visible(element: HTMLElement): boolean {
    return element.isConnected && !element.closest('[hidden], [inert]') && element.getClientRects().length > 0 &&
      !['hidden', 'collapse'].includes(window!.getComputedStyle(element).visibility);
  }

  function belongs(element: HTMLElement): boolean {
    if (element.ownerDocument !== document) return false;
    const owner = element.closest('[data-plugin-view-owner], [data-plugin-view-portal]');
    const id = owner?.getAttribute('data-plugin-view-owner') ?? owner?.getAttribute('data-plugin-view-portal');
    if (pluginId && id !== pluginId) return false;
    return root.contains(element) || Boolean(pluginId && owner?.getAttribute('data-plugin-view-portal') === pluginId);
  }

  function findTarget(target: TourTarget): HTMLElement | undefined {
    if (typeof target !== 'string') {
      const element = typeof target === 'function' ? target() : target;
      if (!element) return;
      if (!belongs(element)) throw new Error('Tour target is outside its root and owned portals.');
      return visible(element) ? element : undefined;
    }
    const roots = [root];
    if (pluginId) {
      for (const portal of document.querySelectorAll<HTMLElement>('[data-plugin-view-portal]')) {
        if (portal.getAttribute('data-plugin-view-portal') === pluginId) roots.push(portal);
      }
    }
    for (const container of roots) {
      const candidates = [...(container.matches(target) ? [container] : []), ...container.querySelectorAll<HTMLElement>(target)];
      const element = candidates.find((candidate) => belongs(candidate) && visible(candidate));
      if (element) return element;
    }
  }

  function waitForTarget(step: TourStep, signal: AbortSignal): Promise<HTMLElement | undefined> {
    return new Promise((resolve, reject) => {
      const finish = (element?: HTMLElement, error?: unknown) => {
        observer.disconnect();
        window!.clearTimeout(timer);
        signal.removeEventListener('abort', abort);
        if (error) reject(error);
        else resolve(element);
      };
      const check = () => {
        try {
          const element = findTarget(step.target);
          if (element) finish(element);
        } catch (error) { finish(undefined, error); }
      };
      const abort = () => finish(undefined, signal.reason);
      const observer = new window!.MutationObserver(check);
      const timer = window!.setTimeout(() => finish(), step.waitForTarget ?? options.waitForTarget ?? 3000);
      observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true });
      signal.addEventListener('abort', abort, { once: true });
      if (signal.aborted) abort();
      else check();
    });
  }

  function finish(current: Run, status: TourResult['status'], reason: TourResult['reason'], error?: unknown) {
    if (run !== current) return;
    run = undefined;
    current.navigation?.abort();
    current.lifetime.abort();
    current.observer.disconnect();
    current.driver.destroy();
    if (current.layer && !current.layer.childElementCount) current.layer.remove();
    if (current.previousFocus?.isConnected && 'focus' in current.previousFocus)
      (current.previousFocus as HTMLElement).focus({ preventScroll: true });
    if (document.activeElement !== current.previousFocus && current.target?.isConnected) {
      current.target.focus({ preventScroll: true });
      if (document.activeElement !== current.target)
        current.target.closest('dialog[open]')?.querySelector<HTMLElement>('button:not(:disabled), [tabindex="0"]')?.focus({ preventScroll: true });
    }
    current.resolve({ status, reason, stepIndex: current.index, ...(error === undefined ? {} : { error }) });
  }

  async function navigate(current: Run, index: number) {
    if (run !== current || index < 0) return;
    if (index >= steps.length) { finish(current, 'completed', 'done'); return; }
    current.navigation?.abort();
    const navigation = current.navigation = new AbortController();
    current.busy = true;
    const popover = current.driver.getState().popover as PopoverDOM | undefined;
    if (popover) {
      popover.wrapper.setAttribute('aria-busy', 'true');
      popover.nextButton.disabled = popover.previousButton.disabled = true;
    }
    try {
      await steps[index].beforeEnter?.({ signal: navigation.signal, index });
      if (navigation.signal.aborted) return;
      const target = await waitForTarget(steps[index], navigation.signal);
      if (run !== current || navigation.signal.aborted) return;
      if (!target) { finish(current, 'cancelled', 'target-missing'); return; }
      target.scrollIntoView({ behavior: 'instant', block: 'center', inline: 'nearest' });
      current.index = index;
      current.target = target;
      current.busy = false;
      current.driver.drive(index);
    } catch (error) {
      if (run === current && !navigation.signal.aborted) finish(current, 'cancelled', 'error', error);
    }
  }

  function start(): Promise<TourResult> {
    if (run) return run.result;
    if (options.signal?.aborted || options.owner?.signal.aborted)
      return Promise.resolve({ status: 'cancelled', reason: 'aborted', stepIndex: 0 });
    if (!root.isConnected)
      return Promise.resolve({ status: 'cancelled', reason: 'unmounted', stepIndex: 0 });
    document.dispatchEvent(new window!.Event(startEvent));
    let resolve!: Run['resolve'];
    const result = new Promise<TourResult>((done) => { resolve = done; });
    const current: Run = {
      driver: undefined!, index: 0, busy: true, lifetime: new AbortController(),
      result, resolve, previousFocus: document.activeElement,
      observer: new window!.MutationObserver(() => {
        if (!root.isConnected || root.closest('[hidden], [inert]') || (!current.busy && current.target && !visible(current.target)))
          finish(current, 'cancelled', 'unmounted');
      }),
    };
    run = current;
    current.driver = driver({
      animate: !window!.matchMedia?.('(prefers-reduced-motion: reduce)').matches,
      smoothScroll: false,
      allowKeyboardControl: false,
      disableActiveInteraction: true,
      overlayOpacity: 0.35,
      stagePadding: 6,
      stageRadius: 10,
      popoverClass: 'seed-tour',
      showProgress: steps.length > 1,
      progressText: escapeHtml(labels.progress),
      nextBtnText: escapeHtml(labels.next),
      prevBtnText: escapeHtml(labels.previous),
      doneBtnText: escapeHtml(labels.done),
      closeBtnLabel: labels.skip,
      steps: steps.map((step, index) => ({
        element: () => current.target!,
        disableActiveInteraction: !step.allowInteraction,
        popover: {
          title: step.title ? escapeHtml(step.title) : undefined,
          description: escapeHtml(step.description),
          side: step.side,
          align: step.align,
          showButtons: index === 0 ? ['next', 'close'] : ['previous', 'next', 'close'],
        },
      })),
      onPopoverRender(popover) {
        if (pluginId) popover.wrapper.setAttribute('data-plugin-view-portal', pluginId);
        popover.closeButton.textContent = labels.skip;
        for (const button of [popover.previousButton, popover.nextButton, popover.closeButton]) {
          button.type = 'button';
          button.className += ' ' + actionButtonClassName(button === popover.nextButton ? 'primary' : 'neutral');
        }
        popover.footerButtons.prepend(popover.closeButton);
      },
      onHighlighted() {
        current.driver.refresh();
        const popover = current.driver.getState().popover as PopoverDOM | undefined;
        const overlay = current.overlay ?? document.querySelector<SVGElement>('.driver-overlay');
        const parent = popover?.wrapper.parentElement;
        if (overlay && parent) {
          current.overlay = overlay;
          const layer = parent.classList.contains('driver-layer') ? parent : undefined;
          if (overlay.parentElement !== (layer ?? document.body)) {
            (layer ?? document.body).append(overlay);
            overlay.style.animation = 'none';
          }
          if (current.layer && !current.layer.childElementCount) current.layer.remove();
          current.layer = layer;
        }
        queueMicrotask(() => {
          if (run === current) (current.driver.getState().popover as PopoverDOM | undefined)?.nextButton.focus({ preventScroll: true });
        });
      },
      onNextClick: () => { if (!current.busy) void navigate(current, current.index + 1); },
      onPrevClick: () => { if (!current.busy) void navigate(current, current.index - 1); },
      onCloseClick: () => finish(current, 'skipped', 'skip'),
      overlayClickBehavior: () => { if (options.closeOnOverlayClick) finish(current, 'skipped', 'overlay'); },
      onDestroyed: (_element, _step, { reason }) => finish(current, 'cancelled', reason === 'replaced' ? 'replaced' : 'cancelled'),
    });
    const listen = (target: EventTarget, name: string, callback: EventListener, capture = false) => {
      target.addEventListener(name, callback, capture);
      current.lifetime.signal.addEventListener('abort', () => target.removeEventListener(name, callback, capture), { once: true });
    };
    listen(document, startEvent, () => finish(current, 'cancelled', 'replaced'));
    listen(window!, 'pagehide', () => finish(current, 'cancelled', 'unmounted'));
    listen(document, 'scroll', () => current.driver.refresh(), true);
    listen(document, 'keydown', (event) => {
      const key = event as KeyboardEvent;
      if (key.key === 'Escape') {
        key.preventDefault(); key.stopImmediatePropagation(); finish(current, 'skipped', 'escape');
      } else if (key.key === 'Tab') {
        const popover = current.driver.getState().popover as PopoverDOM | undefined;
        if (!popover) return;
        const containers = [popover.wrapper, ...(steps[current.index].allowInteraction && current.target ? [current.target] : [])];
        const buttons = containers.flatMap((container) => [container, ...container.querySelectorAll<HTMLElement>('button, a[href], input, select, textarea, [tabindex]')])
          .filter((element) => element.tabIndex >= 0 && !element.matches(':disabled') && visible(element));
        key.preventDefault(); key.stopImmediatePropagation();
        const index = buttons.indexOf(document.activeElement as HTMLElement);
        buttons[(index + (key.shiftKey ? -1 : 1) + buttons.length) % buttons.length]?.focus();
      } else if ((key.key === 'ArrowRight' || key.key === 'ArrowLeft') && !(key.target instanceof window!.Element && key.target.closest('input, textarea, select, [contenteditable="true"]'))) {
        key.preventDefault(); key.stopImmediatePropagation();
        if (!current.busy) void navigate(current, current.index + (key.key === 'ArrowRight' ? 1 : -1));
      }
    }, true);
    for (const signal of [options.signal, options.owner?.signal]) {
      if (signal?.aborted) { finish(current, 'cancelled', 'aborted'); return result; }
      if (signal) listen(signal, 'abort', () => finish(current, 'cancelled', 'aborted'));
    }
    current.observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['hidden', 'inert', 'class', 'style', 'open'] });
    void navigate(current, 0);
    return result;
  }

  const tour: Tour = {
    get active() { return Boolean(run); },
    start,
    next: async () => { if (run && !run.busy) await navigate(run, run.index + 1); },
    previous: async () => { if (run && !run.busy) await navigate(run, run.index - 1); },
    cancel: () => { if (run) finish(run, 'cancelled', 'cancelled'); },
  };
  options.owner?.register(() => { if (run) finish(run, 'cancelled', 'disposed'); });
  return tour;
}
