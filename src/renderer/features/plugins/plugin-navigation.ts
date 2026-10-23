import type { PluginBreadcrumb, PluginNavigation, PluginNavigationOptions } from '@motus-ai/seed-sdk';

export type PluginBreadcrumbState = {
  path: readonly PluginBreadcrumb[];
  busy: boolean;
  navigate(id: string | null): Promise<boolean>;
};

export type PluginHeaderNavigation = PluginBreadcrumbState & { pluginId: string };

type Scope = {
  options: PluginNavigationOptions;
  path: readonly PluginBreadcrumb[];
  revision: number;
  pending?: AbortController;
  dispose(): void;
};

/** Only the visible page can contribute to the product header. Business routes stay in the plugin. */
export class PluginNavigationController {
  private scope?: Scope;
  readonly api: PluginNavigation;

  constructor(
    private readonly isActive: () => boolean,
    private readonly change: (state: PluginBreadcrumbState | undefined) => void,
    private readonly report: (error: unknown) => void,
  ) {
    this.api = {
      create: (options) => {
        if (!this.isActive()) throw new Error('Plugin navigation requires a visible page.');
        options.signal.throwIfAborted();
        this.clear();
        const scope: Scope = {
          options,
          path: [],
          revision: 0,
          dispose: () => {
            options.signal.removeEventListener('abort', scope.dispose);
            if (this.scope === scope) {
              this.scope = undefined;
              this.change(undefined);
            }
            scope.pending?.abort();
          },
        };
        this.scope = scope;
        options.signal.addEventListener('abort', scope.dispose, { once: true });
        this.publish(scope);
        return {
          setPath: (path) => {
            if (!this.current(scope)) throw new Error('Plugin navigation is no longer active.');
            const ids = new Set<string>();
            const copy = path.map(({ id, label }) => {
              if (typeof id !== 'string' || !id.trim() || ids.has(id) || typeof label !== 'string' || !label.trim())
                throw new Error('Breadcrumb IDs and labels must be nonempty, with unique IDs.');
              ids.add(id);
              return Object.freeze({ id, label });
            });
            scope.path = Object.freeze(copy);
            scope.revision++;
            this.publish(scope);
          },
          back: () => this.navigate(scope, scope.path.at(-2)?.id ?? null),
          dispose: scope.dispose,
        };
      },
    };
  }

  clear() {
    this.scope?.dispose();
  }

  private current(scope: Scope) {
    return this.scope === scope && this.isActive() && !scope.options.signal.aborted;
  }

  private publish(scope: Scope) {
    if (!this.current(scope)) return;
    this.change({
      path: scope.path,
      busy: !!scope.pending,
      navigate: async (id) => {
        try {
          return await this.navigate(scope, id);
        } catch (error) {
          this.report(error);
          return false;
        }
      },
    });
  }

  private async navigate(scope: Scope, id: string | null): Promise<boolean> {
    if (!this.current(scope) || scope.pending || !scope.path.length) return false;
    const index = id === null ? -1 : scope.path.findIndex((item) => item.id === id);
    if ((id !== null && index < 0) || index >= scope.path.length - 1) return false;
    const pending = (scope.pending = new AbortController());
    const revision = scope.revision;
    this.publish(scope);
    try {
      const accepted = await scope.options.onNavigate(id, pending.signal);
      if (!this.current(scope) || pending.signal.aborted || accepted === false) return false;
      // The callback may publish a newer route/title itself. Never overwrite that path.
      if (scope.revision === revision) scope.path = Object.freeze(scope.path.slice(0, index + 1));
      return true;
    } catch (error) {
      if (pending.signal.aborted) return false;
      throw error;
    } finally {
      if (scope.pending === pending) scope.pending = undefined;
      if (this.current(scope)) this.publish(scope);
    }
  }
}
