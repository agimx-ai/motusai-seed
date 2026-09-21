import { useTranslation } from 'react-i18next'
import type { SeedSnapshot } from '../../shared/contracts'
import { SeedlingMascot } from '../components/SeedlingMascot'
import { companionPresentation } from '../lib/companion'

export function OverviewPage({ snapshot }: { snapshot: SeedSnapshot }) {
  const { t } = useTranslation()
  const { state, copyKey, count } = companionPresentation(snapshot)
  const statusText = t(`overview.mascot.${copyKey}`, { count })

  return <section className="grid h-full min-h-[360px] place-items-center animate-[rise_.25s_ease_both]">
    <div className="flex flex-col items-center gap-[22px] pb-[8vh] text-center">
      <SeedlingMascot state={state} label={`${t('overview.interact')} · ${statusText}`} />
      <p role="status" aria-live="polite" aria-atomic="true" className="m-0 text-[14px] text-muted-foreground">{statusText}</p>
    </div>
  </section>
}
