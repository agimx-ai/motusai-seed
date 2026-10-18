import { Plugin, PluginService, type App, type PluginManifest, type PluginServices } from '@motus-ai/seed-sdk';

export type PluginSdkModules = Record<string, unknown>;

/** The generation URL is assigned by the resource broker, never by plugin metadata. */
export async function loadPluginBundle(entryUrl: string): Promise<PluginBundle> {
  return pluginBundle(await import(/* @vite-ignore */ entryUrl));
}
export type PluginBundle = {
  seedPluginBundleVersion: 2;
  loadView(modules: PluginSdkModules, entryUrl: string): new (app: App, manifest: PluginManifest) => Plugin;
  loadService?: (
    modules: PluginSdkModules,
    require: (id: string) => unknown,
    entryUrl: string,
  ) => new (app: PluginServices, manifest: PluginManifest) => PluginService;
};

export function pluginBundle(value: unknown): PluginBundle {
  const bundle = value as Partial<PluginBundle> | null;
  if (
    !bundle ||
    bundle.seedPluginBundleVersion !== 2 ||
    typeof bundle.loadView !== 'function' ||
    (bundle.loadService !== undefined && typeof bundle.loadService !== 'function')
  )
    throw new Error('Invalid Seed plugin bundle v2.');
  return bundle as PluginBundle;
}

export function pluginViewConstructor(bundle: PluginBundle, modules: PluginSdkModules, entryUrl: string) {
  const constructor = bundle.loadView(modules, entryUrl);
  if (typeof constructor !== 'function' || !(constructor.prototype instanceof Plugin))
    throw new Error('view entry must default-export a Plugin subclass.');
  return constructor;
}

export function pluginServiceConstructor(
  bundle: PluginBundle,
  modules: PluginSdkModules,
  require: (id: string) => unknown,
  entryUrl: string,
) {
  if (!bundle.loadService) throw new Error('Plugin has no service entry.');
  const constructor = bundle.loadService(modules, require, entryUrl);
  if (typeof constructor !== 'function' || !(constructor.prototype instanceof PluginService))
    throw new Error('Service entry must default-export a PluginService subclass.');
  return constructor;
}
