import { Sparkles } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { ClientReleaseNotes } from '../../shared/contracts'
import { useSeedI18n } from '../i18n'
import { scrollEdges } from '../lib/scroll-edges'
import { ConfirmDialog } from './ConfirmDialog'
import { MarkdownContent } from './MarkdownContent'

export function ClientReleaseNotesDialog({ notes, appName, busy, onClose }: {
  notes: ClientReleaseNotes
  appName: string
  busy: boolean
  onClose: () => void
}) {
  const { t } = useTranslation()
  const { locale } = useSeedI18n()
  const markdown = notes.notes[locale === 'en-US' ? 'en' : 'zh-CN']
  const scrollRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const [edges, setEdges] = useState({ top: false, bottom: false })
  const updateEdges = useCallback(() => {
    if (!scrollRef.current) return
    const next = scrollEdges(scrollRef.current)
    setEdges((previous) => previous.top === next.top && previous.bottom === next.bottom ? previous : next)
  }, [])
  useEffect(() => {
    updateEdges()
    const observer = new ResizeObserver(updateEdges)
    if (scrollRef.current) observer.observe(scrollRef.current)
    if (contentRef.current) observer.observe(contentRef.current)
    return () => observer.disconnect()
  }, [markdown, updateEdges])
  const fadeColor = 'color-mix(in oklab, var(--muted) 65%, var(--card))'
  return <ConfirmDialog
    open role="dialog" size="wide" hideCancel busy={busy} contentPadding={false}
    title={t('releaseNotes.title', { appName, version: notes.version })}
    icon={<Sparkles size={20} strokeWidth={1.8} />}
    confirmLabel={t('releaseNotes.dismiss')} cancelLabel={t('releaseNotes.dismiss')}
    onConfirm={onClose} onCancel={onClose}
  >
    <div className="relative py-3">
      <div ref={scrollRef} onScroll={updateEdges} className="max-h-[min(50vh,360px)] overflow-y-auto overscroll-contain break-words" tabIndex={0} aria-label={t('releaseNotes.label')}>
        <div ref={contentRef} className="px-3.5">
          <MarkdownContent compact>{markdown.replace(/^# [^\n]+\n/, '').trim()}</MarkdownContent>
        </div>
      </div>
      {edges.top && <div aria-hidden="true" className="pointer-events-none absolute left-0 right-3 top-3 h-5" style={{ background: `linear-gradient(to bottom, ${fadeColor}, transparent)` }} />}
      {edges.bottom && <div aria-hidden="true" className="pointer-events-none absolute bottom-3 left-0 right-3 h-5" style={{ background: `linear-gradient(to top, ${fadeColor}, transparent)` }} />}
    </div>
  </ConfirmDialog>
}
