import { describe, expect, it, vi } from 'vitest';
import { PluginNavigationController, type PluginBreadcrumbState } from './plugin-navigation';

const path = [
  { id: 'rules', label: 'Rules' },
  { id: 'rule', label: 'Morning briefing' },
  { id: 'execution', label: 'Execution detail' },
];

function fixture() {
  let state: PluginBreadcrumbState | undefined;
  let visible = true;
  const report = vi.fn();
  const change = vi.fn((next: PluginBreadcrumbState | undefined) => { state = next; });
  const controller = new PluginNavigationController(() => visible, change, report);
  const lifetime = new AbortController();
  const navigate = vi.fn();
  const handle = controller.api.create({ signal: lifetime.signal, onNavigate: navigate });
  handle.setPath(path);
  return { controller, lifetime, handle, navigate, report, change, state: () => state!, hide: () => { visible = false; controller.clear(); } };
}

describe('plugin-owned breadcrumb navigation', () => {
  it('returns one level at a time and stops at the plugin root', async () => {
    const f = fixture();
    expect(await f.handle.back()).toBe(true);
    expect(f.navigate).toHaveBeenLastCalledWith('rule', expect.any(AbortSignal));
    expect(f.state().path).toEqual(path.slice(0, 2));
    expect(await f.handle.back()).toBe(true);
    expect(f.state().path).toEqual(path.slice(0, 1));
    expect(await f.handle.back()).toBe(true);
    expect(f.navigate).toHaveBeenLastCalledWith(null, expect.any(AbortSignal));
    expect(f.state().path).toEqual([]);
    expect(await f.handle.back()).toBe(false);
    expect(f.navigate).toHaveBeenCalledTimes(3);
  });

  it('jumps to any ancestor while ignoring current and unknown levels', async () => {
    const f = fixture();
    expect(await f.state().navigate('execution')).toBe(false);
    expect(await f.state().navigate('unknown')).toBe(false);
    expect(f.navigate).not.toHaveBeenCalled();
    expect(await f.state().navigate('rules')).toBe(true);
    expect(f.state().path).toEqual(path.slice(0, 1));
    expect(await f.state().navigate(null)).toBe(true);
    expect(f.state().path).toEqual([]);
  });

  it('keeps the path on declined or failed navigation and permits retry', async () => {
    const f = fixture();
    f.navigate.mockResolvedValueOnce(false).mockRejectedValueOnce(new Error('Route failed'));
    expect(await f.handle.back()).toBe(false);
    expect(f.state().path).toEqual(path);
    await expect(f.handle.back()).rejects.toThrow('Route failed');
    expect(f.state().busy).toBe(false);
    expect(f.state().path).toEqual(path);
    f.navigate.mockRejectedValueOnce(new Error('Header failure'));
    expect(await f.state().navigate(null)).toBe(false);
    expect(f.report).toHaveBeenCalledWith(expect.objectContaining({ message: 'Header failure' }));
    expect(await f.handle.back()).toBe(true);
  });

  it('serializes async navigation and preserves a newer path published by its callback', async () => {
    const f = fixture();
    let finish!: () => void;
    f.navigate.mockImplementationOnce(async () => {
      await new Promise<void>((resolve) => { finish = resolve; });
      f.handle.setPath([{ id: 'redirected', label: 'Renamed page' }]);
    });
    const result = f.handle.back();
    expect(f.state().busy).toBe(true);
    expect(await f.state().navigate(null)).toBe(false);
    expect(f.navigate).toHaveBeenCalledTimes(1);
    finish();
    expect(await result).toBe(true);
    expect(f.state().busy).toBe(false);
    expect(f.state().path).toEqual([{ id: 'redirected', label: 'Renamed page' }]);
  });

  it.each(['dispose', 'abort', 'hide', 'replace'] as const)('fences old callbacks and handles after %s', async (reason) => {
    const f = fixture();
    const stale = f.state();
    let finish!: () => void;
    let signal!: AbortSignal;
    f.navigate.mockImplementationOnce((_id, pendingSignal) => {
      signal = pendingSignal;
      return new Promise<void>((resolve) => { finish = resolve; });
    });
    const navigating = f.handle.back();
    if (reason === 'dispose') f.handle.dispose();
    if (reason === 'abort') f.lifetime.abort();
    if (reason === 'hide') f.hide();
    if (reason === 'replace') {
      const next = f.controller.api.create({ signal: new AbortController().signal, onNavigate: vi.fn() });
      next.setPath([{ id: 'new', label: 'New view' }]);
      f.handle.dispose();
    }
    expect(signal.aborted).toBe(true);
    const changes = f.change.mock.calls.length;
    finish();
    expect(await navigating).toBe(false);
    expect(await stale.navigate(null)).toBe(false);
    expect(await f.handle.back()).toBe(false);
    expect(() => f.handle.setPath(path)).toThrow('no longer active');
    expect(f.change).toHaveBeenCalledTimes(changes);
    if (reason === 'replace') expect(f.state().path[0].id).toBe('new');
    else expect(f.state()).toBeUndefined();
  });

  it('validates and snapshots paths before publishing and refuses hidden/aborted owners', () => {
    const f = fixture();
    const mutable = [{ id: 'one', label: 'Original' }];
    f.handle.setPath(mutable);
    mutable[0].label = 'Mutated';
    mutable.push({ id: 'two', label: 'Other' });
    expect(f.state().path).toEqual([{ id: 'one', label: 'Original' }]);
    for (const invalid of [[{ id: '', label: 'Blank' }], [{ id: 'x', label: ' ' }], [path[0], path[0]]])
      expect(() => f.handle.setPath(invalid)).toThrow('Breadcrumb');
    expect(f.state().path).toEqual([{ id: 'one', label: 'Original' }]);
    f.lifetime.abort();
    expect(() => f.controller.api.create({ signal: f.lifetime.signal, onNavigate: vi.fn() })).toThrow();
    f.hide();
    expect(() => f.controller.api.create({ signal: new AbortController().signal, onNavigate: vi.fn() })).toThrow('visible page');
  });

  it('revokes the old handle before delivering cancellation to plugin code', async () => {
    const f = fixture();
    const cancelled = vi.fn();
    f.navigate.mockImplementationOnce((_id, signal: AbortSignal) => new Promise<void>((resolve) => {
      signal.addEventListener('abort', () => {
        expect(() => f.handle.setPath([])).toThrow('no longer active');
        cancelled();
        resolve();
      });
    }));
    const pending = f.handle.back();
    f.handle.dispose();
    expect(cancelled).toHaveBeenCalledOnce();
    expect(await pending).toBe(false);
    expect(f.state()).toBeUndefined();
  });
});
