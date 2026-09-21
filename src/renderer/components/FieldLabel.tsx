import { CircleHelp } from 'lucide-react'
import type { ReactNode } from 'react'
import { Tooltip } from './Tooltip'

export function FieldLabel({ children, description, helpUrl, className = '' }: {
  children: ReactNode
  description?: string
  helpUrl?: string
  className?: string
}) {
  return <span className={`inline-flex min-w-0 items-center gap-1 ${className}`}>
    <span className="min-w-0 truncate">{children}</span>
    {description && <Tooltip content={description}>
      {helpUrl ? <a
        className="grid h-4 w-4 shrink-0 place-items-center rounded-full text-muted-foreground transition-colors hover:text-foreground focus-visible:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        href={helpUrl}
        target="_blank"
        rel="noreferrer"
        aria-label={description}
      >
        <CircleHelp size={12} strokeWidth={1.8} aria-hidden="true" />
      </a> : <span
        className="grid h-4 w-4 shrink-0 place-items-center rounded-full text-muted-foreground transition-colors hover:text-foreground focus-visible:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        tabIndex={0}
        aria-label={description}
      >
        <CircleHelp size={12} strokeWidth={1.8} aria-hidden="true" />
      </span>}
    </Tooltip>}
  </span>
}
