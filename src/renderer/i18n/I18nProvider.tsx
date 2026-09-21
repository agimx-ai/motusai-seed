import i18next from 'i18next'
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { I18nextProvider } from 'react-i18next'
import { defaultSeedLocale, seedI18nResources, type SeedLanguagePreference, type SeedLocale } from './resources'

type SeedI18nContextValue = {
  languagePreference: SeedLanguagePreference
  locale: SeedLocale
  setLanguagePreference: (preference: SeedLanguagePreference) => void
}

const SeedI18nContext = createContext<SeedI18nContextValue | null>(null)

export function SeedI18nProvider({ children }: { children: ReactNode }) {
  const [languagePreference, setPreference] = useState<SeedLanguagePreference>('system')
  const [locale, setLocale] = useState<SeedLocale>(defaultSeedLocale)
  const instance = useMemo(() => {
    const next = i18next.createInstance()
    void next.init({
      defaultNS: 'app',
      fallbackLng: defaultSeedLocale,
      initAsync: false,
      interpolation: { escapeValue: false },
      lng: locale,
      resources: seedI18nResources,
      returnNull: false,
    })
    return next
  }, [])

  useEffect(() => {
    void instance.changeLanguage(locale)
    document.documentElement.lang = locale
  }, [instance, locale])

  useEffect(() => {
    let active = true
    const applySnapshot = (snapshot: { languagePreference: SeedLanguagePreference; locale: SeedLocale }) => {
      if (!active) return
      setPreference(snapshot.languagePreference)
      setLocale(snapshot.locale)
    }
    void window.motusSeed.snapshot().then(applySnapshot)
    const unsubscribe = window.motusSeed.subscribe((event) => {
      if (event.type === 'snapshot.changed') applySnapshot(event.snapshot)
    })
    return () => {
      active = false
      unsubscribe()
    }
  }, [])

  const setLanguagePreference = useCallback((preference: SeedLanguagePreference) => {
    setPreference(preference)
    if (preference !== 'system') setLocale(preference)
    void window.motusSeed.setLanguagePreference(preference)
  }, [])

  const value = useMemo(() => ({ languagePreference, locale, setLanguagePreference }), [languagePreference, locale, setLanguagePreference])
  return <SeedI18nContext.Provider value={value}><I18nextProvider i18n={instance}>{children}</I18nextProvider></SeedI18nContext.Provider>
}

export function useSeedI18n() {
  const value = useContext(SeedI18nContext)
  if (!value) throw new Error('useSeedI18n must be used within SeedI18nProvider')
  return value
}
