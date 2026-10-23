// @vitest-environment jsdom
import { createRef, useState } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SeedCatalogPlugin, SeedInstalledPlugin } from '../../shared/contracts';
import type { PluginHeaderNavigation } from '../features/plugins/plugin-navigation';
import { SeedI18nProvider } from '../i18n';
import { AppHeader } from '../layouts/AppHeader';
import { PluginsPage } from './PluginsPage';

const mount = vi.hoisted(() => vi.fn());
vi.mock('../features/plugins/plugin-dom-host', () => ({ mountPluginDom: mount }));

const metadata = {
  id: 'com.example.generic', visibility: 'public' as const,
  name: { en_US: 'Generic', zh_Hans: 'Generic' },
  description: { en_US: 'Plugin introduction', zh_Hans: '插件介绍' },
  labels: [], publisher: 'Example', publisherType: 'official' as const, capabilities: [], permissions: [],
};
const installed: SeedInstalledPlugin = {
  ...metadata, version: '1.0.0', manifestDigest: 'digest', source: 'installed', status: 'ready', enabled: true,
};
const release = {
  version: '1.0.0', platform: 'darwin' as const, architecture: 'arm64' as const,
  packageSha256: '0'.repeat(64), packageSize: 1, apiVersion: '2' as const, minSeedVersion: '0.3.6',
  runtimeKind: 'native-host' as const, permissions: [], capabilities: [], publishedAt: '2026-10-23',
  downloadUrl: 'https://example.com/plugin.seedpkg', releaseNotes: 'Fixture release notes',
};
const catalog: SeedCatalogPlugin = {
  ...metadata, ...release, organization: null, latestVersion: release.version, compatible: true, versions: [release],
};

afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.clearAllMocks(); });

function fixture(selectedPlugin: SeedInstalledPlugin | SeedCatalogPlugin = installed, ownerId = installed.id) {
  vi.stubGlobal('motusSeed', {
    snapshot: async () => ({ locale: 'zh-CN', languagePreference: 'zh-CN' }), subscribe: () => () => {},
  });
  vi.stubGlobal('motusWindow', { platform: 'darwin' });
  const path = [{ id: 'parent', label: 'Parent' }, { id: 'child', label: 'Child' }];
  const contribution = (update: (state: PluginHeaderNavigation | undefined) => void, length = path.length): PluginHeaderNavigation => ({
    pluginId: ownerId, path: path.slice(0, length), busy: false,
    navigate: async (id) => { update(contribution(update, id === null ? 0 : path.findIndex(item => item.id === id) + 1)); return true; },
  });
  mount.mockImplementation((_id, container, _error, loading, update) => {
    const input = document.createElement('input');
    input.setAttribute('aria-label', 'Plugin draft');
    const open = document.createElement('button');
    open.textContent = 'Open child';
    open.onclick = () => update(contribution(update));
    const clear = document.createElement('button');
    clear.textContent = 'Release navigation';
    clear.onclick = () => update(undefined);
    container.append(input, open, clear);
    loading(false);
    return () => container.replaceChildren();
  });
  function Host() {
    const [navigation, setNavigation] = useState<PluginHeaderNavigation | undefined>(
      'source' in selectedPlugin && selectedPlugin.status === 'ready' ? undefined : contribution(() => {}),
    );
    return <SeedI18nProvider>
      <AppHeader sidebarCollapsed={false} view="plugins" selectedPlugin={selectedPlugin} pluginNavigation={navigation}
        refreshing={false} onBackToPlugins={() => {}} onRefreshPlugins={() => {}} onEditProfile={() => {}} onAddCredits={() => {}} />
      <PluginsPage appName="Seed" plugins={'source' in selectedPlugin ? [selectedPlugin] : []} catalogPlugins={[catalog]}
        selectedPlugin={selectedPlugin} pluginNavigation={navigation} onNavigationChange={setNavigation}
        installedLoading={false} catalogLoading={false} query="" searchRef={createRef()} busy="" updateCount={0}
        updatesBusy={false} installProgress={{}} hasMore={false} loadingMore={false} onUpdateAll={() => {}}
        onQueryChange={() => {}} onLoadMore={() => {}} onSelectPlugin={() => {}} onInstall={() => {}}
        onCancelInstall={() => {}} onUninstall={() => {}} />
    </SeedI18nProvider>;
  }
  return render(<Host />);
}

describe('plugin information follows SDK navigation', () => {
  it('collapses information on every child level and restores the same root controls without remounting the plugin', () => {
    fixture();
    const title = screen.getByRole('heading', { name: 'Generic' });
    const uninstall = screen.getByRole('button', { name: '卸载' });
    const draft = screen.getByRole('textbox', { name: 'Plugin draft' }) as HTMLInputElement;
    fireEvent.change(draft, { target: { value: 'Unsaved content' } });
    expect(screen.getByRole('heading', { name: '更新说明' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Open child' }));
    expect(screen.queryByRole('heading', { name: 'Generic' })).toBeNull();
    expect(screen.queryByRole('heading', { name: '更新说明' })).toBeNull();
    expect(screen.queryByRole('button', { name: '卸载' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Parent' }));
    expect(screen.queryByRole('heading', { name: 'Generic' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Generic' }));
    expect(screen.getByRole('heading', { name: 'Generic' })).toBe(title);
    expect(screen.getByRole('button', { name: '卸载' })).toBe(uninstall);
    expect(screen.getByRole('heading', { name: '更新说明' })).toBeTruthy();
    expect(screen.getByRole('textbox', { name: 'Plugin draft' })).toBe(draft);
    expect(draft.value).toBe('Unsaved content');
    expect(mount).toHaveBeenCalledTimes(1);
  });

  it('restores information when a navigation contribution is released', () => {
    fixture();
    fireEvent.click(screen.getByRole('button', { name: 'Open child' }));
    expect(screen.queryByRole('heading', { name: 'Generic' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Release navigation' }));
    expect(screen.getByRole('heading', { name: 'Generic' })).toBeTruthy();
    expect(mount).toHaveBeenCalledTimes(1);
  });

  it('ignores a navigation contribution belonging to another plugin', () => {
    fixture(installed, 'com.example.other');
    fireEvent.click(screen.getByRole('button', { name: 'Open child' }));
    expect(screen.getByRole('heading', { name: 'Generic' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '卸载' })).toBeTruthy();
  });

  it.each([catalog, { ...installed, status: 'incompatible' as const }])('keeps catalog and incompatible plugin information visible', plugin => {
    fixture(plugin);
    expect(screen.getByRole('heading', { name: 'Generic' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: '更新说明' })).toBeTruthy();
    expect(mount).not.toHaveBeenCalled();
  });
});
