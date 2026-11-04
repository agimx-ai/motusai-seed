import type { PluginSidebar, PluginSidebarItem } from '@motus-ai/seed-sdk';

export type PluginSidebarEntry = Readonly<PluginSidebarItem & { key: string; pluginId: string }>;
export type PluginPageTarget = Readonly<{ view: string; params?: Readonly<Record<string, string>> }>;
export type PluginSidebarRoute = PluginPageTarget & { key: string; pluginId: string; title: string };
type Owner = { ready: boolean; items: Map<string, PluginSidebarItem> };
const idPattern = /^[a-z][a-z0-9._-]{0,127}$/;
const hostSlots = new Set(['overview', 'plugins', 'activity', 'quick-actions']);
const empty: readonly PluginSidebarEntry[] = Object.freeze([]);

/** Owns only generic navigation metadata. Plugin data and page rendering stay in the plugin. */
export class PluginSidebarRegistry {
  private readonly owners = new Map<string, Owner>();
  private readonly listeners = new Set<() => void>();
  private readonly routeListeners = new Set<(route: PluginSidebarRoute) => void>();
  private entries: readonly PluginSidebarEntry[] = empty;
  readonly subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  readonly snapshot = () => this.entries;
  onOpen(listener: (route: PluginSidebarRoute) => void) {
    this.routeListeners.add(listener);
    return () => {
      this.routeListeners.delete(listener);
    };
  }

  isReady(pluginId: string): boolean {
    return this.owners.get(pluginId)?.ready ?? false;
  }

  attach(pluginId: string): { api: PluginSidebar; ready(): void; dispose(): void } {
    const owner: Owner = { ready: false, items: new Map() };
    this.owners.set(pluginId, owner);
    this.publish();
    const assertCurrent = () => {
      if (this.owners.get(pluginId) !== owner) throw new Error('Plugin sidebar registration is no longer active.');
    };
    return {
      api: {
        supportsHost: (host) => hostSlots.has(host),
        register: (item) => {
          assertCurrent();
          if (owner.items.has(item.id)) throw new Error('Duplicate plugin navigation item: ' + item.id);
          let current = this.validate(item, owner);
          owner.items.set(current.id, current);
          this.publish();
          let disposed = false;
          return {
            update: (change) => {
              assertCurrent();
              if (disposed || owner.items.get(current.id) !== current)
                throw new Error('Plugin navigation item was removed.');
              const next = this.validate({ ...current, ...change, id: current.id }, owner);
              owner.items.set(current.id, next);
              current = next;
              this.publish();
            },
            dispose: () => {
              if (disposed) return;
              disposed = true;
              if (this.owners.get(pluginId) !== owner || owner.items.get(current.id) !== current) return;
              const remove = (id: string) => {
                for (const child of [...owner.items.values()])
                  if (child.parent && 'item' in child.parent && child.parent.item === id) remove(child.id);
                owner.items.delete(id);
              };
              remove(current.id);
              this.publish();
            },
          };
        },
        open: async (id) => {
          assertCurrent();
          return this.open(pluginId + ':' + id);
        },
      },
      ready: () => {
        assertCurrent();
        owner.ready = true;
        this.publish();
      },
      dispose: () => {
        if (this.owners.get(pluginId) !== owner) return;
        this.owners.delete(pluginId);
        this.publish();
      },
    };
  }

  open(key: string): boolean {
    const entry = this.entries.find((item) => item.key === key);
    if (entry?.onSelect) {
      entry.onSelect();
      return true;
    }
    if (!entry?.view || !this.routeListeners.size) return false;
    const route: PluginSidebarRoute = {
      key,
      pluginId: entry.pluginId,
      title: entry.title,
      view: entry.view,
      ...(entry.params ? { params: { ...entry.params } } : {}),
    };
    for (const listener of this.routeListeners) listener(route);
    return true;
  }

