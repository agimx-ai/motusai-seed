import { existsSync } from 'node:fs';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ipcChannels } from './contracts';

async function sources(root: string): Promise<string[]> {
  return (
    await Promise.all(
      (await readdir(root, { withFileTypes: true })).map(async (entry) => {
        const path = join(root, entry.name);
        if (entry.isDirectory()) return sources(path);
        return /\.[cm]?[jt]sx?$/.test(path) && !path.includes('.test.') ? [path] : [];
      }),
    )
  ).flat();
}
describe('single plugin framework boundary', () => {
  it('imports shared components directly from the SDK without shell forwarding files', async () => {
    for (const name of ['ActionButton', 'IconButton', 'MarkdownContent', 'SegmentedControl', 'Tooltip', 'Toaster'])
      expect(existsSync(`src/renderer/components/${name}.tsx`), name).toBe(false);
    for (const path of await sources('src/renderer'))
      expect(await readFile(path, 'utf8'), path).not.toMatch(
        /from\s+['"](?:\.\/|(?:\.\.\/)+components\/)(?:ActionButton|IconButton|MarkdownContent|SegmentedControl|Tooltip|Toaster)['"]/,
      );
  });
  it('uses view naming across the SDK, build tool and host, with flat shell components', async () => {
    expect(existsSync('src/renderer/components/ui')).toBe(false);
    expect(ipcChannels.mountPluginView).toBe('seed:plugins:mount-view');
    expect(ipcChannels.unmountPluginView).toBe('seed:plugins:unmount-view');
    for (const path of [
      ...(await sources('src')),
      ...(await sources('packages/seed-sdk/src')),
      'packages/seed-plugin-tools/index.mjs',
    ]) {
      expect(await readFile(path, 'utf8'), path).not.toMatch(
        /\b(?:loadUI|pluginUI\w*|mountPluginUI|unmountPluginUI|UIProvider|UITranslations|uiCode|uiSource|RareUiActivityGrid)\b|seed-plugin-ui|seed-plugin:\/\/ui\/|components\/ui\/|\brole\s*===?\s*['"]ui['"]/,
      );
    }
  });

  it('does not impose a form schema or create an independent plugin rendering surface', async () => {
    for (const path of ['packages/seed-sdk/src/settings.ts', 'src/main/plugin-settings.ts'])
      expect(await readFile(path, 'utf8'), path).not.toMatch(/profiles|default_profile_id|schema_version/);
    expect(existsSync('src/renderer/hosts/plugin-view')).toBe(false);
    expect(existsSync('src/preload/plugin-view.ts')).toBe(false);
    expect(existsSync('src/renderer/features/plugins/plugin-view-frame.ts')).toBe(false);
    for (const path of [
      'src/main/plugin-view-host.ts',
      'src/renderer/features/plugins/PluginViewSurface.tsx',
      'src/renderer/features/plugins/plugin-dom-host.ts',
    ])
      expect(await readFile(path, 'utf8')).not.toMatch(
        /WebContentsView|setBounds|ResizeObserver|reportHeight|deltaY|onViewport|offsetX|offsetY/,
      );
    expect(existsSync('src/main/python-environment-service.ts')).toBe(false);
    expect(existsSync('scripts/prepare-python-runtime.mjs')).toBe(false);
    for (const path of ['src/renderer/styles.css', 'packages/seed-sdk/src/styles.css'])
      expect(await readFile(path, 'utf8')).not.toMatch(/@import[^;]+source\(/);
  });
  it('has no old lifecycle, declarative renderer or management message entry point', async () => {
    for (const path of [
      'src/vendor',
      'src/connector/caps.ts',
      'src/main/plugin-configuration.ts',
      'src/shared/plugin-management-form.ts',
      'src/renderer/features/plugins/PluginConfigurationPanel.tsx',
      'src/renderer/features/plugins/PluginManagementView.tsx',
    ])
      expect(existsSync(path), path).toBe(false);
    for (const key of Object.keys(ipcChannels)) expect(key).not.toMatch(/^plugin(?:Configuration|Management)/);
    for (const path of [...(await sources('src')), ...(await sources('packages/seed-sdk/src'))]) {
      const source = await readFile(path, 'utf8');
      expect(source, path).not.toMatch(
        /CapsRegistry|CapsContext|SeedPluginContext|SeedConfigurationRegistry|SeedManagementRegistry|seedPluginConfigurationSchema|seedPluginManagementViewSchema|seedCapabilityManifestSchema|seedCapabilityMethodSchema|vendor\/cordis|vendor\/cosmokit/,
      );
    }
  });
});
