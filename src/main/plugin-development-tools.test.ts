import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { inspectPluginDirectory } from './plugin-directory';
import { verifySeedPackage } from './seed-package';

const roots: string[] = [],
  watchers: Array<{ stop(): Promise<void> }> = [];
afterEach(async () => {
  await Promise.all(watchers.splice(0).map((watcher) => watcher.stop()));
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
const toolsPath = resolve('packages/seed-plugin-tools/index.mjs');
const tools = await import(/* @vite-ignore */ pathToFileURL(toolsPath).href);
const development = await import(
  /* @vite-ignore */ pathToFileURL(resolve('packages/seed-plugin-tools/development.mjs')).href
);
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'seed-development-tools-'));
  roots.push(root);
  const project = join(root, 'project'),
    directory = join(root, 'plugins/development');
  await cp(resolve('packages/seed-plugin-tools/fixtures/generic'), project, { recursive: true });
  await writeFile(
    join(project, 'build.mjs'),
    `import { buildPlugin } from ${JSON.stringify(pathToFileURL(toolsPath).href)}; await buildPlugin({ root: import.meta.dirname, runtime: 'native-host', service: 'src/service.ts' });`,
  );
  return { root, project, directory };
}
describe('independent plugin development tools', () => {
  it('builds plugin-only utilities, theme variants and custom CSS without scanning the desktop shell', async () => {
    const h = await fixture();
    const source = join(h.project, 'src/main.ts');
    await writeFile(
      source,
      (await readFile(source, 'utf8')).replace(
        "canvas.setAttribute('aria-label', 'Plugin-owned custom control');",
        "canvas.className = 'w-[137px] dark:opacity-35 max-[440px]:hidden';",
      ),
    );
    await writeFile(
      join(h.project, 'styles.css'),
      '@source inline("h-[139px]"); .custom-control { color: rebeccapurple; }',
    );
    const first = await tools.buildPlugin({ root: h.project, styles: 'styles.css' });
    const css = await readFile(join(h.project, 'dist/styles.css'), 'utf8');
    expect(css).toContain('137px');
    expect(css).toContain('139px');
    expect(css).toContain('data-theme');
    expect(css).toContain('440px');
    const manifest = JSON.parse(await readFile(join(h.project, 'manifest.json'), 'utf8'));
    expect(css).toContain(
      `@scope ([data-plugin-view-owner="${manifest.id}"], [data-plugin-view-portal="${manifest.id}"])`,
    );
    expect(css).toContain('rebeccapurple');
    expect(css).not.toContain('seed-sidebar');
    expect(css).not.toMatch(/@(?:import|source|theme)\b/);
    await writeFile(source, (await readFile(source, 'utf8')).replace('137px', '141px'));
    const next = await tools.buildPlugin({ root: h.project, styles: 'styles.css' });
    expect(next.manifest.version).toBe(first.manifest.version);
    expect(next.manifest.resources.find((item: { path: string }) => item.path === 'styles.css').sha256).not.toBe(
      first.manifest.resources.find((item: { path: string }) => item.path === 'styles.css').sha256,
    );
  });
  it('deploys exactly the validated package files, without requiring an upload or changing a version', async () => {
    const h = await fixture();
    await tools.buildPlugin({ root: h.project, runtime: 'native-host', service: 'src/service.ts' });
    const deployed = await development.publishDevelopmentPlugin({ root: h.project, directory: h.directory });
    const inspected = await inspectPluginDirectory(deployed.directory);
    const packed = await tools.packPlugin({ root: h.project });
    const verified = await verifySeedPackage(await readFile(packed.packagePath), {
      expectedPackageSha256: packed.sha256,
    });
    expect(inspected.files).toEqual(verified.files);
    expect(inspected.manifest.version).toBe('1.0.0');
    await writeFile(join(h.project, 'dist/main.js'), 'changed after build');
    await expect(development.publishDevelopmentPlugin({ root: h.project, directory: h.directory })).rejects.toThrow(
      'changed',
    );
    expect((await inspectPluginDirectory(deployed.directory)).manifestDigest).toBe(inspected.manifestDigest);
  });
  it('reuses the native packaging hook and includes its current-platform resources', async () => {
    const h = await fixture();
    await tools.buildPlugin({ root: h.project, runtime: 'native-host', service: 'src/service.ts' });
    await writeFile(join(h.project, 'tool.bin'), 'native fixture');
    await writeFile(
      join(h.project, 'package.mjs'),
      `export default ({ manifest }) => [{ platform: process.platform, architecture: process.arch, files: [{ source: 'tool.bin', path: 'sidecars/tool' }], manifest: { ...manifest, permissions: ['process.sidecar'], sidecars: [{ id: 'tool', path: 'sidecars/tool', executable: true }] } }];`,
    );
    const deployed = await development.publishDevelopmentPlugin({ root: h.project, directory: h.directory });
    const inspected = await inspectPluginDirectory(deployed.directory);
    expect(inspected.manifest.sidecars).toEqual([{ id: 'tool', path: './sidecars/tool', executable: true }]);
    expect(inspected.files.get('sidecars/tool')?.toString()).toBe('native fixture');
  });
  it('continuously compiles and deploys successful edits while leaving the last good build after an error', async () => {
    const h = await fixture(),
      log = vi.fn();
    const watcher = await development.developPlugin({ root: h.project, directory: h.directory, log });
    watchers.push(watcher);
    expect(log.mock.calls.some(([message]) => String(message).startsWith('Synced development plugin:'))).toBe(true);
    expect(log).toHaveBeenCalledWith('Watching source changes. Press Ctrl+C to stop. Seed loads the synced directory.');
    const source = join(h.project, 'src/service.ts');
    const deployed = join(h.directory, 'com.example.generic');
    const first = await inspectPluginDirectory(deployed);
    await writeFile(
      source,
      "import { PluginService } from '@motus-ai/seed-sdk'; export default class extends PluginService { onload() { this.registerMethod('value', () => 'changed'); } }",
    );
    await vi.waitFor(
      async () => expect((await inspectPluginDirectory(deployed)).manifestDigest).not.toBe(first.manifestDigest),
      { timeout: 8000 },
    );
    const current = await inspectPluginDirectory(deployed);
    await writeFile(source, 'this is invalid TypeScript {');
    await watcher.rebuild();
    expect((await inspectPluginDirectory(deployed)).manifestDigest).toBe(current.manifestDigest);
    expect(log.mock.calls.some(([message]) => String(message).includes('build failed'))).toBe(true);
  }, 15_000);
  it('uses the standard app-data folder on each desktop platform', () => {
    expect(development.developmentPluginDirectory('darwin', {}, '/home/person')).toBe(
      join('/home/person', 'Library/Application Support/MotusAI Seed/plugins/development'),
    );
    expect(development.developmentPluginDirectory('linux', { XDG_CONFIG_HOME: '/custom' }, '/home/person')).toBe(
      join('/custom', 'MotusAI Seed/plugins/development'),
    );
    expect(development.developmentPluginDirectory('win32', { APPDATA: '/roaming' }, '/home/person')).toBe(
      join('/roaming', 'MotusAI Seed/plugins/development'),
    );
  });
});
