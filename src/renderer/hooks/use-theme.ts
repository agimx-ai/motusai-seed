import { useEffect, useState } from 'react'
import type { SeedThemePreference } from '../../shared/contracts'

export type ThemePreference = SeedThemePreference
export type ResolvedTheme = Exclude<ThemePreference, 'system'>

const THEME_COLORS: Record<ResolvedTheme, string> = {
  light: '#ffffff',
  dark: '#171717',
}

function resolveTheme(preference: ThemePreference): ResolvedTheme {
  if (preference === 'system') {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  }
  return preference
}

function applyResolvedTheme(theme: ResolvedTheme) {
  const root = document.documentElement
  root.dataset.theme = theme
  root.classList.toggle('dark', theme === 'dark')
  root.style.colorScheme = theme
  document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')?.setAttribute('content', THEME_COLORS[theme])
}

export function initializeTheme() {
  applyResolvedTheme(resolveTheme('system'))
}

export function useTheme(preference: ThemePreference) {
  const [resolvedTheme, setResolvedTheme] = useState<ResolvedTheme>(() => resolveTheme(preference))

  useEffect(() => {
    const applyTheme = () => {
      const nextTheme = resolveTheme(preference)
      applyResolvedTheme(nextTheme)
      setResolvedTheme(nextTheme)
    }

    applyTheme()
    if (preference !== 'system') return undefined
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    media.addEventListener('change', applyTheme)
    return () => media.removeEventListener('change', applyTheme)
  }, [preference])

  return { resolvedTheme }
}
