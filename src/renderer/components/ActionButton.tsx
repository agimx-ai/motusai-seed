import type { ButtonHTMLAttributes, ReactNode } from 'react'

type ActionButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  icon?: ReactNode
  tone?: 'neutral' | 'primary' | 'muted' | 'info' | 'danger' | 'ghost'
  busy?: boolean
}

export function ActionButton({
  icon,
  tone = 'neutral',
  busy = false,
  className = '',
  children,
  disabled,
  ...props
}: ActionButtonProps) {
  const toneClass = tone === 'ghost'
    ? 'bg-transparent text-foreground hover:bg-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground/35 disabled:text-muted-foreground disabled:hover:bg-transparent'
    : tone === 'danger'
    ? 'border-danger/20 text-danger hover:bg-danger-soft disabled:hover:bg-transparent'
    : tone === 'primary'
      ? 'border-transparent bg-accent text-accent-foreground hover:bg-accent-hover disabled:opacity-50'
      : tone === 'muted'
        ? 'border-border bg-muted/65 text-muted-foreground hover:bg-muted disabled:text-muted-foreground disabled:opacity-100'
      : tone === 'info'
        ? 'border-info-border bg-info-soft text-info hover:bg-info-hover'
      : 'border-border bg-card text-foreground hover:bg-muted disabled:text-muted-foreground disabled:hover:bg-card'

  return <button
    className={`seed-action-button inline-flex min-w-[48px] shrink-0 items-center justify-center gap-1 px-2 font-normal transition-colors disabled:cursor-default ${tone === 'ghost' ? 'border-0' : 'border'} ${toneClass} ${className}`}
    disabled={disabled || busy}
    {...props}
  >
    {icon}
    {children}
  </button>
}
