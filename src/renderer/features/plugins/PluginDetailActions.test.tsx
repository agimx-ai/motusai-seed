import i18next from 'i18next'
import type { ComponentProps } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { I18nextProvider } from 'react-i18next'
import { describe, expect, it } from 'vitest'
import { seedI18nResources, type SeedLocale } from '../../i18n/resources'
import { PluginDetailActions } from './PluginDetailActions'
import type { PluginInstallProgress } from '../../../shared/contracts'

function renderActions(overrides: Partial<ComponentProps<typeof PluginDetailActions>> = {}, locale: SeedLocale = 'zh-CN') {
  const instance = i18next.createInstance()
  void instance.init({ resources: seedI18nResources, defaultNS: 'app', lng: locale, initAsync: false })
  return renderToStaticMarkup(<I18nextProvider i18n={instance}><PluginDetailActions
    installed={false} updateAvailable={false} installable installing={false} uninstalling={false} updatesBusy={false}
    onInstall={() => {}} onUpdate={() => {}} onUninstall={() => {}} onCancel={() => {}} {...overrides}
  /></I18nextProvider>)
}

const progress = (phase: PluginInstallProgress['phase']): PluginInstallProgress => ({ operationId: 'test', version: '1', phase, percent: 100, cancelable: phase === 'downloading' })

describe('Plugin detail action lifecycle', () => {
  it.each(['preparing', 'downloading', 'verifying', 'installing', 'activating', 'completed'] as const)('renders one progress control and no uninstall action during %s after the installed snapshot arrives', (phase) => {
    const html = renderActions({ installed: true, updateAvailable: true, progress: progress(phase) })
    expect(html.match(/<button\b/g)).toHaveLength(1)
    expect(html).toContain('<canvas')
    expect(html).not.toContain('aria-label="卸载"')
    expect(html).not.toContain('aria-label="更新"')
  })

  it('also hides uninstall before the first progress event and while only the request remains busy', () => {
    const html = renderActions({ installed: true, updateAvailable: true, installing: true })
    expect(html.match(/<button\b/g)).toHaveLength(1)
    expect(html).toContain('<canvas')
    expect(html).not.toContain('aria-label="卸载"')
  })

  it('replaces completed progress with uninstall only after progress is cleared', () => {
    const completed = renderActions({ installed: true, progress: progress('completed') })
    expect(completed).toContain('<canvas')
    expect(completed).not.toContain('aria-label="卸载"')
    const idle = renderActions({ installed: true })
    expect(idle.match(/<button\b/g)).toHaveLength(1)
    expect(idle).toContain('aria-label="卸载"')
    expect(idle).not.toContain('<canvas')
  })

  it('retains update and uninstall when idle, and restores both after a failed/cancelled update', () => {
    const html = renderActions({ installed: true, updateAvailable: true })
    expect(html.match(/<button\b/g)).toHaveLength(2)
    expect(html).toContain('aria-label="卸载"')
    expect(html).toContain('aria-label="更新"')
    expect(html).not.toContain('<canvas')
  })

  it.each(['zh-CN', 'en-US'] as const)('reserves installation, update and uninstall labels in the same primary slot in %s', (locale) => {
    const stages = [renderActions({}, locale), renderActions({ installed: true, progress: progress('completed') }, locale), renderActions({ installed: true }, locale)]
    const labels = locale === 'zh-CN' ? ['获取', '更新', '卸载'] : ['Get', 'Update', 'Uninstall']
    for (const html of stages) {
      const sizing = html.slice(0, html.indexOf('<button'))
      for (const label of labels) expect(sizing).toContain(label)
    }
  })

  it('disables non-installable or batch-busy idle actions while leaving active cancellation available', () => {
    expect(renderActions({ installable: false })).toContain('disabled=""')
    expect(renderActions({ installed: true, updatesBusy: true })).toContain('disabled=""')
    expect(renderActions({ installed: true, updatesBusy: true, progress: progress('downloading') })).not.toContain('disabled=""')
  })
})
