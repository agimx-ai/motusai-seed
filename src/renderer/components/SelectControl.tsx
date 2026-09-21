import { Check, ChevronDown } from 'lucide-react'
import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { cx } from '../lib/display'

export type SelectControlOption<Value extends string> = {
  value: Value
  label: string
  disabled?: boolean
}

type SelectControlProps<Value extends string> = {
  value: Value
  options: Array<SelectControlOption<Value>>
  onValueChange: (value: Value) => void
  label: string
  className?: string
  disabled?: boolean
}

export function SelectControl<Value extends string>({
  value,
  options,
  onValueChange,
  label,
  className,
  disabled = false,
}: SelectControlProps<Value>) {
  const [open, setOpen] = useState(false)
  const [placement, setPlacement] = useState<'top' | 'bottom'>('bottom')
  const [availableHeight, setAvailableHeight] = useState<number>()
  const selectedIndex = Math.max(0, options.findIndex((option) => option.value === value))
  const [activeIndex, setActiveIndex] = useState(selectedIndex)
  const rootRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const listboxRef = useRef<HTMLDivElement>(null)
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([])
  const listboxId = useId()
  const selected = options[selectedIndex]

  useLayoutEffect(() => {
    if (!open) return
    const updatePlacement = () => {
      const trigger = triggerRef.current
      const listbox = listboxRef.current
      if (!trigger || !listbox) return
      const triggerRect = trigger.getBoundingClientRect()
      const gap = 5
      const viewportPadding = 8
      const spaceBelow = Math.max(0, window.innerHeight - triggerRect.bottom - gap - viewportPadding)
      const spaceAbove = Math.max(0, triggerRect.top - gap - viewportPadding)
      const nextPlacement = listbox.scrollHeight <= spaceBelow || spaceBelow >= spaceAbove ? 'bottom' : 'top'
      setPlacement(nextPlacement)
      setAvailableHeight(Math.floor(nextPlacement === 'bottom' ? spaceBelow : spaceAbove))
    }

    updatePlacement()
    window.addEventListener('resize', updatePlacement)
    window.addEventListener('scroll', updatePlacement, true)
    return () => {
      window.removeEventListener('resize', updatePlacement)
      window.removeEventListener('scroll', updatePlacement, true)
    }
  }, [open, options.length])

  useEffect(() => {
    if (!open) return
    const dismiss = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', dismiss)
    return () => document.removeEventListener('pointerdown', dismiss)
  }, [open])

  useEffect(() => {
    if (open) optionRefs.current[activeIndex]?.focus()
  }, [activeIndex, open])

  const move = (direction: 1 | -1) => {
    let next = activeIndex
    for (let attempts = 0; attempts < options.length; attempts += 1) {
      next = (next + direction + options.length) % options.length
      if (!options[next]?.disabled) {
        setActiveIndex(next)
        return
      }
    }
  }

  const choose = (index: number) => {
    const option = options[index]
    if (!option || option.disabled) return
    onValueChange(option.value)
    setOpen(false)
    requestAnimationFrame(() => triggerRef.current?.focus())
  }

  return <div
    ref={rootRef}
    className={cx('relative inline-flex shrink-0', className)}
    onKeyDown={(event) => {
      if (!open) return
      if (event.key === 'Escape' || event.key === 'Tab') {
        setOpen(false)
        if (event.key === 'Escape') {
          event.preventDefault()
          triggerRef.current?.focus()
        }
        return
      }
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault()
        move(event.key === 'ArrowDown' ? 1 : -1)
      } else if (event.key === 'Home' || event.key === 'End') {
        event.preventDefault()
        const indexes = options.map((_, index) => index).filter((index) => !options[index]?.disabled)
        setActiveIndex(event.key === 'Home' ? indexes[0]! : indexes.at(-1)!)
      } else if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault()
        choose(activeIndex)
      }
    }}
  >
    <button
      ref={triggerRef}
      type="button"
      className="inline-flex h-[30px] w-fit items-center justify-between gap-3 rounded-[10px] border border-border bg-card px-2.5 text-[13px] font-normal text-foreground outline-none transition-colors hover:bg-muted disabled:cursor-default disabled:opacity-50"
      aria-label={label}
      aria-haspopup="listbox"
      aria-expanded={open}
      aria-controls={open ? listboxId : undefined}
      disabled={disabled}
      onClick={() => {
        setActiveIndex(selectedIndex)
        setOpen((current) => !current)
      }}
      onKeyDown={(event) => {
        if (open || !['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
        event.preventDefault()
        setActiveIndex(event.key === 'End' ? options.length - 1 : selectedIndex)
        setOpen(true)
      }}
    >
      <span className="truncate">{selected?.label}</span>
      <ChevronDown className={cx('shrink-0 text-muted-foreground transition-transform duration-150', open && 'rotate-180')} size={14} strokeWidth={1.8} aria-hidden="true" />
    </button>
    {open && <div
      ref={listboxRef}
      id={listboxId}
      className={cx(
        'absolute right-0 z-50 min-w-full overflow-y-auto rounded-[10px] border border-border bg-card p-1 shadow-[0_8px_24px_rgba(0,0,0,.10)]',
        placement === 'top' ? 'bottom-[calc(100%+5px)] origin-bottom' : 'top-[calc(100%+5px)] origin-top',
      )}
      style={{ maxHeight: availableHeight }}
      role="listbox"
      aria-label={label}
    >
      {options.map((option, index) => <button
        ref={(node) => { optionRefs.current[index] = node }}
        key={option.value}
        type="button"
        className={cx(
          'flex h-7 w-full items-center justify-between gap-3 whitespace-nowrap rounded-[7px] px-2 text-left text-[13px] outline-none transition-colors disabled:cursor-default disabled:opacity-45',
          index === activeIndex ? 'bg-muted text-foreground' : 'text-muted-foreground hover:bg-muted hover:text-foreground',
        )}
        role="option"
        aria-selected={option.value === value}
        disabled={option.disabled}
        tabIndex={index === activeIndex ? 0 : -1}
        onPointerMove={() => !option.disabled && setActiveIndex(index)}
        onClick={() => choose(index)}
      >
        <span>{option.label}</span>
        {option.value === value && <Check size={13} strokeWidth={1.9} aria-hidden="true" />}
      </button>)}
    </div>}
  </div>
}
