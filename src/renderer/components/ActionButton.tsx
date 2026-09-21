import type { ButtonHTMLAttributes, ReactNode } from 'react'

type ActionButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  icon?: ReactNode
  tone?: 'neutral' | 'primary' | 'muted' | 'info' | 'danger'
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
  const toneClass = tone === 'danger'
    ? 'border-danger/20 text-danger hover:bg-danger-soft disabled:hover:bg-transparent'
    : tone === 'primary'
      ? 'border-transparent bg-accent text-accent-foreground hover:bg-accent-hover disabled:opacity-50'
      : tone === 'muted'
        ? 'border-border bg-muted/65 text-muted-foreground hover:bg-muted disabled:text-muted-foreground disabled:opacity-100'
      : tone === 'info'
        ? 'border-info-border bg-info-soft text-info hover:bg-info-hover'
      : 'border-border bg-card text-foreground hover:bg-muted disabled:text-muted-foreground disabled:hover:bg-card'

  return <button
    className={`inline-flex h-[30px] min-w-[48px] shrink-0 items-center justify-center gap-1 rounded-[10px] border px-2 text-[14px] font-normal transition-colors disabled:cursor-default ${toneClass} ${className}`}
    disabled={disabled || busy}
    {...props}
  >
    {icon}
    {children}
  </button>
}
