import { useTranslation } from 'react-i18next'
import type { AuthStatus } from '../../shared/contracts'
import { AppLogo } from '../components/AppBrand'
import { WindowChrome } from '../components/WindowChrome'

type LoginPageProps = {
  appName: string
  status: AuthStatus
  error?: string
  busy: boolean
  cancelling: boolean
  onSignIn: () => void
  onCancel: () => void
}

export function LoginPage({ appName, status, error, busy, cancelling, onSignIn, onCancel }: LoginPageProps) {
  const { t } = useTranslation()
  return <main className="relative grid h-full place-items-center overflow-hidden bg-[var(--startup-surface)] p-10 text-foreground">
    <WindowChrome />
    {status === 'authorizing' ? <section className="relative -top-4 flex w-[min(440px,100%)] animate-[rise_.25s_ease_both] flex-col items-center text-center">
      <div className="mb-7"><AppLogo appearance="system" /></div>
      <p className="mb-7 text-[13px] text-muted-foreground">{t('signIn.continueInBrowser')}</p>
      <button className="inline-flex min-h-11 w-[min(320px,100%)] items-center justify-center rounded-full border border-border bg-transparent px-5 text-[13px] font-medium text-foreground transition-colors hover:bg-foreground/[0.05] disabled:cursor-wait disabled:opacity-60" disabled={cancelling} onClick={onCancel}>
        {t(cancelling ? 'signIn.cancelling' : 'signIn.cancel')}
      </button>
    </section> : <section className="relative -top-4 flex w-[min(440px,100%)] animate-[rise_.45s_ease_both] flex-col items-center text-center">
      <div className="mb-3"><AppLogo appearance="system" /></div>
      <h1 className="mb-5 mt-2 text-[24px] font-medium tracking-[-.025em]">{t('signIn.title', { appName })}</h1>
      {error ? <p className="mb-5 w-[min(360px,100%)] text-[13px] leading-5 text-danger">{error}</p> : null}
      <button className="inline-flex min-h-11 w-[min(320px,100%)] items-center justify-center rounded-full border-0 bg-accent px-5 text-[13px] font-medium text-accent-foreground transition hover:bg-accent-hover disabled:cursor-wait disabled:opacity-70" disabled={busy} onClick={onSignIn}>
        {t('signIn.browser')}
      </button>
    </section>}
  </main>
}
