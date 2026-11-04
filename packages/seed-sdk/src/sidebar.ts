/** A navigation contribution is registered by plugin code, never by a manifest renderer declaration. */
export type PluginSidebarItem = {
  /** Stable within the owning plugin. */
  id: string;
  title: string;
  /** Lucide icon name, for example "message-circle". */
  icon?: string;
  /** Omit for a top-level contribution. Host positions: overview, plugins, activity. */
  parent?: { host: string } | { item: string };
  /** A type registered with Plugin.registerView. Omit for an expandable group. */
  view?: string;
  /** Execute an action without changing the active page. Mutually exclusive with view and params. */
  onSelect?: () => void;
  /** Small, non-secret identifiers passed to View.setState before opening. */
  params?: Readonly<Record<string, string>>;
  order?: number;
  badge?: number;
};

export type PluginSidebarHandle = {
  update(change: Partial<Omit<PluginSidebarItem, 'id'>>): void;
  dispose(): void;
};

export type PluginSidebar = {
  register(item: PluginSidebarItem): PluginSidebarHandle;
  /** Opens one of this plugin's registered pages through the product navigation. */
  open(id: string): Promise<boolean>;
};
