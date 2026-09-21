import type { HTMLAttributes, KeyboardEvent, ReactNode } from 'react'
import { cx } from '../lib/display'

export type SegmentedControlOption<Value extends string> = {
  value: Value
  label: string
  icon?: ReactNode
  disabled?: boolean
}

type SegmentedControlProps<Value extends string> = Omit<HTMLAttributes<HTMLDivElement>, 'onChange'> & {
  value: Value
  options: Array<SegmentedControlOption<Value>>
  onValueChange: (value: Value) => void
  label: string
}

export function SegmentedControl<Value extends string>({ value, options, onValueChange, label, className, ...props }: SegmentedControlProps<Value>) {
  const selectFromKeyboard = (event: KeyboardEvent<HTMLButtonElement>, currentIndex: number) => {
    const direction = event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1 : 0
    let nextIndex = event.key === 'Home' ? 0 : event.key === 'End' ? options.length - 1 : currentIndex + direction
    if (!direction && event.key !== 'Home' && event.key !== 'End') return
    event.preventDefault()

    for (let attempts = 0; attempts < options.length; attempts += 1) {
      nextIndex = (nextIndex + options.length) % options.length
      if (!options[nextIndex].disabled) break
      nextIndex += direction || 1
    }
    if (options[nextIndex].disabled) return
    onValueChange(options[nextIndex].value)
    event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="radio"]')[nextIndex]?.focus()
  }

  return <div className={cx('inline-flex h-[30px] shrink-0 items-center rounded-[10px] border border-border bg-muted p-0.5', className)} role="radiogroup" aria-label={label} {...props}>
    {options.map((option, index) => {
      const selected = option.value === value
      return <button
        key={option.value}
        type="button"
        className={cx(
          'inline-flex h-6 min-w-[54px] items-center justify-center gap-1.5 rounded-[8px] px-2 text-[13px] font-normal transition-[background-color,color,box-shadow] disabled:cursor-default disabled:opacity-45',
          selected
            ? 'bg-card text-foreground shadow-[0_1px_2px_rgba(0,0,0,.06)]'
            : 'text-muted-foreground hover:bg-card/45 hover:text-foreground',
        )}
        role="radio"
        aria-checked={selected}
        tabIndex={selected ? 0 : -1}
        disabled={option.disabled}
        onClick={() => onValueChange(option.value)}
        onKeyDown={(event) => selectFromKeyboard(event, index)}
      >
        {option.icon && <span className="grid h-3.5 w-3.5 shrink-0 place-items-center [&>svg]:h-3.5 [&>svg]:w-3.5" aria-hidden="true">{option.icon}</span>}
        <span>{option.label}</span>
      </button>
    })}
  </div>
}
