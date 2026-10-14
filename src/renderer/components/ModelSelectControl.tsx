import { useTranslation } from 'react-i18next'
import { SelectControl, type SelectControlOption } from './SelectControl'

type ModelSelectControlProps = {
  label: string
  value: string
  options: Array<SelectControlOption<string> & { thinkingLevels?: readonly string[] }>
  onChange(model: string, thinking: string): void
  className?: string
  disabled?: boolean
  loading?: boolean
  thinkingValue?: string
  size?: 'default' | 'form'
}

export function modelSelectionThinking(levels: readonly string[] | undefined, thinking: string) {
  return levels?.includes(thinking) ? thinking : ''
}

/** Shared model picker; the caller owns the model list and default selection. */
export function ModelSelectControl({ label, value, options, onChange, className, disabled, loading = false, thinkingValue, size = 'default' }: ModelSelectControlProps) {
  const { t } = useTranslation()
  const selected = options.find((option) => option.value === value)
  const thinkingLevels = selected?.thinkingLevels || []
  const groupedOptions = [...options.filter((option) => option.group === 'seed'), ...options.filter((option) => option.group !== 'seed')]
  return <SelectControl
    portal
    closeOnSelect={false}
    variant="model"
    size={size}
    className={className}
    label={label}
    placeholder={t(loading ? 'plugins.optionListLoading' : value ? 'plugins.managementModelUnavailable' : 'plugins.managementModelSelect')}
    value={value}
    options={groupedOptions}
    onValueChange={(model) => onChange(model, modelSelectionThinking(options.find((option) => option.value === model)?.thinkingLevels, thinkingValue || ''))}
    disabled={disabled}
    loading={loading}
    modelMenu={{
      seedLabel: t('plugins.managementModelSeed'),
      customLabel: t('plugins.managementModelCustom'),
      thinking: thinkingValue !== undefined ? {
        label: t('plugins.managementThinkingLevel'), value: modelSelectionThinking(thinkingLevels, thinkingValue), levels: [...thinkingLevels], unselectedLabel: t('plugins.managementThinkingUnselected'), onChange: (thinking) => onChange(value, thinking),
        emptyLabel: t(selected ? 'plugins.managementThinkingUnsupported' : 'plugins.managementThinkingChooseModel'),
        labels: Object.fromEntries(['', 'off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'].map((level) => [level, t(`plugins.managementThinking.${level || 'default'}`)])),
      } : undefined,
    }}
  />
}
