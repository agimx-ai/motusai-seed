import appLogoDarkUrl from '../../../resources/app/app-dark.svg?url'
import appLogoLightUrl from '../../../resources/app/app-light.svg?url'

export function WindowDragRegion() {
  return <div className="pointer-events-none absolute inset-x-0 top-0 z-50 h-9 [-webkit-app-region:drag]" aria-hidden="true" />
}

export function AppLogo({ appearance = 'app' }: { appearance?: 'app' | 'system' }) {
  return <span className={`app-logo${appearance === 'system' ? ' app-logo--system' : ''}`} aria-hidden="true">
    <img className="app-logo__light" src={appLogoLightUrl} alt="" />
    <img className="app-logo__dark" src={appLogoDarkUrl} alt="" />
  </span>
}
