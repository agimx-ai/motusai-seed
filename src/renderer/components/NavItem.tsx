import type { ReactNode } from 'react'
import { cx } from '../lib/display'

type NavItemProps = {
  active: boolean
  icon: ReactNode
  label: string
  onClick: () => void
}

export function NavItem({ active, icon, label, onClick }: NavItemProps) {
  return <button
    className={cx(
      'flex h-8 w-[calc(100%+16px)] -mx-2 items-center gap-2.5 rounded-[10px] border-0 px-3 text-left text-[14px] font-normal transition-colors',
      active
        ? 'bg-[var(--sidebar-item-active)] text-foreground'
        : 'bg-transparent text-muted-foreground hover:bg-[var(--sidebar-item-active)] hover:text-foreground',
    )}
    onClick={onClick}
  >
    {icon}<span>{label}</span>
  </button>
}
