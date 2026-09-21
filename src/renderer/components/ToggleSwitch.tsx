import type { ButtonHTMLAttributes } from 'react'

type ToggleSwitchProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  checked: boolean
  label: string
}

export function ToggleSwitch({
  checked,
  label,
  className = '',
  disabled,
  ...props
}: ToggleSwitchProps) {
  return <button
    type="button"
    className={`relative h-[18px] w-8 shrink-0 rounded-full border-0 p-0.5 transition-[background-color,opacity] duration-150 disabled:cursor-default disabled:opacity-50 ${checked ? 'bg-[#3b82f6]' : 'bg-[#e4e4e7] dark:bg-[#3f3f46]'} ${className}`}
    disabled={disabled}
    role="switch"
    aria-checked={checked}
    aria-label={label}
    {...props}
  >
    <span className={`block h-3.5 w-3.5 rounded-full bg-white shadow-[0_1px_1px_rgba(0,0,0,.14)] transition-transform duration-150 ease-out ${checked ? 'translate-x-3.5' : ''}`} />
  </button>
}
