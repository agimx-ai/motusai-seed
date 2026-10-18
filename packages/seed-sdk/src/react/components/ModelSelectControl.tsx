import { SelectControl, type SelectControlOption } from './SelectControl';

export type ModelSelectPresentation = {
  placeholder: string;
  unavailable: string;
  loading: string;
  groups?: Record<string, string>;
  thinking: {
    label: string;
    unselected: string;
    unsupported: string;
    chooseModel: string;
    default: string;
    levels: Record<string, string>;
  };
};

type ModelSelectControlProps = {
  label: string;
  value: string;
  options: Array<SelectControlOption<string> & { thinkingLevels?: readonly string[] }>;
  onChange(model: string, thinking: string): void;
  className?: string;
  disabled?: boolean;
  loading?: boolean;
  thinkingValue?: string;
  size?: 'default' | 'form';
  presentation: ModelSelectPresentation;
};

export function modelSelectionThinking(levels: readonly string[] | undefined, thinking: string) {
  return levels?.includes(thinking) ? thinking : '';
}

/** Shared model picker; the caller owns the model list and default selection. */
export function ModelSelectControl({
  label,
  value,
  options,
  onChange,
  className,
  disabled,
  loading = false,
  thinkingValue,
  size = 'default',
  presentation,
}: ModelSelectControlProps) {
  const selected = options.find((option) => option.value === value);
  const thinkingLevels = selected?.thinkingLevels || [];
  const groups = Object.entries(presentation.groups ?? {}).map(([value, label]) => ({ value, label }));
  const groupedOptions = groups.length
    ? [
        ...groups.flatMap((group) => options.filter((option) => option.group === group.value)),
        ...options.filter((option) => !groups.some((group) => group.value === option.group)),
      ]
    : options;
  return (
    <SelectControl
      portal
      closeOnSelect={false}
      variant="model"
      size={size}
      className={className}
      label={label}
      placeholder={loading ? presentation.loading : value ? presentation.unavailable : presentation.placeholder}
      value={value}
      options={groupedOptions}
      onValueChange={(model) =>
        onChange(
          model,
          modelSelectionThinking(options.find((option) => option.value === model)?.thinkingLevels, thinkingValue || ''),
        )
      }
      disabled={disabled}
      loading={loading}
      modelMenu={{
        groups,
        thinking:
          thinkingValue !== undefined
            ? {
                label: presentation.thinking.label,
                value: modelSelectionThinking(thinkingLevels, thinkingValue),
                levels: [...thinkingLevels],
                unselectedLabel: presentation.thinking.unselected,
                onChange: (thinking) => onChange(value, thinking),
                emptyLabel: selected ? presentation.thinking.unsupported : presentation.thinking.chooseModel,
                labels: { ...presentation.thinking.levels, default: presentation.thinking.default },
              }
            : undefined,
      }}
    />
  );
}
