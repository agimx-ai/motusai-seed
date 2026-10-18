// @vitest-environment jsdom
import { createRef } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { SeedInstalledPlugin } from '../../shared/contracts';
import { SeedI18nProvider } from '../i18n';
import { PluginsPage } from './PluginsPage';

const state = vi.hoisted(() => ({ mount: vi.fn(), unmount: vi.fn() }));
vi.mock('../features/plugins/plugin-dom-host', () => ({
  mountPluginDom: (_id: string, container: HTMLElement) => {
    state.mount();
    const input = document.createElement('input');
    input.setAttribute('aria-label', 'Plugin draft');
    container.append(input);
    return () => {
      state.unmount();
      input.remove();
    };
  },
}));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

it('keeps the same plugin DOM and unsaved draft when a product confirmation opens and is cancelled', () => {
  vi.stubGlobal('motusSeed', {
    snapshot: async () => ({ locale: 'en-US', languagePreference: 'en-US' }),
    subscribe: () => () => {},
  });
  const plugin: SeedInstalledPlugin = {
    id: 'com.example.generic',
    visibility: 'public',
    name: { en_US: 'Generic', zh_Hans: 'Generic' },
    description: { en_US: 'Fixture', zh_Hans: 'Fixture' },
    labels: [],
    version: '1.0.0',
    publisher: 'Example',
    manifestDigest: 'digest',
    capabilities: [],
    permissions: [],
    source: 'installed',
    publisherType: 'official',
    status: 'ready',
    enabled: true,
  };
  const onUninstall = vi.fn();
  const page = render(
    <SeedI18nProvider>
      <PluginsPage
        appName="Seed"
        plugins={[plugin]}
        catalogPlugins={[]}
        selectedPlugin={plugin}
        installedLoading={false}
        catalogLoading={false}
        query=""
        searchRef={createRef()}
        busy=""
        updateCount={0}
        updatesBusy={false}
        installProgress={{}}
        hasMore={false}
        loadingMore={false}
        onUpdateAll={() => {}}
        onQueryChange={() => {}}
        onLoadMore={() => {}}
        onSelectPlugin={() => {}}
        onInstall={() => {}}
        onCancelInstall={() => {}}
        onUninstall={onUninstall}
      />
    </SeedI18nProvider>,
  );
  const input = screen.getByLabelText('Plugin draft') as HTMLInputElement;
  fireEvent.change(input, { target: { value: 'unsaved draft' } });
  fireEvent.click(screen.getByRole('button', { name: '卸载' }));
  expect(screen.getByRole('alertdialog')).toBeTruthy();
  expect(screen.getByLabelText('Plugin draft')).toBe(input);
  expect(input.value).toBe('unsaved draft');
  expect(state.unmount).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '取消' }));
  expect(screen.queryByRole('alertdialog')).toBeNull();
  expect(screen.getByLabelText('Plugin draft')).toBe(input);
  expect(state.mount).toHaveBeenCalledTimes(1);
  expect(onUninstall).not.toHaveBeenCalled();
  page.unmount();
  expect(state.unmount).toHaveBeenCalledTimes(1);
});
