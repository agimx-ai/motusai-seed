import { readFileSync } from 'node:fs'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { AppLogo } from './AppBrand'

describe('AppLogo theme scope', () => {
  it('marks system appearance separately from the explicit app theme', () => {
    expect(renderToStaticMarkup(<AppLogo appearance="system" />)).toContain('app-logo app-logo--system')
    expect(renderToStaticMarkup(<AppLogo />)).not.toContain('app-logo--system')
  })

  it('excludes system logos from both app-dark overrides, without competing important declarations', () => {
    const css = readFileSync(new URL('../styles.css', import.meta.url), 'utf8')
    const logoRules = css.slice(css.indexOf('.app-logo {'), css.indexOf('@keyframes pulse'))
    expect(logoRules).toContain(':root[data-theme="dark"] .app-logo:not(.app-logo--system) .app-logo__light')
    expect(logoRules).toContain(':root[data-theme="dark"] .app-logo:not(.app-logo--system) .app-logo__dark')
    expect(logoRules).toContain('.app-logo .app-logo__dark {\n  display: none;')
    expect(logoRules).toContain('@media (prefers-color-scheme: dark)')
    expect(logoRules).not.toContain('!important')
  })
})
