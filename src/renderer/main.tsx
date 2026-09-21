import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { buildConfig } from '../shared/build-config.generated'
import App from './App'
import { initializeTheme } from './hooks/use-theme'
import { SeedI18nProvider } from './i18n'
import './styles.css'

document.title = buildConfig.appName
window.addEventListener('error', (event) => window.motusWindow.reportDiagnostic({
  event: 'renderer.error', message: event.error instanceof Error ? event.error.message : event.message,
  ...(event.error instanceof Error ? { error_name: event.error.name, error_stack: event.error.stack } : {}),
}))
window.addEventListener('unhandledrejection', (event) => {
  const error = event.reason
  window.motusWindow.reportDiagnostic({ event: 'renderer.unhandled_rejection',
    message: error instanceof Error ? error.message : String(error),
    ...(error instanceof Error ? { error_name: error.name, error_stack: error.stack } : {}),
  })
})
document.documentElement.dataset.platform = window.motusWindow.platform
initializeTheme()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <SeedI18nProvider><App /></SeedI18nProvider>
  </StrictMode>,
)
