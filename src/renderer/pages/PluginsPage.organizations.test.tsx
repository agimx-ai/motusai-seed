// @vitest-environment jsdom
import { createRef } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { SeedCatalogPlugin } from '../../shared/contracts';
import { SeedI18nProvider } from '../i18n';
import { PluginsPage } from './PluginsPage';

beforeEach(() => {
  vi.stubGlobal('motusSeed', {
    snapshot: async () => ({ locale: 'zh-CN', languagePreference: 'zh-CN' }),
    subscribe: () => () => {},
  });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function plugin(id: string, organization: SeedCatalogPlugin['organization'] = null): SeedCatalogPlugin {
  return {
    id,
    visibility: organization ? 'organization' : 'public',
    organization,
    name: { en_US: id, zh_Hans: id },
    description: { en_US: 'Fixture', zh_Hans: '测试' },
    publisher: 'Example',
    publisherType: 'official',
    labels: [],
    latestVersion: '1.0.0',
    packageSha256: 'a'.repeat(64),
    packageSize: 1,
    apiVersion: '2',
    minSeedVersion: '0.3.0',
    runtimeKind: 'native-host',
    permissions: [],
    capabilities: [],
    compatible: true,
    publishedAt: '2026-10-27T00:00:00Z',
    versions: [],
  };
}
const w = { id: 'w', name: '药明康德' },
  a = { id: 'a', name: '爱索尔' },
  g = { id: 'g', name: 'AGIMX' };
const catalog = [plugin('Public'), plugin('IQ', w), plugin('EP', a), plugin('AutoHub', g), plugin('Sinno', g)];
function page(
  catalogPlugins = catalog,
  query = '',
  catalogLoading = false,
  catalogOrganizations?: Array<NonNullable<SeedCatalogPlugin['organization']>>,
) {
  return (
    <SeedI18nProvider>
      <PluginsPage
        appName="Seed"
        plugins={[]}
        catalogPlugins={catalogPlugins}
        catalogOrganizations={catalogOrganizations}
        installedLoading={false}
        catalogLoading={catalogLoading}
        query={query}
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
        onUninstall={() => {}}
      />
    </SeedI18nProvider>
  );
}
function expectPlugins(names: string[]) {
  for (const item of catalog) expect(Boolean(screen.queryByText(item.id))).toBe(names.includes(item.id));
}

it('deduplicates organization tabs and shows only the selected organization, public plugins, or all', () => {
  render(page());
  expect(screen.getAllByRole('button', { name: 'AGIMX' })).toHaveLength(1);
  for (const [organization, names] of [
    [w, ['IQ']],
    [a, ['EP']],
    [g, ['AutoHub', 'Sinno']],
  ] as const) {
    fireEvent.click(screen.getByRole('button', { name: organization.name }));
    expect(screen.getByRole('button', { name: organization.name }).getAttribute('aria-pressed')).toBe('true');
    expectPlugins([...names]);
  }
  fireEvent.click(screen.getByRole('button', { name: '通用插件' }));
  expectPlugins(['Public']);
  fireEvent.click(screen.getByRole('button', { name: '全部' }));
  expectPlugins(catalog.map((item) => item.id));
});

it('uses organization IDs even when two organizations have the same name', () => {
  render(page([plugin('IQ', w), plugin('EP', { id: 'other', name: w.name })]));
  const tabs = screen.getAllByRole('button', { name: w.name });
  expect(tabs).toHaveLength(2);
  fireEvent.click(tabs[1]);
  expectPlugins(['EP']);
});

it('keeps search inside the selected organization and preserves selection across catalog reordering', () => {
  const view = render(page());
  fireEvent.click(screen.getByRole('button', { name: 'AGIMX' }));
  view.rerender(page([...catalog].reverse(), 'Sinno'));
  expectPlugins(['Sinno']);
  expect(screen.getByRole('button', { name: 'AGIMX' }).getAttribute('aria-pressed')).toBe('true');
});

it('retains organization tabs and selection when server search only matches another organization', () => {
  const organizations = [w, a, g];
  const view = render(page(catalog, '', false, organizations));
  fireEvent.click(screen.getByRole('button', { name: 'AGIMX' }));
  view.rerender(page([catalog[1]], 'IQ', false, organizations));
  expectPlugins([]);
  expect(screen.getByRole('button', { name: 'AGIMX' }).getAttribute('aria-pressed')).toBe('true');
  fireEvent.click(screen.getByRole('button', { name: '药明康德' }));
  expectPlugins(['IQ']);
});

it('preserves selection during refresh and falls back to all only when the selected organization is removed', () => {
  const view = render(page());
  fireEvent.click(screen.getByRole('button', { name: 'AGIMX' }));
  view.rerender(page([], '', true));
  view.rerender(page());
  expectPlugins(['AutoHub', 'Sinno']);
  view.rerender(page(catalog.filter((item) => item.organization?.id !== g.id)));
  expect(screen.getByRole('button', { name: '全部' }).getAttribute('aria-pressed')).toBe('true');
  expectPlugins(['Public', 'IQ', 'EP']);
});
