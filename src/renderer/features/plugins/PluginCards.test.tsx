// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SeedCatalogPlugin, SeedInstalledPlugin } from '../../../shared/contracts';
import { SeedI18nProvider } from '../../i18n';
import { CatalogPluginCard } from './PluginCards';

beforeEach(() => {
  vi.stubGlobal('motusSeed', {
    snapshot: async () => ({ locale: 'zh-CN', languagePreference: 'zh-CN' }),
    subscribe: () => () => {},
  });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const catalog: SeedCatalogPlugin = {
  id: 'com.example.migration', visibility: 'public', organization: null,
  name: { en_US: 'Migration fixture', zh_Hans: '迁移测试' },
  description: { en_US: 'Fixture', zh_Hans: '测试' }, labels: [],
  publisher: 'Example', publisherType: 'official', latestVersion: '2.0.0',
  packageSha256: 'a'.repeat(64), packageSize: 100, apiVersion: '2', minSeedVersion: '0.3.0',
  runtimeKind: 'native-host', permissions: [], capabilities: [], compatible: true, publishedAt: '2026-10-20T00:00:00Z',
  versions: [{
    version: '2.0.0', platform: 'darwin', architecture: 'arm64',
    packageSha256: 'a'.repeat(64), packageSize: 100, apiVersion: '2', minSeedVersion: '0.3.0',
    runtimeKind: 'native-host', permissions: [], capabilities: [], publishedAt: '2026-10-20T00:00:00Z',
    downloadUrl: 'https://example.com/migration.seedpkg',
  }],
};
const installed: SeedInstalledPlugin = {
  id: catalog.id, visibility: 'public', name: catalog.name, description: catalog.description, labels: [],
  version: '1.0.0', publisher: 'Example', publisherType: 'official', manifestDigest: '',
  capabilities: [], permissions: [], source: 'installed', status: 'incompatible', enabled: false,
};
function show(plugin = catalog, previous: SeedInstalledPlugin | undefined = installed) {
  const onInstall = vi.fn(), onOpen = vi.fn();
  render(<SeedI18nProvider><CatalogPluginCard plugin={plugin} installedPlugin={previous} appName="Seed"
    installing={false} updatesBusy={false} onInstall={onInstall} onCancelInstall={() => {}} onOpen={onOpen} />
  </SeedI18nProvider>);
  return { onInstall, onOpen };
}

describe('catalog upgrades for incompatible installed plugins', () => {
  it('offers the supported newer release directly from its card', () => {
    const { onInstall, onOpen } = show();
    const update = screen.getByRole('button', { name: '更新' }) as HTMLButtonElement;
    expect(update.disabled).toBe(false);
    fireEvent.click(update);
    expect(onInstall).toHaveBeenCalledTimes(1);
    expect(onOpen).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: '不兼容' })).toBeNull();
  });

  it('keeps an unsupported newer release unavailable', () => {
    show({ ...catalog, compatible: false });
    expect((screen.getByRole('button', { name: '不兼容' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByRole('button', { name: '更新' })).toBeNull();
  });

  it('does not offer a downgrade when the installed version is already newer', () => {
    show(catalog, { ...installed, version: '3.0.0' });
    expect(screen.getByRole('button', { name: '详情' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: '更新' })).toBeNull();
  });
});
