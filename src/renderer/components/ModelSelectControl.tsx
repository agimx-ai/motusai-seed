import { useTranslation } from 'react-i18next'
import { SelectControl, type SelectControlOption } from './SelectControl'

type ModelSelectControlProps = {
  label: string
  value: string
  options: Array<SelectControlOption<string>>
  onValueChange(value: string): void
  className?: string
  disabled?: boolean
  thinkingValue?: string
  thinkingLevels?: string[]
  onThinkingChange?(value: string): void
}

/** Shared model picker; the caller owns the model list and default selection. */
export function ModelSelectControl({ label, value, options, onValueChange, className, disabled, thinkingValue = '', thinkingLevels = [], onThinkingChange }: ModelSelectControlProps) {
  const { t } = useTranslation()
  const groupedOptions = [...options.filter((option) => option.group === 'seed'), ...options.filter((option) => option.group !== 'seed')]
  return <SelectControl
    portal
    variant="model"
    className={className}
    label={label}
    value={value}
    options={groupedOptions}
    onValueChange={onValueChange}
    disabled={disabled}
    modelMenu={{
      title: t('plugins.managementModelSelect'),
      seedLabel: t('plugins.managementModelSeed'),
      customLabel: t('plugins.managementModelCustom'),
      thinking: onThinkingChange ? {
        label: t('plugins.managementThinkingLevel'), value: thinkingValue, levels: thinkingLevels, unselectedLabel: t('plugins.managementThinkingUnselected'), onChange: onThinkingChange,
        labels: Object.fromEntries(['', 'off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'].map((level) => [level, t(`plugins.managementThinking.${level || 'default'}`)])),
      } : undefined,
    }}
  />
}
