export type View = 'overview' | 'plugins' | 'activity' | 'settings' | 'usage' | 'plugin-settings'

export type SettingsView = Extract<View, 'settings' | 'usage' | 'plugin-settings'>

export function isSettingsView(view: View): view is SettingsView {
  return view === 'settings' || view === 'usage' || view === 'plugin-settings'
}

export function cx(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(' ')
}

export function timeAgo(value: string | undefined, locale: string, emptyLabel = '') {
  if (!value) return emptyLabel
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 1000))
  const formatter = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' })
  if (seconds < 60) return formatter.format(0, 'second')
  if (seconds < 3600) return formatter.format(-Math.floor(seconds / 60), 'minute')
  if (seconds < 86400) return formatter.format(-Math.floor(seconds / 3600), 'hour')
  return new Date(value).toLocaleDateString(locale)
}

export function initials(name: string) {
  const words = name.trim().split(/\s+/).filter(Boolean)
  return Array.from(words[0] || 'S').slice(0, 1).join('').toUpperCase()
}
