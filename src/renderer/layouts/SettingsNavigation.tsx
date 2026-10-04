import { ArrowLeft, Blocks, Settings, UserRound } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { NavItem } from '../components/NavItem'
import type { SettingsView, View } from '../lib/display'

export function SettingsNavigation({ view, onNavigate }: {
  view: SettingsView
  onNavigate: (view: View) => void
}) {
  const { t } = useTranslation()
  return <>
    <div className="mb-4"><NavItem iconSpacing="compact" active={false} icon={<ArrowLeft size={16} strokeWidth={1.8} />} label={t('nav.backToApp')} onClick={() => onNavigate('overview')} /></div>
    <span className="mb-2 px-1 text-[14px] font-medium text-muted-foreground">{t('nav.personal')}</span>
    <nav className="grid gap-px" aria-label={t('nav.personal')}>
      <NavItem size="compact" tone="foreground" iconSpacing="compact" active={view === 'settings'} icon={<Settings size={16} strokeWidth={1.8} />} label={t('nav.general')} onClick={() => onNavigate('settings')} />
      <NavItem size="compact" tone="foreground" iconSpacing="compact" active={view === 'usage'} icon={<UserRound size={16} strokeWidth={1.8} />} label={t('nav.profile')} onClick={() => onNavigate('usage')} />
    </nav>
    <span className="mb-2 mt-5 px-1 text-[14px] font-medium text-muted-foreground">{t('nav.integrations')}</span>
    <nav className="grid gap-px" aria-label={t('nav.integrations')}>
      <NavItem size="compact" tone="foreground" iconSpacing="compact" active={view === 'plugin-settings'} icon={<Blocks size={16} strokeWidth={1.8} />} label={t('nav.plugins')} onClick={() => onNavigate('plugin-settings')} />
    </nav>
  </>
}
