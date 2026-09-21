import { type ReactNode, useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

type TooltipPlacement = 'top' | 'bottom'

type TooltipProps = {
  children: ReactNode
  content?: ReactNode
  delayMs?: number
  gap?: number
  placement?: TooltipPlacement
}

const defaultGap = 6
const viewportPadding = 8

export function Tooltip({
  children,
  content,
  delayMs = 300,
  gap = defaultGap,
  placement = 'top',
}: TooltipProps) {
  const id = useId()
  const anchorRef = useRef<HTMLSpanElement>(null)
  const tooltipRef = useRef<HTMLSpanElement>(null)
  const openTimerRef = useRef<number | null>(null)
  const [open, setOpen] = useState(false)
  const [style, setStyle] = useState<{ left: number; top: number } | null>(null)

  function clearOpenTimer() {
    if (openTimerRef.current == null) return
    window.clearTimeout(openTimerRef.current)
    openTimerRef.current = null
  }

  function showTooltip() {
    clearOpenTimer()
    setOpen(true)
  }

  function showTooltipDelayed() {
    clearOpenTimer()
    openTimerRef.current = window.setTimeout(() => {
      openTimerRef.current = null
      setOpen(true)
    }, Math.max(0, delayMs))
  }

  function hideTooltip() {
    clearOpenTimer()
    setOpen(false)
    setStyle(null)
  }

  useEffect(() => hideTooltip, [])

  useEffect(() => {
    if (!content) hideTooltip()
  }, [content])

  useLayoutEffect(() => {
    if (!open || !content) return

    const updatePosition = () => {
      const anchor = anchorRef.current?.firstElementChild as HTMLElement | null
      const tooltip = tooltipRef.current
      if (!anchor || !tooltip) return

      const anchorRect = anchor.getBoundingClientRect()
      const tooltipRect = tooltip.getBoundingClientRect()
      const aboveTop = anchorRect.top - tooltipRect.height - gap
      const belowTop = anchorRect.bottom + gap
      const shouldFallbackBelow = placement === 'top'
        && aboveTop < viewportPadding
        && belowTop + tooltipRect.height <= window.innerHeight - viewportPadding
      const preferredTop = placement === 'bottom' || shouldFallbackBelow ? belowTop : aboveTop
      const top = Math.max(viewportPadding, Math.min(preferredTop, window.innerHeight - tooltipRect.height - viewportPadding))
      const centeredLeft = anchorRect.left + anchorRect.width / 2 - tooltipRect.width / 2
      const left = Math.max(viewportPadding, Math.min(centeredLeft, window.innerWidth - tooltipRect.width - viewportPadding))

      setStyle({ left, top })
    }

    updatePosition()
    window.addEventListener('scroll', updatePosition, true)
    window.addEventListener('resize', updatePosition)
    return () => {
      window.removeEventListener('scroll', updatePosition, true)
      window.removeEventListener('resize', updatePosition)
    }
  }, [content, gap, open, placement])

  if (!content) return <>{children}</>

  return (
    <>
      <span
        ref={anchorRef}
        className="contents"
        aria-describedby={open ? id : undefined}
        onBlurCapture={hideTooltip}
        onFocusCapture={showTooltip}
        onPointerEnter={showTooltipDelayed}
        onPointerLeave={hideTooltip}
      >
        {children}
      </span>
      {open
        ? createPortal(
            <span
              ref={tooltipRef}
              id={id}
              role="tooltip"
              className={`pointer-events-none fixed z-[9999] w-max max-w-[min(260px,calc(100vw-16px))] whitespace-normal rounded-[8px] border border-border bg-card px-2 py-1 text-left font-sans text-[11px] font-normal leading-4 text-foreground shadow-none transition-opacity duration-100 ${style ? 'opacity-100' : 'opacity-0'}`}
              style={style ? { left: style.left, top: style.top } : { left: 0, top: 0 }}
            >
              {content}
            </span>,
            document.body,
          )
        : null}
    </>
  )
}
