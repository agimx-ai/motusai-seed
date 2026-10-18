import { createHash } from 'node:crypto';
import { isUtf8 } from 'node:buffer';
import { createWriteStream } from 'node:fs';
import { lstat, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, extname, isAbsolute, relative, resolve } from 'node:path';
import { build } from 'esbuild';
import { compile } from '@tailwindcss/node';
import { Scanner } from '@tailwindcss/oxide';
import { fileURLToPath } from 'node:url';
import { capabilityPackageMetadata, createPluginI18n, resolvePluginTranslationReferences } from '@motus-ai/seed-sdk';
import { ZipArchive } from 'archiver';

const sdkPackages = [
  '@motus-ai/seed-sdk',
  '@motus-ai/seed-sdk/react',
  'react',
  'react/jsx-runtime',
  'react/jsx-dev-runtime',
  'react-dom',
  'react-dom/client',
];
const coreFiles = new Set(['manifest.json', 'main.js', 'styles.css', 'metadata.json']);
const textResourceExtensions = new Set([
  '.css',
  '.csv',
  '.htm',
  '.html',
  '.json',
  '.md',
  '.markdown',
  '.svg',
  '.tsv',
  '.txt',
  '.xml',
  '.yaml',
  '.yml',
]);

/** Author text must hash identically when the same source checkout is packaged on Windows, macOS or Linux. */
function normalizeResource(path, body) {
  if (!textResourceExtensions.has(extname(path).toLowerCase())) return body;
  if (!isUtf8(body)) throw new Error('Text resources must be UTF-8: ' + path);
  return Buffer.from(body.toString('utf8').replace(/\r\n?/g, '\n'));
}

/** Trusted author-time metadata entry, never loaded by the installed client or a manifest reader. */
export async function readPluginCapabilities({ root = process.cwd(), entry = 'src/capabilities.ts' } = {}) {
  const compiled = await build({
    absWorkingDir: resolve(root),
    entryPoints: [entry],
    bundle: true,
    write: false,
    platform: 'node',
    format: 'esm',
    target: 'node24',
    logLevel: 'silent',
  });
  const module = await import(
    'data:text/javascript;base64,' + Buffer.from(compiled.outputFiles[0].text).toString('base64')
  );
  if (
    !Array.isArray(module.capabilities) ||
    new Set(module.capabilities.map((item) => item.id)).size !== module.capabilities.length
  )
    throw new Error('Invalid capability metadata entry.');
  return module.capabilities;
}

