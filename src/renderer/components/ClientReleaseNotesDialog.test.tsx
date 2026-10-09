import i18next from 'i18next'
import { renderToStaticMarkup } from 'react-dom/server'
import { I18nextProvider } from 'react-i18next'
import { describe, expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'
import { seedI18nResources } from '../i18n/resources'
import { ClientReleaseNotesDialog } from './ClientReleaseNotesDialog'

vi.mock('./ConfirmDialog', () => ({ ConfirmDialog: (props: { title: string; icon?: ReactNode; confirmLabel: string; children: ReactNode; hideCancel: boolean; role: string; busy: boolean; contentPadding: boolean }) => {
  expect(props.contentPadding).toBe(false)
  return <section role={props.role}>{props.icon}<h2>{props.title}</h2>{props.children}<button disabled={props.busy}>{props.confirmLabel}</button>{!props.hideCancel && <button>cancel</button>}</section>
} }))
vi.mock('../i18n', () => ({ useSeedI18n: () => ({ locale: i18next.language }) }))

describe('ClientReleaseNotesDialog', () => {
  it.each(['zh-CN', 'en-US'])('renders the corresponding complete Markdown with one dismiss action in %s', (locale) => {
    void i18next.init({ resources: seedI18nResources, defaultNS: 'app', lng: locale, initAsync: false })
    const notes = { version: '0.2.7', unread: true, notes: {
      'zh-CN': '# Seed 0.2.7\n\n中文摘要\n\n## 改进\n\n- **插件设置**：集中查看。',
      en: '# Seed 0.2.7\n\nEnglish summary\n\n## Improvements\n\n- **Plugin settings**: One place.',
    } }
    const html = renderToStaticMarkup(<I18nextProvider i18n={i18next}><ClientReleaseNotesDialog notes={notes} appName="MotusAI Seed" busy={false} onClose={() => {}} /></I18nextProvider>)
    expect(html).toContain('role="dialog"')
    expect(html).toContain(locale === 'en-US' ? 'English summary' : '中文摘要')
    expect(html).toContain(locale === 'en-US' ? 'Got it' : '知道了')
    expect(html).not.toContain('<h1')
    expect(html.match(/<button/g)).toHaveLength(1)
    expect(html).toContain('overflow-y-auto')
    expect(html).toContain('class="relative py-3"><div class="max-h-[min(50vh,360px)] overflow-y-auto')
    expect(html).toContain('class="px-3.5"')
    expect(html).toContain('leading-[22px] text-foreground')
    expect(html).toContain('space-y-2.5')
    expect(html).toContain('lucide-sparkles')
    expect(html).toContain('width="20"')
    expect(html).not.toContain('bg-muted')
    expect(html).not.toContain('rounded-')
  })
})
