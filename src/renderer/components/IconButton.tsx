import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { Tooltip } from './Tooltip'

type IconButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children' | 'title' | 'aria-label'> & {
  icon: ReactNode
  label: string
  tone?: 'neutral' | 'primary' | 'danger' | 'danger-hover'
  busy?: boolean
  showTooltip?: boolean
}

export function IconButton({ icon, label, tone = 'neutral', busy = false, showTooltip = true, className = '', disabled, ...props }: IconButtonProps) {
  const toneClass = tone === 'danger'
    ? 'text-danger hover:text-danger/75'
    : tone === 'danger-hover'
      ? 'text-muted-foreground hover:text-danger'
    : tone === 'primary'
      ? 'text-foreground hover:text-foreground/65'
      : 'text-muted-foreground hover:text-foreground'

  const button = <button
    className={`inline-grid h-[30px] w-[30px] shrink-0 place-items-center border-0 bg-transparent p-0 transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground/35 disabled:cursor-default disabled:opacity-40 ${toneClass} ${className}`}
    type="button"
    aria-label={label}
    disabled={disabled || busy}
    {...props}
  >
    <span className={busy ? 'animate-spin' : undefined} aria-hidden="true">{icon}</span>
  </button>
  return showTooltip ? <Tooltip content={label}>{button}</Tooltip> : button
}
