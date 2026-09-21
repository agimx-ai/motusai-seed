import type { PluginConfigurationOption } from '../../shared/contracts'

export function configurationOptionDisplayLabel(option: PluginConfigurationOption) {
  const label = option.label.trim()
  const value = option.value.trim()
  for (const suffix of [` (${value})`, `（${value}）`]) {
    if (value && label.endsWith(suffix)) return label.slice(0, -suffix.length).trim() || value
  }
  return label || value
}
