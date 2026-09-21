import type { PluginConfigurationOption, PluginConfigurationOptionBadge } from '../../shared/contracts'
import { configurationOptionDisplayLabel } from '../lib/configuration-options'
import { cx } from '../lib/display'

const badgeToneClass: Record<PluginConfigurationOptionBadge['tone'], string> = {
  neutral: 'bg-muted text-muted-foreground',
  info: 'bg-info-soft text-info',
  success: 'bg-success-soft text-success',
  warning: 'bg-warning-soft text-warning',
  danger: 'bg-danger-soft text-danger',
}

export function ConfigurationOptionLabel({ option, className }: { option: PluginConfigurationOption; className?: string }) {
  return <span className={cx('flex min-w-0 items-center gap-1.5', className)}>
    <span className="truncate">{configurationOptionDisplayLabel(option)}</span>
    {option.badges?.map((badge, index) => <span
      className={cx('shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium leading-4', badgeToneClass[badge.tone])}
      key={`${badge.label}-${index}`}
    >{badge.prefix}<span className={cx(badge.strikethrough && 'line-through')}>{badge.label}</span>{badge.suffix && <span className="ml-1.5">{badge.suffix}</span>}
    </span>)}
  </span>
}
