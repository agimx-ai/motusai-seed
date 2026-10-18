export type PluginResources = { url(path: string): string };

/** Paths are package-relative; only verified declared assets and their directories are addressable. */
export function createPluginResources(baseUrl: string, declared: readonly string[]): PluginResources {
  const paths = new Set(declared);
  return {
    url(path) {
      const directory = path.endsWith('/');
      const parts = (directory ? path.slice(0, -1) : path).split('/');
      if (
        !path ||
        /[\\\0:?#]/.test(path) ||
        parts.some((part) => !part || part === '.' || part === '..') ||
        (directory ? !declared.some((entry) => entry.startsWith(path)) : !paths.has(path))
      )
        throw new Error('Plugin resource is not declared: ' + path);
      return new URL(path.split('/').map(encodeURIComponent).join('/'), baseUrl).href;
    },
  };
}

export type PluginFilePicker = {
  pick(options?: { extensions?: string[]; multiple?: boolean }): Promise<string[]>;
  path(file: File): string;
};
