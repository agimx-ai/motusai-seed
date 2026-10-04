import { createRef, type ComponentProps } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { SeedI18nProvider } from '../i18n'
import { PluginsPage } from './PluginsPage'

const props: ComponentProps<typeof PluginsPage> = {
  appName: 'Seed', plugins: [], catalogPlugins: [], installedLoading: false, catalogLoading: false,
  query: '', searchRef: createRef(), busy: '', updateCount: 0, updatesBusy: false, installProgress: {},
  hasMore: false, loadingMore: false, configurationStates: {},
  onUpdateAll() {}, onQueryChange() {}, onLoadMore() {}, onSelectPlugin() {}, onInstall() {}, onCancelInstall() {}, onUninstall() {},
  async onUpdateConfiguration() {}, async onQueryConfigurationOptions() { return [] },
  async onQueryConfigurationProfileStatuses() { return [] }, async onReconnectConfigurationProfile() {},
  async onQueryManagementView() {}, async onInvokeManagementAction() {},
}
function render(overrides: Partial<typeof props> = {}) {
  return renderToStaticMarkup(<SeedI18nProvider><PluginsPage {...props} {...overrides} /></SeedI18nProvider>)
}

describe('Plugin list loading states', () => {
  it('shows animated installed and catalog placeholders instead of an initial empty message', () => {
    const html = render({ installedLoading: true, catalogLoading: true })
    expect(html.match(/role="status"/g)).toHaveLength(2)
    expect(html.match(/aria-busy="true"/g)).toHaveLength(2)
    expect(html).toContain('正在加载已安装插件')
    expect(html).toContain('正在加载可用插件')
    expect(html).toContain('animate-pulse motion-reduce:animate-none')
    expect(html.match(/<article/g)).toHaveLength(6)
    expect(html).toContain('grid-cols-[minmax(0,1fr)_auto]')
    expect(html).not.toContain('没有匹配的插件')
  })

  it('allows installed data to settle independently of the catalog', () => {
    const html = render({ catalogLoading: true })
    expect(html.match(/role="status"/g)).toHaveLength(1)
    expect(html).not.toContain('正在加载已安装插件')
    expect(html).not.toContain('没有匹配的插件')
  })

  it('shows the empty message only once a successful load is complete', () => {
    const html = render()
    expect(html).toContain('没有匹配的插件')
    expect(html).not.toContain('role="status"')
    expect(html).not.toContain('animate-pulse')
  })

  it('shows failures instead of skeletons or a misleading empty message', () => {
    const html = render({ installedError: true, catalogError: 'Network unavailable' })
    expect(html.match(/role="alert"/g)).toHaveLength(2)
    expect(html).toContain('插件加载失败')
    expect(html).toContain('Network unavailable')
    expect(html).not.toContain('没有匹配的插件')
    expect(html).not.toContain('role="status"')
  })

  it('uses a loading state while a search is pending, then allows zero matches', () => {
    expect(render({ query: 'unmatched', catalogLoading: true })).not.toContain('没有匹配的插件')
    expect(render({ query: 'unmatched' })).toContain('没有匹配的插件')
  })

  it('does not duplicate initial skeletons with a pagination spinner', () => {
    const html = render({ catalogLoading: true, loadingMore: true, hasMore: true })
    expect(html).toContain('正在加载可用插件')
    expect(html).not.toContain('正在加载更多')
    expect(html).not.toContain('animate-spin')
  })
})
