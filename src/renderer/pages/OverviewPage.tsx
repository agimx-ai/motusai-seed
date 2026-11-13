import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { Check, Copy, RotateCcw, Monitor } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { ActionButton } from '@motus-ai/seed-sdk/react'
import type { SeedSnapshot } from '../../shared/contracts'
import { CompanionDiscoveries } from '../components/CompanionDiscoveries'
import { companionPresentation } from '../lib/companion'
import claudeIcon from '@lobehub/icons-static-svg/icons/claudecode-color.svg'
import codexIcon from '@lobehub/icons-static-svg/icons/codex.svg'
import workbuddyIcon from '@lobehub/icons-static-svg/icons/workbuddy-color.svg'
import dshIcon from '@lobehub/icons-static-svg/icons/deepseek-color.svg'
import vscodeIcon from '../assets/vscode.svg'

const emptyDiscoveries: NonNullable<SeedSnapshot['companionDiscoveries']> = []

const iconFiles = import.meta.glob<string>('../../../node_modules/@lobehub/icons-static-svg/icons/*.svg', {
  eager: true, query: '?url&no-inline', import: 'default',
})
const libraryIcons = new Map(Object.entries(iconFiles).map(([path, url]) => [path.split('/').pop()!.slice(0, -4), url]))
libraryIcons.set('vscode', vscodeIcon)

type ClientMark = {
  id: string
  name: string
  icon?: string
  iconSize: string
  gradient?: string
}

const bundledClients: (ClientMark & { iconId: string })[] = [
  // Match the visible marks rather than their SVG canvas dimensions.
  { id: 'claude-code', iconId: 'claudecode-color', name: 'Claude Code', icon: claudeIcon, iconSize: 'size-5.5' },
  { id: 'codex', iconId: 'codex', name: 'Codex', icon: codexIcon, iconSize: 'size-5', gradient: 'linear-gradient(#B1A7FF, #7A9DFF 50%, #3941FF)' },
  { id: 'deepseek', iconId: 'deepseek-color', name: 'DeepSeek Harness (DSH)', icon: dshIcon, iconSize: 'size-5.5' },
  { id: 'workbuddy', iconId: 'workbuddy-color', name: 'WorkBuddy', icon: workbuddyIcon, iconSize: 'size-4.5' },
  { id: 'vscode', iconId: 'vscode', name: 'VS Code', icon: vscodeIcon, iconSize: 'size-5' },
]

function ClientIcon({ client, name }: { client: ClientMark; name: string }) {
  const [failed, setFailed] = useState(false)
  if (!client.icon || failed) return <Monitor className={client.iconSize} aria-label={name} role="img" />
  return <img src={client.icon} alt={name} className={`${client.iconSize} object-contain`} onError={() => setFailed(true)} />
}

export function OverviewPage({ snapshot }: { snapshot: SeedSnapshot }) {
  const { t } = useTranslation()
  const clients = snapshot.mcpClients?.map<ClientMark>((entry) => {
    if (typeof entry === 'string') {
      return bundledClients.find(({ id }) => id === entry) ?? { id: entry, name: entry, icon: '', iconSize: 'size-5' }
    }
    const bundled = bundledClients.find(({ id, iconId }) => id === entry.id && iconId === entry.icon_id)
    const name = entry.id === 'vscode' && entry.name === 'VS Code' ? t('overview.mcp.vscode') : entry.name
    return bundled
      ? { ...bundled, name }
      : { id: entry.id, name, icon: libraryIcons.get(entry.icon_id) ?? entry.uploadedIconUrl, iconSize: 'size-5' }
  }) ?? bundledClients
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

  return <section className="seed-overview flex min-h-full flex-col items-center justify-center gap-6 text-center seed-full-motion:animate-[rise_.25s_ease_both]">
    <div className="flex flex-col items-center">
      <CompanionDiscoveries state={state} label={`${t('overview.interact')} · ${statusText}`} items={snapshot.companionDiscoveries ?? emptyDiscoveries} />
      <p role="status" aria-live="polite" aria-atomic="true" className="sr-only">{statusText}</p>
    </div>
    <div className="seed-mcp-connect flex w-full max-w-104 flex-col items-center gap-6">
      <div className="relative grid w-full grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2 rounded-full border border-[color-mix(in_srgb,var(--border)_75%,var(--input))] bg-card p-1.5">
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
        {clients.map((client, index) => <li key={client.id} title={client.name} className="seed-mcp-client"
          style={{ '--seed-client-delay': `${Math.floor(Math.abs(index - (clients.length - 1) / 2)) * 110}ms` } as CSSProperties}>
          <span className="seed-mcp-client-mark grid size-9 place-items-center rounded-full border border-plugin-icon-border bg-card">
            <span className="seed-mcp-client-icon grid size-7 place-items-center">
              {client.gradient
                ? <span role="img" aria-label={client.name} className={client.iconSize} style={{
                  backgroundImage: client.gradient,
                  maskImage: `url("${client.icon}")`,
                  maskPosition: 'center',
                  maskRepeat: 'no-repeat',
                  maskSize: 'contain',
                }} />
                : <ClientIcon key={client.icon} client={client} name={client.name === 'VS Code' ? t('overview.mcp.vscode') : client.name} />}
            </span>
          </span>
        </li>)}
      </ul>
    </div>
  </section>
}
