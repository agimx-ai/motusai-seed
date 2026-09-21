import { ChevronDown } from 'lucide-react'
import type { ReactNode } from 'react'
import { cx } from '../lib/display'

type DisclosureControlProps = {
  open: boolean
  label: string
  onToggle: () => void
  children: ReactNode
  actions?: ReactNode
  actionsVisible?: boolean
}

export function DisclosureControl({ open, label, onToggle, children, actions, actionsVisible = false }: DisclosureControlProps) {
  return <div
    className={cx(
      'group relative flex min-h-12 w-full items-center rounded-[13px] transition-colors hover:bg-muted focus-within:bg-muted',
      open && 'rounded-b-none',
    )}
  >
    <button type="button" className="flex min-h-12 min-w-0 flex-1 items-center gap-3 rounded-[13px] px-4 text-left outline-none" aria-label={label} aria-expanded={open} onClick={onToggle}>
      <span className={cx(
        'flex min-w-0 flex-1 items-center gap-3 transition-[padding]',
        actionsVisible ? 'pr-32' : Boolean(actions) && 'group-hover:pr-32 group-focus-within:pr-32',
      )}>{children}</span>
      <ChevronDown className={cx('shrink-0 text-muted-foreground transition-transform duration-150', open && 'rotate-180')} size={14} strokeWidth={1.8} aria-hidden="true" />
    </button>
    {actions && <span className={cx(
      'absolute right-10 top-1/2 -translate-y-1/2 transition-opacity',
      actionsVisible ? 'opacity-100' : 'pointer-events-none opacity-0 group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100',
    )}>{actions}</span>}
  </div>
}
