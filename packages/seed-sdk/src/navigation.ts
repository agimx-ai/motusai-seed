/** One plugin-owned level below the host's plugin root. IDs must be unique within a path. */
export type PluginBreadcrumb = {
  readonly id: string;
  readonly label: string;
};

export type PluginNavigationOptions = {
  /** Bind the handle to the page/effect lifetime; also dispose it when that page is hidden. */
  signal: AbortSignal;
  /** null targets the plugin root. Return false to keep the current path (for example, an unsaved draft). */
  onNavigate: (id: string | null, signal: AbortSignal) => void | boolean | Promise<void | boolean>;
};

export type PluginNavigationHandle = {
  /** Publish the path below “Plugins” and the plugin name. Nonempty paths collapse plugin information; [] restores it. */
  setPath(path: readonly PluginBreadcrumb[]): void;
  /** Navigate to the parent; false at the plugin root, while busy, after disposal, or when declined. */
  back(): Promise<boolean>;
  /** Idempotent. Hiding, switching views and reloading also invalidate the handle automatically. */
  dispose(): void;
};

export type PluginNavigation = {
  /** Create while displaying a page. A new handle replaces the previous page's navigation. */
  create(options: PluginNavigationOptions): PluginNavigationHandle;
};