function safePath(path) {
  return (
    typeof path === 'string' &&
    path &&
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

async function bundleGraph(root, entry, role, options = {}) {
  const result = await build({
    absWorkingDir: root,
    entryPoints: [entry],
    bundle: true,
    write: false,
    format: 'cjs',
    platform: role === 'view' ? 'browser' : (options.platform ?? 'node'),
    target: role === 'view' ? 'chrome130' : 'node24',
    external: sdkPackages,
    mainFields: ['module', 'main'],
    packages: 'bundle',
    metafile: true,
    logLevel: 'silent',
    define: { 'import.meta.url': '__seedPluginUrl' },
    ...options,
  });
  const external = Object.values(result.metafile.outputs)
    .flatMap((output) => output.imports)
    .filter((item) => item.external);
  if ((role === 'view' || options.platform === 'browser') && external.some((item) => !sdkPackages.includes(item.path)))
    throw new Error('Browser entry imports a non-SDK external module.');
  if (result.outputFiles.length !== 1)
    throw new Error('Each entry must build to one JavaScript graph. Declare non-code resources explicitly.');
  return result.outputFiles[0].text;
}

function factory(name, source, service) {
  return (
    'export function ' +
    name +
    '(modules' +
    (service ? ', hostRequire, __seedPluginUrl' : ', __seedPluginUrl') +
    ') {\n' +
    'const module = { exports: {} }; const exports = module.exports;\n' +
    'const require = (id) => { if (Object.hasOwn(modules, id)) return modules[id]; ' +
    (service ? 'return hostRequire(id);' : 'throw new Error("Module unavailable in view: " + id);') +
    ' };\n' +
    source +
    '\nreturn module.exports.default;\n}\n'
  );
}

/** Compile only this view graph, never depend on the client's source scan or scan the backend. */
async function buildStyles(root, viewCode, styles, pluginId) {
  const theme = fileURLToPath(import.meta.resolve('@motus-ai/seed-sdk/theme.css'));
  const tailwind = fileURLToPath(import.meta.resolve('tailwindcss/package.json'));
  const imports = [
    `@import ${JSON.stringify(resolve(dirname(tailwind), 'theme.css'))} layer(theme);`,
    `@layer utilities { @scope ([data-plugin-view-owner=${JSON.stringify(pluginId)}], [data-plugin-view-portal=${JSON.stringify(pluginId)}]) { @tailwind utilities source(none); } }`,
    `@import ${JSON.stringify(theme)};`,
    ...(styles ? [`@import ${JSON.stringify(resolve(root, styles))};`] : []),
  ].join('\n');
  const compiler = await compile(imports, { base: root, onDependency() {} });
  const scanner = new Scanner({ sources: compiler.sources });
  const candidates = [...scanner.scan(), ...scanner.scanFiles([{ content: viewCode, extension: 'js' }])];
  return Buffer.from(compiler.build(candidates));
}

/** Source projects have explicit view/service entry graphs; the distribution still has only one main.js. */
export async function buildPlugin({
  root = process.cwd(),
  runtime = 'sandboxed-web',
  view = 'src/main.ts',
  service,
  styles,
  outdir = 'dist',
  resources = [],
  serviceOptions,
  capabilities,
}) {
  root = resolve(root);
  const sourceManifest = JSON.parse(await readFile(resolve(root, 'manifest.json'), 'utf8'));
  if (!['sandboxed-web', 'native-host'].includes(runtime)) throw new Error('Invalid plugin build runtime.');
  if (runtime === 'native-host' && !service) throw new Error('A native plugin requires a service entry.');
  for (const field of [
    'seed',
    'apiVersion',
    'runtime',
    'service',
    'resources',
    'publisherId',
    'labels',
    'capabilities',
    'caps',
    'management',
    'configurations',
    'detail_presentation',
  ]) {
    if (Object.hasOwn(sourceManifest, field)) throw new Error(`Source manifest must not declare ${field}.`);
  }
  const viewCode = await bundleGraph(root, view, 'view');
  const serviceCode = service
    ? await bundleGraph(root, service, 'service', {
        ...serviceOptions,
        platform: runtime === 'sandboxed-web' ? 'browser' : 'node',
      })
    : undefined;
  const output = resolve(root, outdir);
  if (output === root || relative(root, output).startsWith('..'))
    throw new Error('Build output must be a child directory of the plugin project.');
  const staging = output + '.building-' + process.pid + '-' + Date.now();
  await mkdir(staging, { recursive: true });
  try {
    const translations = { defaultLocale: sourceManifest.i18n?.defaultLocale ?? 'en-US', resources: {} };
    const files = new Map([
      [
        'main.js',
        Buffer.from(
          'export const seedPluginBundleVersion = 2;\n' +
            factory('loadView', viewCode, false) +
            (serviceCode ? factory('loadService', serviceCode, true) : ''),
        ),
      ],
    ]);
    files.set('styles.css', await buildStyles(root, viewCode, styles, sourceManifest.id));
    if (sourceManifest.i18n) {
      const declaration = sourceManifest.i18n;
      for (const [locale, path] of Object.entries(declaration.resources ?? {})) {
        if (!safePath(path) || !path.endsWith('.json') || coreFiles.has(path))
          throw new Error('Invalid translation resource path: ' + path);
        const source = resolve(root, path),
          metadata = await lstat(source);
        if (!metadata.isFile() || metadata.isSymbolicLink())
          throw new Error('Translations must be regular JSON files.');
        const body = normalizeResource(path, await readFile(source));
        files.set(path, body);
        translations.resources[locale] = JSON.parse(body.toString('utf8'));
      }
      createPluginI18n(translations);
      resolvePluginTranslationReferences(sourceManifest, translations, declaration.defaultLocale);
    }
    if (!sourceManifest.i18n) translations.resources['en-US'] = {};
    const capabilityEntry = capabilities ?? 'src/capabilities.ts';
    const hasCapabilities = await lstat(resolve(root, capabilityEntry)).catch((error) => {
      if (error.code !== 'ENOENT' || capabilities !== undefined) throw error;
    });
    const definitions = hasCapabilities ? await readPluginCapabilities({ root, entry: capabilityEntry }) : [];
    if (definitions.length && !service) throw new Error('Public capabilities require a service entry.');
    const project = await readFile(resolve(root, 'package.json'), 'utf8').then(JSON.parse, (error) => {
      if (error.code !== 'ENOENT') throw error;
      return {};
    });
    const labels = project.keywords ?? ['other'];
    if (
      !Array.isArray(labels) ||
      !labels.length ||
      labels.length > 3 ||
      new Set(labels).size !== labels.length ||
      labels.some((label) => typeof label !== 'string' || !/^[a-z][a-z0-9-]{0,39}$/.test(label))
    )
      throw new Error('Invalid package catalog labels.');
    files.set(
      'metadata.json',
      Buffer.from(
        JSON.stringify({ apiVersion: 2, capabilities: capabilityPackageMetadata(definitions, translations), labels }) +
          '\n',
      ),
    );
    for (const resource of resources) {
      if (!safePath(resource.path) || coreFiles.has(resource.path) || files.has(resource.path))
        throw new Error('Invalid or duplicate resource path: ' + resource.path);
      const source = resolve(root, resource.source);
      const metadata = await lstat(source);
      if (!metadata.isFile() || metadata.isSymbolicLink())
        throw new Error('Resources must be regular files: ' + resource.source);
      files.set(resource.path, normalizeResource(resource.path, await readFile(source)));
    }
    const manifest = {
      ...sourceManifest,
      apiVersion: 2,
      runtime,
      service: Boolean(service),
      resources: [...files].map(([path, body]) => ({ path, sha256: createHash('sha256').update(body).digest('hex') })),
    };
    files.set('manifest.json', Buffer.from(JSON.stringify(manifest, null, 2) + '\n'));
    for (const [path, body] of files) {
      const target = resolve(staging, path);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, body);
    }
    // Publish a complete build last. On compile/resource failure the previous output remains intact.
    const previous = output + '.previous-' + process.pid;
    const exists = await lstat(output).then(
      () => true,
      () => false,
    );
    if (exists) await rename(output, previous);
    try {
      await rename(staging, output);
    } catch (error) {
      if (exists) await rename(previous, output);
      throw error;
    }
    if (exists) await rm(previous, { recursive: true, force: true });
    return { output, manifest };
  } catch (error) {
    await rm(staging, { recursive: true, force: true });
    throw error;
  }
}

/** Package only the built manifest and its declared resources. No business discovery or code execution. */
export async function collectPluginFiles({ root = process.cwd(), outdir = 'dist', variant } = {}) {
  const output = resolve(root, outdir);
  const manifestBody = await readFile(resolve(output, 'manifest.json'));
  const manifest = JSON.parse(manifestBody);
  if (
    !/^[a-z][a-z0-9-]*(?:\.[a-z0-9-]+)+$/.test(manifest.id) ||
    !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(manifest.version)
  )
    throw new Error('Invalid package identity.');
  const entries = new Map([['manifest.json', manifestBody]]);
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
    (!['darwin', 'win32', 'linux'].includes(variant.platform) || !['arm64', 'x64'].includes(variant.architecture))
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
  return { manifest: JSON.parse(entries.get('manifest.json')), entries, targeted };
}

export async function packPlugin({ root = process.cwd(), outdir = 'dist', packages = 'artifacts', variant } = {}) {
  const { manifest, entries, targeted } = await collectPluginFiles({ root, outdir, variant });
  const packageRoot = resolve(root, packages);
  await mkdir(packageRoot, { recursive: true });
  const suffix = targeted ? `-${variant.platform}-${variant.architecture}` : '';
  const packagePath = resolve(packageRoot, `${manifest.id}-${manifest.version}${suffix}.seedpkg`);
  const temporary = packagePath + '.building-' + process.pid;
  try {
    await new Promise((done, reject) => {
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
