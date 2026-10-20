import { createHash } from 'node:crypto';
import { isUtf8 } from 'node:buffer';
import { lstat, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, extname, relative, resolve } from 'node:path';
import { build, type BuildOptions } from 'esbuild';
import { compile } from '@tailwindcss/node';
import { Scanner } from '@tailwindcss/oxide';
import { fileURLToPath } from 'node:url';
import { capabilityPackageMetadata, type CapabilityDefinition } from '../capability.js';
import { createPluginI18n, resolvePluginTranslationReferences, type PluginTranslations } from '../i18n.js';
import { safePath, type BuiltPluginManifest, type PluginResource } from './manifest.mjs';

export type BuildPluginOptions = {
  root?: string;
  runtime?: BuiltPluginManifest['runtime'];
  view?: string;
  service?: string;
  styles?: string;
  outdir?: string;
  resources?: PluginResource[];
  serviceOptions?: BuildOptions;
  capabilities?: string;
};

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

function normalizeResource(path: string, body: Buffer): Buffer {
  if (!textResourceExtensions.has(extname(path).toLowerCase())) return body;
  if (!isUtf8(body)) throw new Error('Text resources must be UTF-8: ' + path);
  return Buffer.from(body.toString('utf8').replace(/\r\n?/g, '\n'));
}

/** Executes author code; do not use for installed package inspection. */
export async function readPluginCapabilities({ root = process.cwd(), entry = 'src/capabilities.ts' } = {}): Promise<CapabilityDefinition[]> {
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
  ) as { capabilities: CapabilityDefinition[] };
  if (
    !Array.isArray(module.capabilities) ||
    new Set(module.capabilities.map((item) => item.id)).size !== module.capabilities.length
  )
    throw new Error('Invalid capability metadata entry.');
  return module.capabilities;
}

async function bundleGraph(root: string, entry: string, role: 'view' | 'service', options: BuildOptions = {}) {
  const result = await build({
    absWorkingDir: root,
    entryPoints: [entry],
    bundle: true,
    format: 'cjs',
    platform: role === 'view' ? 'browser' : (options.platform ?? 'node'),
    target: role === 'view' ? 'chrome130' : 'node24',
    external: sdkPackages,
    mainFields: ['module', 'main'],
    packages: 'bundle',
    logLevel: 'silent',
    define: { 'import.meta.url': '__seedPluginUrl' },
    ...options,
    write: false,
    metafile: true,
    plugins: [{
      name: 'seed-runtime-boundary',
      setup(build) {
        build.onResolve({ filter: /^@motus-ai\/seed-sdk\/tools(?:\/|$)/ }, () => ({
          errors: [{ text: 'SDK tools are only available to author build scripts, not plugin runtime entries.' }],
        }));
      },
    }, ...(options.plugins ?? [])],
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

function factory(name: string, source: string, service: boolean) {
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

async function buildStyles(root: string, viewCode: string, styles: string | undefined, pluginId: string) {
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
}: BuildPluginOptions = {}): Promise<{ output: string; manifest: BuiltPluginManifest }> {
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
    const translations: PluginTranslations = { defaultLocale: sourceManifest.i18n?.defaultLocale ?? 'en-US', resources: {} };
    const files = new Map<string, Buffer>([
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
      for (const [locale, path] of Object.entries(declaration.resources ?? {}) as Array<[string, string]>) {
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
    const project = await readFile(resolve(root, 'package.json'), 'utf8').then((body) => JSON.parse(body), (error) => {
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
    const manifest: BuiltPluginManifest = {
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
