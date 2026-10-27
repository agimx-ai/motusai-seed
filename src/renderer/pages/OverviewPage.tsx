import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { Check, Copy, RotateCcw } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { ActionButton } from '@motus-ai/seed-sdk/react'
import type { SeedSnapshot } from '../../shared/contracts'
import { SeedlingMascot } from '../components/SeedlingMascot'
import { companionPresentation } from '../lib/companion'
import claudeIcon from '../assets/mcp-clients/claude.svg'
import codexIcon from '../assets/mcp-clients/openai.svg'
import workbuddyIcon from '../assets/mcp-clients/workbuddy.svg'
import vscodeIcon from '../assets/mcp-clients/vscode.png'

const clients = [
  { name: 'Claude Code', icon: claudeIcon },
  { name: 'Codex', icon: codexIcon, monochrome: true },
  { name: 'WorkBuddy', icon: workbuddyIcon },
  { name: 'VS Code', icon: vscodeIcon },
]

export function OverviewPage({ snapshot }: { snapshot: SeedSnapshot }) {
  const { t } = useTranslation()
  const { state, copyKey, count } = companionPresentation(snapshot)
  const statusText = t(`overview.mascot.${copyKey}`, { count })
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle')
  const [copying, setCopying] = useState(false)
  const resetTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const active = useRef(true)
  useEffect(() => {
    active.current = true
    return () => {
      active.current = false
      clearTimeout(resetTimer.current)
    }
  }, [])

  const copySetup = async () => {
    setCopying(true)
    clearTimeout(resetTimer.current)
    try {
      await window.motusSeed.copyMcpSetupPrompt()
      if (active.current) setCopyState('copied')
    } catch {
      if (active.current) setCopyState('failed')
    } finally {
      if (active.current) {
        setCopying(false)
        resetTimer.current = setTimeout(() => setCopyState('idle'), 2400)
      }
    }
  }
  const CopyIcon = copyState === 'copied' ? Check : copyState === 'failed' ? RotateCcw : Copy

  return <section className="flex min-h-full flex-col items-center justify-center gap-6 text-center animate-[rise_.25s_ease_both]">
    <div className="flex flex-col items-center">
      <SeedlingMascot state={state} label={`${t('overview.interact')} · ${statusText}`} />
      <p role="status" aria-live="polite" aria-atomic="true" className="sr-only">{statusText}</p>
    </div>
    <div className="seed-mcp-connect flex w-full max-w-104 flex-col items-center gap-6">
      <div className="relative grid w-full grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2 rounded-full border border-border bg-card p-1.5">
        <span className="seed-mcp-border-beam" aria-hidden="true" />
        <p className="col-start-2 m-0 min-w-0 text-center text-[length:var(--text-input-font-size)] text-foreground">{t('overview.mcp.instruction')}</p>
        <ActionButton type="button" tone="primary" onClick={() => void copySetup()} busy={copying}
          className="seed-mcp-copy-button col-start-3 justify-self-end rounded-full text-[length:var(--text-input-font-size)]" icon={<CopyIcon aria-hidden="true" />}>
          <span aria-live="polite" aria-atomic="true">
            {copyState === 'failed' && <span className="sr-only">{t('overview.mcp.copyFailed')} </span>}
            {t(`overview.mcp.${copyState === 'idle' ? 'copy' : copyState === 'failed' ? 'retry' : 'copied'}`)}
          </span>
        </ActionButton>
      </div>
      <ul aria-label={t('overview.mcp.clients')} className="m-0 flex list-none flex-wrap justify-center gap-4 p-0">
        {clients.map((client, index) => <li key={client.name}
          style={{ '--seed-client-delay': `${Math.floor(Math.abs(index - (clients.length - 1) / 2)) * 110}ms` } as CSSProperties}>
          <span className="seed-mcp-client-mark grid size-9 place-items-center rounded-full border border-plugin-icon-border bg-card">
            <span className="seed-mcp-client-icon grid size-5 place-items-center">
              <img src={client.icon} alt={client.name === 'VS Code' ? t('overview.mcp.vscode') : client.name} className={`size-5 object-contain ${client.monochrome ? 'dark:invert' : ''}`} />
            </span>
          </span>
        </li>)}
      </ul>
    </div>
  </section>
}
