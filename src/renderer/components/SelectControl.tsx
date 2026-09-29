import { BrainCircuit, Check, ChevronDown } from 'lucide-react'
import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react'
import { createPortal } from 'react-dom'
import { cx } from '../lib/display'

export type SelectControlOption<Value extends string> = {
  value: Value
  label: string
  disabled?: boolean
  group?: 'seed' | 'custom'
  iconDataUrl?: string
}

type SelectControlProps<Value extends string> = {
  value: Value
  options: Array<SelectControlOption<Value>>
  onValueChange: (value: Value) => void
  label: string
  className?: string
  disabled?: boolean
  portal?: boolean
  variant?: 'compact' | 'form' | 'model'
  modelMenu?: { title: string; seedLabel: string; customLabel: string; thinking?: { label: string; value: string; levels: string[]; labels: Record<string, string>; unselectedLabel: string; onChange(value: string): void } }
}

export function SelectControl<Value extends string>({
  value,
  options,
  onValueChange,
  label,
  className,
  disabled = false,
  portal = false,
  variant = 'compact',
  modelMenu,
}: SelectControlProps<Value>) {
  const [open, setOpen] = useState(false)
  const [modelMenuMounted, setModelMenuMounted] = useState(false)
  const [placement, setPlacement] = useState<'top' | 'bottom'>('bottom')
  const [availableHeight, setAvailableHeight] = useState<number>()
  const [portalPosition, setPortalPosition] = useState<{ left: number; top: number; width: number; maxHeight: number }>()
  const [modelWidth, setModelWidth] = useState<number>()
  const selectedIndex = Math.max(0, options.findIndex((option) => option.value === value))
  const [activeIndex, setActiveIndex] = useState(selectedIndex)
  const rootRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const labelMeasureRef = useRef<HTMLSpanElement>(null)
  const listboxRef = useRef<HTMLDivElement>(null)
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([])
  const listboxId = useId()
  const selected = options[selectedIndex]
  const modelGroups = {
    seed: options.map((option, index) => ({ option, index })).filter(({ option }) => option.group === 'seed'),
    custom: options.map((option, index) => ({ option, index })).filter(({ option }) => option.group !== 'seed'),
  }
  const thinkingLevels = modelMenu?.thinking?.levels.filter((level) => level !== 'off') ?? []
  const thinkingIndex = thinkingLevels.indexOf(modelMenu?.thinking?.value ?? '')

  useLayoutEffect(() => {
    if (variant !== 'model') return
    const trigger = triggerRef.current
    const labelMeasure = labelMeasureRef.current
    if (!trigger || !labelMeasure) return
    const style = getComputedStyle(trigger)
    const icons = Array.from(trigger.querySelectorAll(':scope > svg, :scope > img'))
    const collapsedWidth = Math.ceil(labelMeasure.getBoundingClientRect().width
      + icons.reduce((width, icon) => width + icon.getBoundingClientRect().width, 0)
      + parseFloat(style.columnGap || '0') * icons.length
      + parseFloat(style.paddingLeft) + parseFloat(style.paddingRight)
      + parseFloat(style.borderLeftWidth) + parseFloat(style.borderRightWidth))
    if (!open) setModelWidth(collapsedWidth)
  }, [variant, selected?.label, open])

  useLayoutEffect(() => {
    if (!open) return
    const updatePlacement = () => {
      const trigger = triggerRef.current
      const listbox = listboxRef.current
      if (!trigger || !listbox) return
      const triggerRect = trigger.getBoundingClientRect()
      const gap = 5
      const viewportPadding = 8
      const topInset = variant === 'model' ? 56 : viewportPadding
      const spaceBelow = Math.max(0, window.innerHeight - triggerRect.bottom - gap - viewportPadding)
      const spaceAbove = Math.max(0, triggerRect.top - gap - topInset)
      const nextPlacement = listbox.scrollHeight <= spaceBelow || spaceBelow >= spaceAbove ? 'bottom' : 'top'
      setPlacement(nextPlacement)
      setAvailableHeight(Math.floor(nextPlacement === 'bottom' ? spaceBelow : spaceAbove))
      if (portal) {
        const maxHeight = Math.floor(nextPlacement === 'bottom' ? spaceBelow : spaceAbove)
        const width = Math.min(Math.max(triggerRect.width, listbox.scrollWidth), window.innerWidth - 16)
        if (variant === 'model') setModelWidth(width)
        const left = Math.max(8, Math.min(triggerRect.left, window.innerWidth - width - 8))
        const top = nextPlacement === 'top'
          ? triggerRect.top - gap - Math.min(listbox.scrollHeight, maxHeight)
          : triggerRect.bottom + gap
        setPortalPosition({ left, top, width, maxHeight })
      }
    }

    updatePlacement()
    window.addEventListener('resize', updatePlacement)
    window.addEventListener('scroll', updatePlacement, true)
    return () => {
      window.removeEventListener('resize', updatePlacement)
      window.removeEventListener('scroll', updatePlacement, true)
    }
  }, [open, options.length, portal, variant])

  useEffect(() => {
    if (!open) return
    const dismiss = (event: PointerEvent) => {
    if (!rootRef.current?.contains(event.target as Node) && !listboxRef.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', dismiss)
    return () => document.removeEventListener('pointerdown', dismiss)
  }, [open])

  useEffect(() => {
    if (variant !== 'model') return
    if (open) {
      setModelMenuMounted(true)
      return
    }
    if (!modelMenuMounted) return
    // Also remove the exiting portal when animations are disabled or interrupted.
    const timeout = window.setTimeout(() => setModelMenuMounted(false), 160)
    return () => window.clearTimeout(timeout)
  }, [open, modelMenuMounted, variant])

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

  const handleKeyDown = (event: KeyboardEvent) => {
    if (!open) return
    if (event.target instanceof HTMLInputElement) {
      if (event.key === 'Escape') { setOpen(false); triggerRef.current?.focus(); event.preventDefault() }
      return
    }
    if (event.key === 'Tab' && variant === 'model') return
    if (event.key === 'Escape' || event.key === 'Tab') {
      setOpen(false)
      if (event.key === 'Escape' || (event.key === 'Tab' && portal)) {
        event.preventDefault()
        event.stopPropagation()
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
  }

  const optionButton = (option: SelectControlOption<Value>, index: number) => <button
    ref={(node) => { optionRefs.current[index] = node }}
    key={option.value}
    type="button"
    className={cx(
      'flex w-full items-center justify-between gap-3 whitespace-nowrap rounded-[7px] text-left outline-none transition-colors disabled:cursor-default disabled:opacity-45',
      variant === 'model' ? 'min-h-9 px-3 text-[13px]' : 'h-7 px-2 text-[13px]',
      index === activeIndex ? 'bg-muted text-foreground' : 'text-muted-foreground hover:bg-muted hover:text-foreground',
    )}
    role="option"
    aria-selected={option.value === value}
    disabled={option.disabled}
    tabIndex={index === activeIndex ? 0 : -1}
    onPointerMove={() => !option.disabled && setActiveIndex(index)}
    onClick={() => choose(index)}
  >
    <span className="flex min-w-0 items-center gap-2">
      {variant === 'model' && (option.iconDataUrl
        ? <img src={option.iconDataUrl} alt="" className="h-4 w-4 shrink-0 object-contain" aria-hidden="true" />
        : <BrainCircuit className="shrink-0 text-muted-foreground" size={16} strokeWidth={1.8} aria-hidden="true" />)}
      <span className="truncate">{option.label}</span>
    </span>
    {option.value === value && <Check className="shrink-0" size={variant === 'model' ? 16 : 13} strokeWidth={1.9} aria-hidden="true" />}
  </button>

  const listbox = (open || (variant === 'model' && modelMenuMounted)) && <div
    ref={listboxRef}
    id={listboxId}
    className={cx(
      'z-[110] overflow-y-auto border border-border bg-card shadow-[0_8px_24px_rgba(0,0,0,.10)]',
      variant === 'model' ? cx('min-w-[260px] rounded-[16px] p-2', placement === 'top' ? 'seed-model-menu--top' : 'seed-model-menu--bottom', open ? 'seed-model-menu--enter' : 'seed-model-menu--exit pointer-events-none') : 'rounded-[10px] p-1',
      portal ? 'fixed' : 'absolute right-0 min-w-full',
      !portal && (placement === 'top' ? 'bottom-[calc(100%+5px)] origin-bottom' : 'top-[calc(100%+5px)] origin-top'),
    )}
    style={portal ? { ...portalPosition, visibility: portalPosition ? 'visible' : 'hidden' } : { maxHeight: availableHeight }}
    role={variant === 'model' ? 'dialog' : 'listbox'}
    aria-label={label}
    aria-hidden={variant === 'model' && !open ? true : undefined}
    inert={variant === 'model' && !open}
    onAnimationEnd={(event) => { if (variant === 'model' && !open && event.target === event.currentTarget) setModelMenuMounted(false) }}
    onKeyDown={handleKeyDown}
  >
    {variant === 'model' && modelMenu ? <>
      <div className="px-3 pb-2 pt-1 text-[12px] font-medium text-muted-foreground" role="presentation">{modelMenu.title}</div>
      <div role="listbox" aria-label={label}>
        {modelGroups.seed.length > 0 && <>
          <div className="px-3 pb-1 pt-2 text-[11px] font-medium text-muted-foreground" role="presentation">{modelMenu.seedLabel}</div>
          {modelGroups.seed.map(({ option, index }) => optionButton(option, index))}
        </>}
        {modelGroups.custom.length > 0 && <>
          <div className="px-3 pb-1 pt-3 text-[11px] font-medium text-muted-foreground" role="presentation">{modelMenu.customLabel}</div>
          {modelGroups.custom.map(({ option, index }) => optionButton(option, index))}
        </>}
      </div>
      {modelMenu.thinking && thinkingLevels.length > 0 && <div className="mt-1.5 border-t border-border px-3 pb-2 pt-2.5" role="group" aria-label={modelMenu.thinking.label}>
        <div className="mb-4 flex items-center justify-between gap-3 text-[12px] leading-4"><span className="text-muted-foreground">{modelMenu.thinking.label}</span><span className="text-foreground">{modelMenu.thinking.labels[modelMenu.thinking.value] || modelMenu.thinking.labels.default}</span></div>
        <input type="range" min={0} max={Math.max(0, thinkingLevels.length - 1)} step={1}
          value={Math.max(0, thinkingIndex)}
          style={{ background: thinkingIndex < 0 ? 'var(--muted)' : `linear-gradient(to right, var(--seed-accent) ${thinkingLevels.length === 1 ? 100 : thinkingIndex / (thinkingLevels.length - 1) * 100}%, var(--muted) 0)` }}
          aria-label={modelMenu.thinking.label}
          aria-valuetext={thinkingIndex < 0 ? modelMenu.thinking.unselectedLabel : modelMenu.thinking.labels[modelMenu.thinking.value]}
          className={cx('seed-thinking-slider my-[6px] block w-full cursor-pointer accent-accent', thinkingIndex < 0 && 'opacity-55 hover:opacity-100 focus-visible:opacity-100')}
          onChange={(event) => modelMenu.thinking?.onChange(thinkingLevels[Number(event.target.value)]!)}
          onClick={(event) => { if (thinkingIndex < 0) modelMenu.thinking?.onChange(thinkingLevels[Number(event.currentTarget.value)]!) }}
          onKeyDown={(event) => { if (thinkingIndex < 0 && ['Enter', ' ', 'Home', 'ArrowLeft'].includes(event.key)) modelMenu.thinking?.onChange(thinkingLevels[0]!) }} />
      </div>}
    </> : options.map(optionButton)}
  </div>

  return <div
    ref={rootRef}
    className={cx('relative inline-flex shrink-0', variant === 'model' && 'transition-[width] duration-200 ease-out motion-reduce:transition-none', className)}
    style={variant === 'model' ? { width: modelWidth } : undefined}
    onKeyDown={handleKeyDown}
  >
    <button
      ref={triggerRef}
      type="button"
      className={cx(
        'inline-flex items-center gap-3 rounded-[var(--radius-control)] border font-normal text-foreground outline-none transition-colors disabled:cursor-default disabled:opacity-50',
        variant === 'model' ? 'justify-start' : 'justify-between',
        variant === 'form'
          ? 'h-[var(--text-input-height)] w-full border-input bg-card px-[var(--text-input-padding-x)] text-[var(--text-input-font-size)] hover:bg-muted'
          : variant === 'model'
            ? 'seed-action-button w-full border-border bg-card px-2 hover:bg-muted'
            : 'h-[30px] w-fit border-border bg-card px-2.5 text-[13px] hover:bg-muted',
      )}
      aria-label={label}
      aria-haspopup={variant === 'model' ? 'dialog' : 'listbox'}
      aria-expanded={open}
      aria-controls={open ? listboxId : undefined}
      disabled={disabled}
      onClick={() => {
        setActiveIndex(selectedIndex)
        if (!open) setPortalPosition(undefined)
        setOpen((current) => !current)
      }}
      onKeyDown={(event) => {
        if (open || !['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
        event.preventDefault()
        setActiveIndex(event.key === 'End' ? options.length - 1 : selectedIndex)
        setOpen(true)
      }}
    >
      {variant === 'model' && (selected?.iconDataUrl
        ? <img src={selected.iconDataUrl} alt="" className="h-4 w-4 shrink-0 object-contain" aria-hidden="true" />
        : <BrainCircuit className="shrink-0 text-muted-foreground" size={16} strokeWidth={1.8} aria-hidden="true" />)}
      <span className="truncate">{selected?.label}</span>
      {variant === 'model' && <span ref={labelMeasureRef} className="pointer-events-none absolute whitespace-nowrap opacity-0" aria-hidden="true">{selected?.label}</span>}
      <ChevronDown className={cx('shrink-0 text-muted-foreground transition-transform duration-150', variant === 'model' && 'ml-auto', open && 'rotate-180')} size={14} strokeWidth={1.8} aria-hidden="true" />
    </button>
    {portal ? listbox && createPortal(listbox, document.body) : listbox}
  </div>
}
