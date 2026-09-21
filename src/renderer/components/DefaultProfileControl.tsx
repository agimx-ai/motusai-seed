import { LoaderCircle } from 'lucide-react'

type DefaultProfileControlProps = {
  selected: boolean
  selectedLabel: string
  actionLabel: string
  busy?: boolean
  disabled?: boolean
  onSelect: () => void
}

export function DefaultProfileControl({ selected, selectedLabel, actionLabel, busy = false, disabled = false, onSelect }: DefaultProfileControlProps) {
  const className = 'relative inline-flex h-[30px] items-center justify-center rounded-[10px] px-2 text-[14px] font-normal'
  if (selected) return <span className={`${className} bg-muted text-muted-foreground`}>{selectedLabel}</span>
  return <button
    type="button"
    className={`${className} border border-border bg-card text-foreground outline-none transition-colors hover:bg-muted disabled:cursor-default disabled:text-muted-foreground disabled:hover:bg-card`}
    disabled={busy || disabled}
    aria-busy={busy}
    onClick={onSelect}
  >
    <span className={busy ? 'invisible' : undefined}>{actionLabel}</span>
    {busy && <LoaderCircle className="absolute animate-spin" size={13} aria-hidden="true" />}
  </button>
}
