import { isAbsolute } from 'node:path';

export type BuiltPluginManifest = {
  id: string;
  version: string;
  apiVersion: 2;
  runtime: 'native-host' | 'sandboxed-web';
  service: boolean;
  resources: Array<{ path: string; sha256: string }>;
  sidecars?: Array<{ path: string; [key: string]: unknown }>;
  [key: string]: unknown;
};

export type PluginResource = { path: string; source: string };

export function safePath(path: unknown): path is string {
  return (
    typeof path === 'string' &&
    path.length > 0 &&
    !isAbsolute(path) &&
    !path.includes('\\') &&
    !path.includes('\0') &&
    !path.includes(':') &&
    path
      .split('/')
      .every(
        (part) =>
          part &&
          part !== '.' &&
          part !== '..' &&
          !/[. ]$/.test(part) &&
          !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part),
      )
  );
}
