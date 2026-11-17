import { createRef, type ComponentProps } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { SeedI18nProvider } from '../i18n';
import { PluginsPage } from './PluginsPage';

const props: ComponentProps<typeof PluginsPage> = {
  appName: 'Seed',
  plugins: [],
  catalogPlugins: [],
  installedLoading: false,
  catalogLoading: false,
  query: '',
  searchRef: createRef(),
  busy: '',
  updateCount: 0,
  obsidian: { busy: false, checking: true, status: null, result: null, updateAvailable: false, async runAction() {} },
  updatesBusy: false,
  installProgress: {},
  hasMore: false,
  loadingMore: false,
  onUpdateAll() {},
  onQueryChange() {},
  onLoadMore() {},
  onSelectPlugin() {},
  onInstall() {},
  onCancelInstall() {},
  onUninstall() {},
};
function render(overrides: Partial<typeof props> = {}) {
  return renderToStaticMarkup(
    <SeedI18nProvider>
      <PluginsPage {...props} {...overrides} />
    </SeedI18nProvider>,
  );
}

describe('Plugin list loading states', () => {
  it('keeps Obsidian installation available without Seed plugins or catalog matches', () => {
    const html = render({ query: 'unmatched' });
    expect(html).toContain('>应用集成</h3>');
    expect(html).toContain('MotusAI for Obsidian');
    expect(html).toContain('检查中…');
    expect(html).toContain('没有匹配的插件');
  });

  it('keeps the Obsidian vault summary and errors without activation hints', () => {
    const html = render({
      obsidian: {
        ...props.obsidian,
        checking: false,
        status: { state: 'current', installedVersions: ['0.1.86'] },
        result: {
          ok: true,
          vaults: [
            { path: '/new', name: 'New vault', status: 'installed', version: '0.1.86' },
            { path: '/updated', name: 'Updated vault', status: 'updated', version: '0.1.86' },
            { path: '/failed', name: 'Failed vault', status: 'failed', error: 'installFailed' },
          ],
        },
      },
    });
    expect(html).toContain('v0.1.86');
    expect(html).toContain('将应用到所有已登记的 Obsidian 仓库');
    expect(html).toContain('写入失败，请检查仓库权限后重试。');
    expect(html).not.toContain('部分仓库需要');
  });

  it('shows animated installed and catalog placeholders instead of an initial empty message', () => {
    const html = render({ installedLoading: true, catalogLoading: true });
    expect(html.match(/role="status"/g)).toHaveLength(2);
    expect(html.match(/aria-busy="true"/g)).toHaveLength(2);
    expect(html).toContain('正在加载已安装插件');
    expect(html).toContain('正在加载可用插件');
    expect(html).toContain('animate-pulse seed-reduced-motion:animate-none');
    expect(html.match(/<article/g)).toHaveLength(6);
    expect(html).toContain('grid-cols-[minmax(0,1fr)_auto]');
    expect(html).not.toContain('没有匹配的插件');
    expect(html).not.toContain('暂无可用插件');
  });

  it('allows installed data to settle independently of the catalog', () => {
    const html = render({ catalogLoading: true });
    expect(html.match(/role="status"/g)).toHaveLength(1);
    expect(html).not.toContain('正在加载已安装插件');
    expect(html).not.toContain('没有匹配的插件');
  });

  it('shows an empty catalog when there are no search terms', () => {
    const html = render({ query: '  ' });
    expect(html).toContain('暂无可用插件');
    expect(html).not.toContain('没有匹配的插件');
    expect(html).not.toContain('role="status"');
    expect(html).not.toContain('animate-pulse');
  });

  it('shows failures instead of skeletons or a misleading empty message', () => {
    const html = render({ installedError: true, catalogError: 'Network unavailable' });
    expect(html.match(/role="alert"/g)).toHaveLength(2);
    expect(html).toContain('插件加载失败');
    expect(html).toContain('Network unavailable');
    expect(html).not.toContain('没有匹配的插件');
    expect(html).not.toContain('暂无可用插件');
    expect(html).not.toContain('role="status"');
  });

  it('uses a loading state while a search is pending, then allows zero matches', () => {
    expect(render({ query: 'unmatched', catalogLoading: true })).not.toContain('没有匹配的插件');
    const html = render({ query: 'unmatched' });
    expect(html).toContain('没有匹配的插件');
    expect(html).not.toContain('暂无可用插件');
  });

  it('waits for remaining pages before showing no matches', () => {
    const html = render({ query: 'unmatched', hasMore: true });
    expect(html).toContain('正在加载可用插件');
    expect(html).not.toContain('没有匹配的插件');
  });

  it('does not duplicate initial skeletons with a pagination spinner', () => {
    const html = render({ catalogLoading: true, loadingMore: true, hasMore: true });
    expect(html).toContain('正在加载可用插件');
    expect(html).not.toContain('正在加载更多');
    expect(html).not.toContain('animate-spin');
  });
});
