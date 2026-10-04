import type { ReactNode } from 'react'
import { cx } from '../lib/display'

type NavItemProps = {
  active: boolean
  icon: ReactNode
  label: string
  onClick: () => void
  size?: 'default' | 'compact'
  tone?: 'muted' | 'foreground'
  iconSpacing?: 'default' | 'compact'
}

export function NavItem({ active, icon, label, onClick, size = 'default', tone = 'muted', iconSpacing = 'default' }: NavItemProps) {
  return <button
    className={cx(
      'flex w-[calc(100%+16px)] -mx-2 items-center rounded-[10px] border-0 px-3 text-left text-[14px] font-normal transition-colors',
      size === 'compact' ? 'h-[30px]' : 'h-8',
      iconSpacing === 'compact' ? 'gap-2' : 'gap-2.5',
      active
        ? 'bg-[var(--sidebar-item-active)] text-foreground'
        : tone === 'foreground'
          ? 'bg-transparent text-foreground hover:bg-[var(--sidebar-item-active)] hover:text-foreground'
          : 'bg-transparent text-muted-foreground hover:bg-[var(--sidebar-item-active)] hover:text-foreground',
    )}
    onClick={onClick}
  >
    {icon}<span>{label}</span>
  </button>
}
