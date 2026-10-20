import { createHash, randomUUID } from 'node:crypto';
import { Buffer } from 'node:buffer';
import { createWriteStream } from 'node:fs';
import { access, lstat, mkdir, readFile, rename, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ZipArchive } from 'archiver';
import { safePath, type BuiltPluginManifest, type PluginResource } from './manifest.mjs';

export type PluginPackageVariant = {
  platform?: 'darwin' | 'win32' | 'linux';
  architecture?: 'arm64' | 'x64';
  manifest?: BuiltPluginManifest;
  files?: PluginResource[];
};

export type PluginPackageHook = (input: {
  pluginRoot: string;
  manifest: BuiltPluginManifest;
}) => Array<PluginPackageVariant | undefined> | Promise<Array<PluginPackageVariant | undefined>>;

export type CollectPluginFilesOptions = {
  root?: string;
  outdir?: string;
  variant?: PluginPackageVariant;
};

export type PackPluginOptions = CollectPluginFilesOptions & { packages?: string };

export async function readPackageVariants(root: string, manifest: BuiltPluginManifest, fresh = false) {
  const hook = resolve(root, 'package.mjs');
  if (!(await access(hook).then(() => true, () => false))) return [undefined];
  const url = pathToFileURL(hook).href + (fresh ? '?generation=' + randomUUID() : '');
  const packageHook: PluginPackageHook = (await import(url)).default;
  const variants = await packageHook({ pluginRoot: root, manifest });
  if (!Array.isArray(variants) || !variants.length) throw new Error('Package hook returned no targets.');
  return variants;
}

export async function collectPluginFiles({ root = process.cwd(), outdir = 'dist', variant }: CollectPluginFilesOptions = {}) {
  const output = resolve(root, outdir);
  const manifestBody = await readFile(resolve(output, 'manifest.json'));
  const manifest = JSON.parse(manifestBody.toString('utf8')) as BuiltPluginManifest;
  if (
    !/^[a-z][a-z0-9-]*(?:\.[a-z0-9-]+)+$/.test(manifest.id) ||
    !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(manifest.version)
  )
    throw new Error('Invalid package identity.');
  const entries = new Map<string, Buffer>([['manifest.json', manifestBody]]);
  for (const resource of manifest.resources) {
    if (!safePath(resource.path) || entries.has(resource.path)) throw new Error('Invalid package resource.');
    const source = resolve(output, resource.path),
      metadata = await lstat(source);
    if (!metadata.isFile() || metadata.isSymbolicLink()) throw new Error('Package resources must be regular files.');
    const body = await readFile(source);
    if (createHash('sha256').update(body).digest('hex') !== resource.sha256)
      throw new Error('Built resource changed: ' + resource.path);
    entries.set(resource.path, body);
  }
  const targeted = variant?.platform !== undefined || variant?.architecture !== undefined;
  if (
    targeted &&
    (!['darwin', 'win32', 'linux'].includes(variant.platform ?? '') || !['arm64', 'x64'].includes(variant.architecture ?? ''))
  )
    throw new Error('Invalid package target.');
  if (variant) {
    const target = variant.manifest ?? manifest;
    if (
      target.id !== manifest.id ||
      target.version !== manifest.version ||
      target.apiVersion !== 2 ||
      target.runtime !== manifest.runtime ||
      target.service !== manifest.service
    )
      throw new Error('Package hook changed the project identity or loading contract.');
    for (const resource of variant.files ?? []) {
      if (!safePath(resource.path) || entries.has(resource.path))
        throw new Error('Invalid or duplicate additional resource.');
      const source = resolve(root, resource.source),
        metadata = await lstat(source);
      if (!metadata.isFile() || metadata.isSymbolicLink())
        throw new Error('Additional resources must be regular files.');
      entries.set(resource.path, await readFile(source));
    }
    const document = {
      ...target,
      resources: [...entries]
        .filter(([path]) => path !== 'manifest.json')
        .map(([path, body]) => ({ path, sha256: createHash('sha256').update(body).digest('hex') })),
    };
    for (const sidecar of document.sidecars ?? [])
      if (!entries.has(sidecar.path)) throw new Error('Sidecar is not a declared resource.');
    entries.set('manifest.json', Buffer.from(JSON.stringify(document, null, 2) + '\n'));
  }
  return { manifest: JSON.parse(entries.get('manifest.json')!.toString('utf8')) as BuiltPluginManifest, entries, targeted };
}

export async function packPlugin({ root = process.cwd(), outdir = 'dist', packages = 'artifacts', variant }: PackPluginOptions = {}) {
  const { manifest, entries, targeted } = await collectPluginFiles({ root, outdir, variant });
  const packageRoot = resolve(root, packages);
  await mkdir(packageRoot, { recursive: true });
  const suffix = targeted ? `-${variant!.platform}-${variant!.architecture}` : '';
  const packagePath = resolve(packageRoot, `${manifest.id}-${manifest.version}${suffix}.seedpkg`);
  const temporary = packagePath + '.building-' + process.pid;
  try {
    await new Promise<void>((done, reject) => {
      const stream = createWriteStream(temporary, { mode: 0o600 });
      const archive = new ZipArchive({ zlib: { level: 9 }, forceLocalTime: false });
      stream.on('close', done);
      stream.on('error', reject);
      archive.on('error', reject);
      archive.pipe(stream);
      for (const [path, body] of [...entries].sort(([a], [b]) => a.localeCompare(b)))
        archive.append(body, { name: path, date: new Date('1980-01-01T00:00:00Z'), mode: 0o600 });
      void archive.finalize().catch(reject);
    });
    await rename(temporary, packagePath);
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
  const body = await readFile(packagePath);
  return { packagePath, sha256: createHash('sha256').update(body).digest('hex'), size: body.length };
}
