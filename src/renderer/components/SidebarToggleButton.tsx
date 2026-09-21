import { useTranslation } from 'react-i18next'
import { cx } from '../lib/display'
import { Tooltip } from './Tooltip'

type SidebarToggleButtonProps = {
  collapsed: boolean
  onToggle: () => void
  className?: string
}

export function SidebarToggleButton({ collapsed, onToggle, className }: SidebarToggleButtonProps) {
  const { t } = useTranslation()
  const label = t(collapsed ? 'nav.expandSidebar' : 'nav.collapseSidebar')

  return (
    <Tooltip content={label}>
      <button
        className={cx('grid h-7 w-7 shrink-0 place-items-center rounded-[8px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:bg-muted focus-visible:text-foreground focus-visible:outline-none', className)}
        type="button"
        onClick={onToggle}
        aria-label={label}
      >
        <svg className="h-[18px] w-[18px]" viewBox="0 0 20 20" fill="currentColor" fillRule="evenodd" clipRule="evenodd" aria-hidden="true">
          <path d={collapsed
            ? 'M14.5 2.877a3.665 3.665 0 0 1 3.665 3.665v6.917a3.665 3.665 0 0 1-3.665 3.665h-9a3.665 3.665 0 0 1-3.665-3.665V6.542A3.665 3.665 0 0 1 5.5 2.877zM6.835 15.794H14.5a2.335 2.335 0 0 0 2.335-2.335V6.542A2.335 2.335 0 0 0 14.5 4.207H6.835zM5.5 4.207a2.335 2.335 0 0 0-2.335 2.335v6.917A2.335 2.335 0 0 0 5.5 15.794h.005V4.207z'
            : 'M14.5 2.877a3.665 3.665 0 0 1 3.665 3.665v6.917a3.665 3.665 0 0 1-3.665 3.665h-9a3.665 3.665 0 0 1-3.665-3.665V6.542A3.665 3.665 0 0 1 5.5 2.877zM8.165 15.794H14.5a2.335 2.335 0 0 0 2.335-2.335V6.542A2.335 2.335 0 0 0 14.5 4.207H8.165zM5.5 4.207a2.335 2.335 0 0 0-2.335 2.335v6.917A2.335 2.335 0 0 0 5.5 15.794h1.335V4.207z'} />
        </svg>
      </button>
    </Tooltip>
  )
}