  private validate(item: PluginSidebarItem, owner: Owner): PluginSidebarItem {
    if (
      !idPattern.test(item.id) ||
      typeof item.title !== 'string' ||
      !item.title.trim() ||
      item.title.length > 160 ||
      (item.view !== undefined && !idPattern.test(item.view)) ||
      (item.onSelect !== undefined && (typeof item.onSelect !== 'function' || item.view !== undefined)) ||
      (item.icon !== undefined && !idPattern.test(item.icon)) ||
      (item.order !== undefined && (!Number.isFinite(item.order) || Math.abs(item.order) > 10000)) ||
      (item.badge !== undefined && (!Number.isSafeInteger(item.badge) || item.badge < 0))
    )
      throw new Error('Invalid plugin navigation item.');
    if (!owner.items.has(item.id) && owner.items.size >= 2000) throw new Error('Too many plugin navigation items.');
    if (
      item.params !== undefined &&
      (!item.view || item.onSelect !== undefined ||
        !item.params ||
        typeof item.params !== 'object' ||
        Array.isArray(item.params) ||
        Object.keys(item.params).length > 16 ||
        Object.entries(item.params).some(
          ([key, value]) => !idPattern.test(key) || typeof value !== 'string' || value.length > 512,
        ))
    )
      throw new Error('Invalid plugin page parameters.');
    if (item.parent !== undefined && (!item.parent || typeof item.parent !== 'object'))
      throw new Error('Invalid plugin navigation parent.');
    if (item.parent) {
      if ('host' in item.parent) {
        if (Object.keys(item.parent).length !== 1 || !hostSlots.has(item.parent.host))
          throw new Error('Unknown navigation extension position.');
        if (item.parent.host === 'quick-actions' && (!item.onSelect || item.badge !== undefined))
          throw new Error('Quick actions must be standalone menu actions.');
      } else {
        if (Object.keys(item.parent).length !== 1 || !idPattern.test(item.parent.item))
          throw new Error('Invalid plugin navigation parent.');
        let id: string | undefined = item.parent.item;
        const seen = new Set([item.id]);
        while (id) {
          if (seen.has(id)) throw new Error('Plugin navigation cycle.');
          seen.add(id);
          if (seen.size > 4) throw new Error('Plugin navigation is too deeply nested.');
          const parent = owner.items.get(id);
          if (!parent) throw new Error('Plugin navigation parent is not registered.');
          id = parent.parent && 'item' in parent.parent ? parent.parent.item : undefined;
        }
      }
    }
    // Reparenting a whole branch must also respect the depth of its existing descendants.
    const candidates = new Map(owner.items);
    candidates.set(item.id, item);
    for (const candidate of candidates.values()) {
      let parent = candidate.parent;
      let depth = 1;
      const seen = new Set([candidate.id]);
      while (parent && 'item' in parent) {
        if (seen.has(parent.item)) throw new Error('Plugin navigation cycle.');
        seen.add(parent.item);
        if (++depth > 4) throw new Error('Plugin navigation is too deeply nested.');
        parent = candidates.get(parent.item)?.parent;
        if (parent && 'host' in parent && parent.host === 'quick-actions')
          throw new Error('Quick actions cannot contain navigation items.');
      }
    }
    return Object.freeze({
      ...item,
      ...(item.parent ? { parent: Object.freeze({ ...item.parent }) } : {}),
      ...(item.params ? { params: Object.freeze({ ...item.params }) } : {}),
    });
  }

  private publish() {
    this.entries = Object.freeze(
      [...this.owners]
        .flatMap(([pluginId, owner]) =>
          [...owner.items.values()].map((item) => Object.freeze({ ...item, pluginId, key: pluginId + ':' + item.id })),
        )
        .sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || a.key.localeCompare(b.key)),
    );
    for (const listener of this.listeners) listener();
  }
}

export const pluginSidebar = new PluginSidebarRegistry();
