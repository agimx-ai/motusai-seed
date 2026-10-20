import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as sdk from '@motus-ai/seed-sdk';
import { pluginBundle, pluginServiceConstructor, pluginViewConstructor } from './plugin-bundle';
import { verifySeedPackage } from '../main/seed-package';

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'seed-plugin-project-'));
  directories.push(root);
  await cp(resolve('packages/seed-plugin-tools/fixtures/generic'), root, { recursive: true });
  // Tooling is imported as a build-time tool; the project itself has no dependency on the Seed source tree.
  const tools = await import(/* @vite-ignore */ pathToFileURL(resolve('packages/seed-plugin-tools/index.mjs')).href);
  return { root, build: () => tools.buildPlugin({ root, runtime: 'native-host', service: 'src/service.ts' }) };
}

describe('single-file isolated plugin bundle', () => {
  it('exports shared React components only through the react entry', () => {
    const require = createRequire(import.meta.url);
    expect(require.resolve('@motus-ai/seed-sdk/react')).toBe(resolve('packages/seed-sdk/dist/react/index.js'));
    expect(() => require.resolve('@motus-ai/seed-sdk/ui')).toThrow(/not defined by "exports"/);
  });

  it('shares SDK toast and React imports with the host instead of bundling independent instances', async () => {
    const project = await fixture();
    await writeFile(
      join(project.root, 'src/main.ts'),
      `import { Plugin, toast } from '@motus-ai/seed-sdk';
       import { ReactSettingTab } from '@motus-ai/seed-sdk/react';
       export default class Example extends Plugin { static SettingTab = ReactSettingTab; static toast = toast; }`,
    );
    const { output } = await project.build();
    const entryUrl = pathToFileURL(join(output, 'main.js')).href;
    const bundle = pluginBundle(await import(/* @vite-ignore */ entryUrl));
    class SettingTab extends sdk.PluginSettingTab {
      display() {}
    }
    const Constructor = pluginViewConstructor(
      bundle,
      { '@motus-ai/seed-sdk': sdk, '@motus-ai/seed-sdk/react': { ReactSettingTab: SettingTab } },
      entryUrl,
    );
    expect((Constructor as typeof sdk.Plugin & { SettingTab: unknown }).SettingTab).toBe(SettingTab);
    expect((Constructor as typeof sdk.Plugin & { toast: unknown }).toast).toBe(sdk.toast);
    expect(() => pluginViewConstructor(bundle, { '@motus-ai/seed-sdk': sdk }, entryUrl)).toThrow(
      'Module unavailable in view: @motus-ai/seed-sdk/react',
    );
  });

  it('loads the view without evaluating Node imports, and loads the service separately through the supplied SDK', async () => {
    const project = await fixture(),
      { output } = await project.build();
    const entryUrl = pathToFileURL(join(output, 'main.js')).href;
    const bundle = pluginBundle(await import(/* @vite-ignore */ entryUrl));
    const modules = { '@motus-ai/seed-sdk': sdk };
    const View = pluginViewConstructor(bundle, modules, entryUrl);
    expect(View.prototype).toBeInstanceOf(sdk.Plugin);
    const requested: string[] = [];
    const require = createRequire(entryUrl);
    const Service = pluginServiceConstructor(
      bundle,
      modules,
      (name) => {
        requested.push(name);
        return require(name);
      },
      entryUrl,
    );
    expect(requested).toEqual(['node:os']);
    const manifest = JSON.parse(await readFile(join(output, 'manifest.json'), 'utf8'));
    const service = new Service({} as sdk.PluginServices, manifest);
    await service.load();
    expect(await service.call('status', {})).toBe(process.platform);
    await service.unload();
    await expect(service.call('status', {})).rejects.toThrow('not running');
    expect(await readFile(join(output, 'main.js'), 'utf8')).not.toContain('export function apply');
  });

  it('builds an explicit view entry and exposes only the current factory name', async () => {
    const project = await fixture();
    await writeFile(
      join(project.root, 'src/custom-view.ts'),
      `import { Plugin } from '@motus-ai/seed-sdk';
       export default class CustomView extends Plugin { static marker = 'custom-view'; }`,
    );
    const tools = await import(/* @vite-ignore */ pathToFileURL(resolve('packages/seed-plugin-tools/index.mjs')).href);
    const { output } = await tools.buildPlugin({ root: project.root, view: 'src/custom-view.ts' });
    const entryUrl = pathToFileURL(join(output, 'main.js')).href;
    const exports = await import(/* @vite-ignore */ entryUrl);
    expect(exports.loadView).toBeTypeOf('function');
    expect(exports).not.toHaveProperty('loadUI');
    const Constructor = pluginViewConstructor(pluginBundle(exports), { '@motus-ai/seed-sdk': sdk }, entryUrl);
    expect((Constructor as typeof sdk.Plugin & { marker: string }).marker).toBe('custom-view');
  });

  it('rejects Node imports in the view build and preserves the last complete output', async () => {
    const project = await fixture(),
      { output } = await project.build();
    const previous = await readFile(join(output, 'main.js'), 'utf8');
    await writeFile(join(project.root, 'src/main.ts'), "import { readFile } from 'node:fs'; export default readFile");
    await expect(project.build()).rejects.toThrow();
    expect(await readFile(join(output, 'main.js'), 'utf8')).toBe(previous);
  });

  it('generates loading metadata from the build target, with no publisher or catalog classification', async () => {
    const project = await fixture();
    const source = JSON.parse(await readFile(join(project.root, 'manifest.json'), 'utf8'));
    expect(source).not.toHaveProperty('seed');
    const { manifest } = await project.build();
    expect(manifest).toMatchObject({ apiVersion: 2, runtime: 'native-host', service: true });
    for (const field of ['seed', 'publisherId', 'labels', 'permissions']) expect(manifest).not.toHaveProperty(field);
    for (const field of ['seed', 'apiVersion', 'runtime', 'publisherId', 'labels']) {
      await writeFile(
        join(project.root, 'manifest.json'),
        JSON.stringify({ ...source, [field]: field === 'apiVersion' ? 2 : field === 'seed' ? {} : 'unused' }),
      );
      await expect(project.build()).rejects.toThrow(`Source manifest must not declare ${field}`);
    }
  });

  it('generates a hash-covered static index from the same capability source, without adding declarations to the author manifest', async () => {
    const project = await fixture();
    const capabilities = [
      { id: 'probe', version: 1, methods: [{ name: 'read', risk: 'read', inputSchema: { type: 'object' } }] },
    ];
    await writeFile(
      join(project.root, 'src/capabilities.ts'),
      'export const capabilities = ' + JSON.stringify(capabilities),
    );
    await writeFile(join(project.root, 'package.json'), JSON.stringify({ keywords: ['utilities'] }));
    const { output, manifest } = await project.build();
    const index = await readFile(join(output, 'metadata.json'));
    expect(JSON.parse(index.toString())).toEqual({
      apiVersion: 2,
      labels: ['utilities'],
      capabilities: [
        { id: 'probe', version: 1, methods: [{ name: 'read', risk: 'read', input_schema: { type: 'object' } }] },
      ],
    });
    expect(manifest.resources).toContainEqual({
      path: 'metadata.json',
      sha256: createHash('sha256').update(index).digest('hex'),
    });
    expect(manifest).not.toHaveProperty('capabilities');
    const previous = await readFile(join(output, 'main.js'));
    await writeFile(join(project.root, 'src/capabilities.ts'), 'export const capabilities = null');
    await expect(project.build()).rejects.toThrow('Invalid capability metadata');
    expect(await readFile(join(output, 'main.js'))).toEqual(previous);
    expect(await readFile(join(output, 'metadata.json'))).toEqual(index);
  });

  it('supports custom capability source paths, and does not advertise service capabilities on a view-only plugin', async () => {
    const project = await fixture();
    const tools = await import(/* @vite-ignore */ pathToFileURL(resolve('packages/seed-plugin-tools/index.mjs')).href);
    await writeFile(
      join(project.root, 'src/metadata.ts'),
      'export const capabilities = [{ id: "probe", version: 1, methods: [] }]',
    );
    const options = { root: project.root, capabilities: 'src/metadata.ts' };
    await expect(tools.buildPlugin(options)).rejects.toThrow('require a service');
    const { output } = await tools.buildPlugin({ ...options, runtime: 'native-host', service: 'src/service.ts' });
    expect(JSON.parse(await readFile(join(output, 'metadata.json'), 'utf8')).capabilities[0].id).toBe('probe');
    await expect(tools.buildPlugin({ ...options, capabilities: 'src/missing.ts' })).rejects.toThrow();
  });

  it('defaults to a Node-free service target and does not allow an esbuild override to bypass it', async () => {
    const project = await fixture();
    const tools = await import(/* @vite-ignore */ pathToFileURL(resolve('packages/seed-plugin-tools/index.mjs')).href);
    await expect(
      tools.buildPlugin({ root: project.root, service: 'src/service.ts', serviceOptions: { platform: 'node' } }),
    ).rejects.toThrow();
    await expect(tools.buildPlugin({ root: project.root, runtime: 'unrestricted' })).rejects.toThrow(
      'Invalid plugin build runtime',
    );
    await expect(tools.buildPlugin({ root: project.root, runtime: 'native-host' })).rejects.toThrow(
      'requires a service entry',
    );
    await writeFile(
      join(project.root, 'src/service.ts'),
      "import { PluginService } from '@motus-ai/seed-sdk'; export default class Service extends PluginService {}",
    );
    const { manifest } = await tools.buildPlugin({ root: project.root, service: 'src/service.ts' });
    expect(manifest).toMatchObject({ apiVersion: 2, runtime: 'sandboxed-web', service: true });
  });

  it('rejects old or malformed entry exports instead of silently falling back', () => {
    expect(() => pluginBundle({ apply: vi.fn() })).toThrow('Invalid Seed plugin bundle');
    expect(() =>
      pluginViewConstructor({ seedPluginBundleVersion: 2, loadView: () => class {} as any }, {}, ''),
    ).toThrow('Plugin subclass');
  });

  it('packs one independent build as a plain seedpkg archive with verified resources', async () => {
    const project = await fixture(),
      { output } = await project.build();
    const tools = await import(/* @vite-ignore */ pathToFileURL(resolve('packages/seed-plugin-tools/index.mjs')).href);
    const packed = await tools.packPlugin({ root: project.root });
    const verified = await verifySeedPackage(await readFile(packed.packagePath), {
      expectedPackageSha256: packed.sha256,
    });
    expect(verified.manifest.id).toBe('com.example.generic');
    expect([...verified.files.keys()].filter((path) => path.endsWith('.js'))).toEqual(['main.js']);
    expect([...verified.files.keys()]).not.toContain('META-INF/files.sha256');
    await writeFile(join(output, 'main.js'), 'tampered output');
    await expect(tools.packPlugin({ root: project.root })).rejects.toThrow('Built resource changed');
  });

  it('normalizes author text resources without modifying binary resources', async () => {
    const project = await fixture();
    const sourceManifest = JSON.parse(await readFile(join(project.root, 'manifest.json'), 'utf8'));
    await writeFile(
      join(project.root, 'manifest.json'),
      JSON.stringify({
        ...sourceManifest,
        i18n: {
          defaultLocale: 'en-US',
          resources: { 'en-US': 'locales/en-US.json' },
        },
      }),
    );
    await mkdir(join(project.root, 'locales'));
    await writeFile(join(project.root, 'locales/en-US.json'), '{\r\n  "plugin.name": "Example"\r\n}\r\n');
    await writeFile(join(project.root, 'README.md'), '# Example\r\n\r\nText\r\n');
    await writeFile(join(project.root, 'assets.svg'), '<svg>\r\n</svg>\r\n');
    const binary = Buffer.from([0, 13, 10, 255]);
    await writeFile(join(project.root, 'asset.bin'), binary);
    const tools = await import(/* @vite-ignore */ pathToFileURL(resolve('packages/seed-plugin-tools/index.mjs')).href);
    const { output, manifest } = await tools.buildPlugin({
      root: project.root,
      runtime: 'native-host',
      service: 'src/service.ts',
      resources: [
        { source: 'README.md', path: 'README.md' },
        { source: 'assets.svg', path: 'assets/icon.svg' },
        { source: 'asset.bin', path: 'assets/asset.bin' },
      ],
    });
    for (const path of ['locales/en-US.json', 'README.md', 'assets/icon.svg']) {
      const body = await readFile(join(output, path));
      expect(body.includes(13)).toBe(false);
      expect(manifest.resources.find((resource: { path: string }) => resource.path === path)?.sha256).toBe(
        createHash('sha256').update(body).digest('hex'),
      );
    }
    expect(await readFile(join(output, 'assets/asset.bin'))).toEqual(binary);
  });

  it('uses the same generic packer for native target resources without changing the loading contract', async () => {
    const project = await fixture(),
      { manifest } = await project.build();
    const tools = await import(/* @vite-ignore */ pathToFileURL(resolve('packages/seed-plugin-tools/index.mjs')).href);
    const source = join(project.root, 'native-helper');
    await writeFile(source, 'native fixture');
    const variant = {
      platform: 'darwin',
      architecture: 'arm64',
      manifest: {
        ...manifest,
        permissions: ['process.sidecar'],
        sidecars: [{ id: 'helper', path: 'sidecars/helper', executable: true }],
      },
      files: [{ path: 'sidecars/helper', source }],
    };
    const packed = await tools.packPlugin({ root: project.root, variant });
    expect(packed.packagePath).toMatch(/-darwin-arm64\.seedpkg$/);
    const verified = await verifySeedPackage(await readFile(packed.packagePath), {
      expectedPackageSha256: packed.sha256,
    });
    expect(verified.files.get('sidecars/helper')?.toString()).toBe('native fixture');
    expect(verified.manifest.sidecars).toEqual([{ id: 'helper', path: './sidecars/helper', executable: true }]);
    for (const patch of [
      { id: 'com.other.forged' },
      { version: '9.0.0' },
      { runtime: 'sandboxed-web' },
      { service: false },
    ]) {
      await expect(
        tools.packPlugin({ root: project.root, variant: { ...variant, manifest: { ...variant.manifest, ...patch } } }),
      ).rejects.toThrow('identity or loading contract');
    }
    for (const path of ['../escape', 'main.js', 'C:/unsafe', 'bad\\path', 'CON']) {
      await expect(
        tools.packPlugin({ root: project.root, variant: { ...variant, files: [{ path, source }] } }),
      ).rejects.toThrow('additional resource');
    }
    await expect(tools.packPlugin({ root: project.root, variant: { ...variant, files: [] } })).rejects.toThrow(
      'Sidecar is not a declared resource',
    );
  });
});
