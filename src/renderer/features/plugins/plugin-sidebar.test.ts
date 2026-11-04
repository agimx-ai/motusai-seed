import { describe, expect, it, vi } from 'vitest';
import { PluginSidebarRegistry } from './plugin-sidebar';

describe('plugin sidebar ownership and routing', () => {
  it('supports quick actions and removes them with their owning frontend', () => {
    const registry = new PluginSidebarRegistry();
    const owner = registry.attach('com.example.one');
    const parent = { host: 'quick-actions' };
    const onSelect = vi.fn();
    expect(owner.api.supportsHost?.(parent.host)).toBe(true);
    const handle = owner.api.register({ id: 'new', title: 'New', parent, onSelect });
    expect(() => owner.api.register({ id: 'page', title: 'Page', parent, view: 'page' })).toThrow('menu actions');
    expect(() => owner.api.register({ id: 'child', title: 'Child', parent: { item: 'new' } })).toThrow('cannot contain');
    handle.update({ title: 'Create' });
    expect(registry.snapshot()[0].title).toBe('Create');
    expect(registry.open('com.example.one:new')).toBe(true);
    owner.dispose();
    expect(registry.open('com.example.one:new')).toBe(false);
    expect(onSelect).toHaveBeenCalledOnce();
  });

  it('runs sidebar actions without changing the route and cleans them up with their owner', async () => {
    const registry = new PluginSidebarRegistry();
    const owner = registry.attach('com.example.one');
    const action = vi.fn();
    const navigate = vi.fn();
    registry.onOpen(navigate);
    const handle = owner.api.register({ id: 'new', title: 'New', onSelect: action });
    expect(await owner.api.open('new')).toBe(true);
    expect(action).toHaveBeenCalledOnce();
    expect(navigate).not.toHaveBeenCalled();
    expect(() => owner.api.register({ id: 'bad', title: 'Bad', view: 'page', onSelect: action })).toThrow('Invalid');
    handle.dispose();
    expect(await owner.api.open('new')).toBe(false);
    owner.dispose();
  });
  it('registers unrelated plugins at different host positions without sharing local IDs', async () => {
    const registry = new PluginSidebarRegistry();
    const a = registry.attach('com.example.documents');
    const b = registry.attach('com.example.monitor');
    a.api.register({ id: 'main', title: 'Documents', parent: { host: 'overview' } });
    a.api.register({ id: 'inbox', title: 'Inbox', parent: { item: 'main' }, view: 'inbox', params: { folder: '123' } });
    b.api.register({ id: 'main', title: 'Monitor', view: 'dashboard' });
    const navigate = vi.fn();
    registry.onOpen(navigate);
    expect(registry.snapshot()).toHaveLength(3);
    expect(await a.api.open('inbox')).toBe(true);
    expect(navigate).toHaveBeenCalledWith(
      expect.objectContaining({ pluginId: 'com.example.documents', view: 'inbox', params: { folder: '123' } }),
    );
    expect(await b.api.open('inbox')).toBe(false);
    expect(await a.api.open('main')).toBe(false);
    a.dispose();
    expect(registry.snapshot().map((entry) => entry.pluginId)).toEqual(['com.example.monitor']);
  });

  it('fences stale generations and removes descendants without letting old handles resurrect them', () => {
    const registry = new PluginSidebarRegistry();
    const old = registry.attach('com.example.one');
    const stale = old.api.register({ id: 'root', title: 'Old' });
    const current = registry.attach('com.example.one');
    const parent = current.api.register({ id: 'root', title: 'Current' });
    const child = current.api.register({ id: 'child', title: 'Child', parent: { item: 'root' }, view: 'detail' });
    old.dispose();
    stale.dispose();
    expect(registry.snapshot()).toHaveLength(2);
    expect(() => stale.update({ title: 'Stale' })).toThrow('no longer active');
    parent.dispose();
    expect(registry.snapshot()).toEqual([]);
    expect(() => child.update({ title: 'Resurrect' })).toThrow('removed');
    current.api.register({ id: 'root', title: 'Replacement' });
    current.api.register({ id: 'child', title: 'New child', parent: { item: 'root' } });
    child.dispose();
    expect(registry.snapshot()).toHaveLength(2);
  });

  it('rejects cycles and foreign or missing parents atomically', () => {
    const registry = new PluginSidebarRegistry();
    const a = registry.attach('com.example.a');
    const b = registry.attach('com.example.b');
    const root = a.api.register({ id: 'root', title: 'Root' });
    a.api.register({ id: 'child', title: 'Child', parent: { item: 'root' } });
    expect(() => root.update({ parent: { item: 'child' } })).toThrow('cycle');
    expect(() => b.api.register({ id: 'child', title: 'Foreign', parent: { item: 'root' } })).toThrow('not registered');
    expect(() => a.api.register({ id: 'outside', title: 'Outside', parent: { host: 'unknown' } })).toThrow('position');
    expect(registry.snapshot()).toHaveLength(2);
    expect(registry.snapshot().find((entry) => entry.id === 'root')?.parent).toBeUndefined();
  });

  it('snapshots caller input and emits updated badges without mutating prior snapshots', () => {
    const registry = new PluginSidebarRegistry();
    const owner = registry.attach('com.example.one');
    const params = { room: 'first' };
    const handle = owner.api.register({ id: 'room', title: 'Room', view: 'detail', params });
    const first = registry.snapshot();
    params.room = 'changed outside registry';
    const changed = vi.fn();
    registry.subscribe(changed);
    handle.update({ badge: 4 });
    expect(changed).toHaveBeenCalledOnce();
    expect(first[0].badge).toBeUndefined();
    expect(registry.snapshot()[0]).toMatchObject({ badge: 4, params: { room: 'first' } });
    expect(() => handle.update({ badge: -1 })).toThrow('Invalid');
    expect(registry.snapshot()[0].badge).toBe(4);
  });
  it('rejects reparenting that would push an existing subtree beyond the nesting limit', () => {
    const registry = new PluginSidebarRegistry();
    const owner = registry.attach('com.example.deep');
    owner.api.register({ id: 'a', title: 'A' });
    owner.api.register({ id: 'b', title: 'B', parent: { item: 'a' } });
    owner.api.register({ id: 'c', title: 'C', parent: { item: 'b' } });
    const root = owner.api.register({ id: 'root', title: 'Root' });
    owner.api.register({ id: 'child', title: 'Child', parent: { item: 'root' } });
    expect(() => root.update({ parent: { item: 'c' } })).toThrow('deeply nested');
    expect(registry.snapshot().find((entry) => entry.id === 'root')?.parent).toBeUndefined();
    expect(() => owner.api.register({ id: 'invalid', title: 'Invalid', parent: {} as any })).toThrow('parent');
  });
});
