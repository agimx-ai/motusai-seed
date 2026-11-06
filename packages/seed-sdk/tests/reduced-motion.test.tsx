// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { prefersReducedMotion } from '@motus-ai/seed-sdk';
import { useReducedMotion } from '@motus-ai/seed-sdk/react';

let systemReduced: boolean;
let listeners: Set<() => void>;

beforeEach(() => {
  systemReduced = false;
  listeners = new Set();
  vi.stubGlobal('matchMedia', vi.fn(() => ({
    get matches() { return systemReduced; },
    addEventListener: (_event: string, listener: () => void) => listeners.add(listener),
    removeEventListener: (_event: string, listener: () => void) => listeners.delete(listener),
  })));
});

afterEach(() => {
  cleanup();
  delete document.documentElement.dataset.reducedMotion;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function changeSystem(reduced: boolean) {
  act(() => {
    systemReduced = reduced;
    listeners.forEach((listener) => listener());
  });
}

describe('public animation preference APIs', () => {
  it.each([false, true])('uses the system preference %s when there is no client override', (reduced) => {
    systemReduced = reduced;
    expect(prefersReducedMotion()).toBe(reduced);
    const view = renderHook(useReducedMotion);
    expect(view.result.current).toBe(reduced);
  });

  it.each([false, true])('gives client choices priority over the system preference %s', (reduced) => {
    systemReduced = reduced;
    document.documentElement.dataset.reducedMotion = 'true';
    expect(prefersReducedMotion()).toBe(true);
    document.documentElement.dataset.reducedMotion = 'false';
    expect(prefersReducedMotion()).toBe(false);
  });

  it('updates existing consumers when the client choice or system preference changes', async () => {
    const view = renderHook(useReducedMotion);
    expect(view.result.current).toBe(false);

    document.documentElement.dataset.reducedMotion = 'true';
    expect(prefersReducedMotion()).toBe(true);
    await waitFor(() => expect(view.result.current).toBe(true));
    changeSystem(true);
    document.documentElement.dataset.reducedMotion = 'false';
    await waitFor(() => expect(view.result.current).toBe(false));
    changeSystem(false);
    changeSystem(true);
    expect(view.result.current).toBe(false);

    delete document.documentElement.dataset.reducedMotion;
    await waitFor(() => expect(view.result.current).toBe(true));
    changeSystem(false);
    expect(view.result.current).toBe(false);
  });

  it('releases media and client-preference subscriptions on unmount', () => {
    const disconnect = vi.spyOn(MutationObserver.prototype, 'disconnect');
    const view = renderHook(useReducedMotion);
    expect(listeners.size).toBe(1);
    view.unmount();
    expect(listeners.size).toBe(0);
    expect(disconnect).toHaveBeenCalledOnce();
  });

  it('still honors client choices when media queries are unavailable', () => {
    vi.stubGlobal('matchMedia', undefined);
    expect(prefersReducedMotion()).toBe(false);
    document.documentElement.dataset.reducedMotion = 'true';
    expect(prefersReducedMotion()).toBe(true);
    const view = renderHook(useReducedMotion);
    expect(view.result.current).toBe(true);
  });
});
