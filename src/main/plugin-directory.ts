import { createHash } from 'node:crypto';
import { lstat, readFile, readdir, realpath } from 'node:fs/promises';
import { join, relative, resolve, sep } from 'node:path';
import type { SeedPluginRuntimeDefinition } from '../shared/contracts';
import { loadSeedPluginManifest, MAX_SEED_PLUGIN_PACKAGE_BYTES } from './seed-package';

const ignoredMetadata = new Set(['.DS_Store', 'Thumbs.db', 'desktop.ini']);

/** The only directory reader for installed and development bundles. Never executes plugin code. */
export async function inspectPluginDirectory(directory: string, expectedManifestSha256?: string) {
  if ((await lstat(directory)).isSymbolicLink()) throw new Error('Plugin directories cannot be symbolic links.');
  const root = await realpath(directory);
  const files = new Map<string, Buffer>();
  let total = 0;
  async function walk(folder: string) {
    for (const entry of await readdir(folder, { withFileTypes: true })) {
      const path = join(folder, entry.name),
        metadata = await lstat(path);
      if (metadata.isSymbolicLink()) throw new Error('Plugin resources cannot be symbolic links.');
      if (metadata.isDirectory()) await walk(path);
      else if (metadata.isFile()) {
        if (ignoredMetadata.has(entry.name)) continue;
        total += metadata.size;
        if (total > MAX_SEED_PLUGIN_PACKAGE_BYTES || files.size >= 2_000)
          throw new Error('Plugin resources exceed size limits.');
        files.set(relative(root, path).split(sep).join('/'), await readFile(path));
      } else throw new Error('Unsupported plugin resource type.');
    }
  }
  await walk(root);
  const manifestBody = files.get('manifest.json');
  if (!manifestBody) throw new Error('Only manifest.json Plugin API v2 bundles are supported.');
  const manifestSha256 = createHash('sha256').update(manifestBody).digest('hex');
  if (expectedManifestSha256 !== undefined && manifestSha256 !== expectedManifestSha256)
    throw new Error('Installed plugin manifest does not match its installation record.');
  const manifest = await loadSeedPluginManifest(async (path) => {
    const bytes = files.get(path);
    if (!bytes) throw new Error('Plugin resource is missing: ' + path);
    return bytes;
  });
  if (files.size !== manifest.jsonManifest.resources.length + 1)
    throw new Error('Plugin resources do not match the manifest.');
  for (const resource of manifest.jsonManifest.resources) {
    const bytes = files.get(resource.path);
    if (!bytes || createHash('sha256').update(bytes).digest('hex') !== resource.sha256)
      throw new Error('Plugin resource checksum mismatch: ' + resource.path);
  }
  const icon = (reference?: string) => {
    if (!reference) return undefined;
    const bytes = files.get(reference.replace(/^\.\//, ''));
    const extension = reference.split('.').at(-1)?.toLowerCase();
    const mime =
      extension === 'svg'
        ? 'image/svg+xml'
        : extension === 'jpg' || extension === 'jpeg'
          ? 'image/jpeg'
          : 'image/' + extension;
    return bytes?.length && bytes.length <= 256 * 1024 ? `data:${mime};base64,${bytes.toString('base64')}` : undefined;
  };
  return {
    root,
    manifest,
    manifestDigest: 'sha256:' + manifestSha256,
    files,
    iconDataUrl: icon(manifest.icon),
    iconDarkDataUrl: icon(manifest.iconDark),
  };
}

export function directoryRuntimePlugin(
  inspected: Awaited<ReturnType<typeof inspectPluginDirectory>>,
  publisherType: 'official' | 'community',
): SeedPluginRuntimeDefinition {
  const { root, manifest, iconDataUrl, iconDarkDataUrl } = inspected;
  return {
    package_id: manifest.id,
    version: manifest.version,
    name: manifest.name,
    ...(iconDataUrl ? { icon_data_url: iconDataUrl } : {}),
    ...(iconDarkDataUrl ? { icon_dark_data_url: iconDarkDataUrl } : {}),
    publisher_type: publisherType,
    runtime_kind: manifest.runtime.kind,
    root_path: root,
    entry_path: resolve(root, 'main.js'),
    api_version: 2,
    has_service: manifest.jsonManifest.service,
    resources: manifest.jsonManifest.resources.map((resource) => resource.path),
    sdk_manifest: {
      id: manifest.id,
      name: manifest.name.en_US,
      version: manifest.version,
      minAppVersion: manifest.minSeedVersion,
      description: manifest.description.en_US,
      author: manifest.jsonManifest.author,
      translations: manifest.translations,
    },
    sidecars: manifest.sidecars.map((sidecar) => ({ id: sidecar.id, path: resolve(root, sidecar.path) })),
    permissions: manifest.permissions,
    consumes: manifest.consumes,
    capabilities: [],
  };
}
