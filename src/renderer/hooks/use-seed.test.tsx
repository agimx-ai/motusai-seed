// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SeedEvent, SeedSnapshot } from '../../shared/contracts';
import { useSeed } from './use-seed';

const state = vi.hoisted(() => ({ t: (key: string) => key }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: state.t }) }));
vi.mock('@motus-ai/seed-sdk', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}
function fixture() {
  const initial = deferred<SeedSnapshot>();
  let listener!: (event: SeedEvent) => void;
  const bridge = {
    snapshot: vi.fn(() => initial.promise),
    subscribe: vi.fn((callback: typeof listener) => { listener = callback; return vi.fn(); }),
  };
  vi.stubGlobal('motusSeed', bridge);
  const hook = renderHook(() => useSeed());
  return { initial, bridge, ...hook, emit: (snapshot: SeedSnapshot) => listener({ type: 'snapshot.changed', snapshot }) };
}
const pending = { plugins: [], catalogPlugins: [], installedPluginsStatus: 'loading', pluginCatalogStatus: 'loading' } as unknown as SeedSnapshot;
const ready = { ...pending, plugins: [{ id: 'com.example.installed', iconDataUrl: 'data:image/png;base64,ready' }], installedPluginsStatus: 'ready', pluginCatalogStatus: 'ready' } as SeedSnapshot;

describe('Seed snapshot ordering', () => {
  it('keeps a newer pushed snapshot when the initial snapshot response arrives late', async () => {
    const h = fixture();
    act(() => h.emit(ready));
    expect(h.result.current.snapshot).toBe(ready);
    await act(async () => { h.initial.resolve(pending); });
    expect(h.result.current.snapshot).toBe(ready);
  });

  it('keeps the latest refresh when requests finish out of order', async () => {
    const h = fixture();
    const latest = deferred<SeedSnapshot>();
    h.bridge.snapshot.mockImplementationOnce(() => latest.promise);
    let refresh!: Promise<void>;
    act(() => { refresh = h.result.current.refresh(); });
    await act(async () => { latest.resolve(ready); await refresh; });
    await act(async () => { h.initial.resolve(pending); });
    expect(h.result.current.snapshot).toBe(ready);
  });
});
