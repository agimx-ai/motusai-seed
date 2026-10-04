import { ShieldCheck } from 'lucide-react'
import { useEffect, useId, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { ActionButton } from './ActionButton'

type ConfirmDialogProps = {
  open: boolean
  title: string
  icon?: ReactNode
  description?: string
  confirmLabel: string
  cancelLabel: string
  tone?: 'primary' | 'danger'
  busy?: boolean
  confirmDisabled?: boolean
  busyActionLabel?: string
  busyActionDisabled?: boolean
  children?: ReactNode
  onConfirm: () => void
  onCancel: () => void
  onBusyAction?: () => void
}

export function ConfirmDialog({
  open,
  title,
  icon,
  description,
  confirmLabel,
  cancelLabel,
  tone = 'primary',
  busy = false,
  confirmDisabled = false,
  busyActionLabel,
  busyActionDisabled = false,
  children,
  onConfirm,
  onCancel,
  onBusyAction,
}: ConfirmDialogProps) {
  const panelRef = useRef<HTMLDivElement>(null)
  const busyRef = useRef(busy)
  const onCancelRef = useRef(onCancel)
  const titleId = useId()
  const descriptionId = useId()
  busyRef.current = busy
  onCancelRef.current = onCancel

  useEffect(() => {
    if (!open) return
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const focusableSelector = 'input:not(:disabled), textarea:not(:disabled), select:not(:disabled), button:not(:disabled), [href], [tabindex]:not([tabindex="-1"])'
    const frame = requestAnimationFrame(() => panelRef.current?.querySelector<HTMLElement>(focusableSelector)?.focus())
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !busyRef.current) {
        event.preventDefault()
        onCancelRef.current()
        return
      }
      if (event.key !== 'Tab') return
      const controls = [...(panelRef.current?.querySelectorAll<HTMLElement>(focusableSelector) ?? [])]
      if (!controls.length) return
      const first = controls[0]!
      const last = controls.at(-1)!
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => {
      cancelAnimationFrame(frame)
      document.removeEventListener('keydown', onKeyDown)
      previousFocus?.focus()
    }
  }, [open])

  if (!open) return null

  return createPortal(<div
    className="fixed inset-0 z-[100] grid place-items-center bg-black/20 px-6 backdrop-blur-[2px] animate-[fade_.15s_ease_both]"
    onPointerDown={(event) => {
      if (event.target === event.currentTarget && !busy) onCancel()
    }}
  >
    <div
      ref={panelRef}
      className="w-full max-w-[390px] rounded-[18px] border border-border bg-card p-5 text-foreground shadow-[0_18px_55px_rgba(0,0,0,.18)] animate-[rise_.18s_ease_both]"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby={titleId}
      aria-describedby={description ? descriptionId : undefined}
    >
      <div className={description ? 'flex items-start gap-3' : 'flex items-center gap-3'}>
        {icon != null
          ? <span className="shrink-0" aria-hidden="true">{icon}</span>
          : <span className="grid h-8 w-8 shrink-0 place-items-center rounded-[10px] bg-muted text-foreground" aria-hidden="true">
              <ShieldCheck size={17} strokeWidth={1.8} />
            </span>}
        <div className={description ? 'min-w-0 pt-0.5' : 'min-w-0'}>
          <h2 id={titleId} className="m-0 text-[16px] font-medium tracking-[-.01em]">{title}</h2>
          {description && <p id={descriptionId} className="mb-0 mt-1 text-[12px] leading-5 text-muted-foreground">{description}</p>}
        </div>
      </div>
      {children && <div className="mt-4 rounded-[12px] bg-muted/65 px-3.5 py-3 text-[12px] leading-5">{children}</div>}
      <div className="mt-5 flex justify-end gap-2">
        {busy && onBusyAction
          ? <ActionButton tone="danger" disabled={busyActionDisabled} onClick={onBusyAction}>{busyActionLabel || cancelLabel}</ActionButton>
          : <>
              <ActionButton disabled={busy} onClick={onCancel}>{cancelLabel}</ActionButton>
              <ActionButton tone={tone} busy={busy} disabled={confirmDisabled} onClick={onConfirm}>{confirmLabel}</ActionButton>
            </>}
      </div>
    </div>
  </div>, document.body)
}
