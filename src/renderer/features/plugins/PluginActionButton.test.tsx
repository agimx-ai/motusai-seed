import i18next from 'i18next'
import { renderToStaticMarkup } from 'react-dom/server'
import { I18nextProvider } from 'react-i18next'
import type { ComponentProps } from 'react'
import { describe, expect, it } from 'vitest'
import { seedI18nResources, type SeedLocale } from '../../i18n/resources'
import { PluginActionButton } from './PluginActionButton'

function renderAction(props: Omit<ComponentProps<typeof PluginActionButton>, 'onStart'>, locale: SeedLocale = 'zh-CN') {
  const instance = i18next.createInstance()
  void instance.init({ resources: seedI18nResources, defaultNS: 'app', lng: locale, initAsync: false })
  return renderToStaticMarkup(<I18nextProvider i18n={instance}>
    <PluginActionButton {...props} onStart={() => {}} />
  </I18nextProvider>)
}

function renderUpdateAll({ busy = false, disabled = false, locale = 'zh-CN' }: { busy?: boolean; disabled?: boolean; locale?: SeedLocale } = {}) {
  return renderAction({ action: 'updateAll', busy, disabled }, locale)
}

describe('Plugin action geometry', () => {
  it.each(['zh-CN', 'en-US'] as const)('reserves identical localized space for Get, Update, progress and Details in %s', (locale) => {
    const states = [
      renderAction({ action: 'install' }, locale),
      renderAction({ action: 'update' }, locale),
      renderAction({ action: 'install', busy: true }, locale),
      renderAction({ action: 'details' }, locale),
    ]
    const sizingMarkup = states.map((html) => html.slice(0, html.indexOf('<button')))
    expect(new Set(sizingMarkup).size).toBe(1)
    expect(sizingMarkup[0]).toContain('min-w-[64px]')
    expect(sizingMarkup[0]).toContain('aria-hidden="true"')
    expect(states[0]).toContain('width:100%')
    expect(states[1]).toContain('width:100%')
    expect(states[2]).toContain('width:28px')
    expect(states[3]).toContain('width:100%')
  })

  it('centers the indicator without scaling its drawing during width changes', () => {
    const html = renderAction({ action: 'install', busy: true })
    expect(html).toContain('left-1/2')
    expect(html).toContain('-translate-x-1/2')
    expect(html).toContain('transition-[width]')
    expect(html).toContain('motion-reduce:transition-none')
    expect(html).toContain('absolute inset-0 grid place-items-center')
    expect(html).toContain('size-[20px]')
    expect(html).not.toContain('scale(')
    expect(html).not.toContain('scaleX(')
  })

  it('contains its internal z-index so scrolling actions cannot paint above the sticky search bar', () => {
    const html = renderAction({ action: 'updateAll' })
    expect(html.slice(0, html.indexOf('<button'))).toContain('relative isolate inline-grid')
  })
})

describe('Update All capsule', () => {
  it('uses the shared capsule style and localized action label', () => {
    const html = renderUpdateAll()
    expect(html).toContain('aria-label="全部更新"')
    expect(html).toContain('rounded-full')
    expect(html).toContain('h-[28px]')
    expect(html).not.toContain('disabled=""')
    expect(renderUpdateAll({ locale: 'en-US' })).toContain('aria-label="Update All"')
  })

  it('keeps a text capsule during the batch instead of showing a second progress ring', () => {
    const html = renderUpdateAll({ busy: true })
    expect(html).toContain('aria-label="正在更新…"')
    expect(html).toContain('disabled=""')
    expect(html).not.toContain('<canvas')
    expect(renderUpdateAll({ busy: true, locale: 'en-US' })).toContain('aria-label="Updating…"')
  })

  it('supports disabling the action when no updates are available', () => {
    const html = renderUpdateAll({ disabled: true })
    expect(html).toContain('disabled=""')
    expect(html).toContain('text-muted-foreground dark:text-muted-foreground')
  })
})
