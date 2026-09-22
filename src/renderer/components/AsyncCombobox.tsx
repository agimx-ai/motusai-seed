import { Check, ChevronDown, LoaderCircle, RefreshCw } from 'lucide-react'
import { useEffect, useId, useMemo, useRef, useState } from 'react'
import type { PluginConfigurationOption } from '../../shared/contracts'
import { configurationOptionDisplayLabel } from '../lib/configuration-options'
import { cx } from '../lib/display'
import { ConfigurationOptionLabel } from './ConfigurationOptionLabel'

type Props = {
  value: string
  valueLabel?: string
  valueOption?: PluginConfigurationOption
  options: PluginConfigurationOption[]
  placeholder: string
  label: string
  loading: boolean
  emptyMessage: string
  unavailableMessage: string
  refreshLabel: string
  error?: string
  unavailable?: boolean
  resolvingValueLabel?: boolean
  maxLength?: number
  required?: boolean
  onChange(value: string): void
  onRefresh(): void
}

export function AsyncCombobox({ value, valueLabel, valueOption, options, placeholder, label, loading, emptyMessage, unavailableMessage, refreshLabel, error, unavailable, resolvingValueLabel = false, maxLength, required, onChange, onRefresh }: Props) {
  const [open, setOpen] = useState(false)
  const [typed, setTyped] = useState(false)
  const [activeIndex, setActiveIndex] = useState(-1)
  const rootRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const suppressFocusOpenRef = useRef(false)
  const listboxId = useId()
  const selectedOption = options.find((option) => option.value === value)
  const displayOption = selectedOption || (valueOption?.value === value ? valueOption : undefined)
  const richDisplay = !typed && Boolean(displayOption?.badges?.length || displayOption?.iconDataUrl)
  const displayValue = typed ? value : displayOption ? configurationOptionDisplayLabel(displayOption) : valueLabel || (resolvingValueLabel ? '' : value)
  const visibleOptions = useMemo(() => {
    const query = typed ? value.trim().toLocaleLowerCase() : ''
    return query
      ? options.filter((option) => `${option.label} ${option.value}`.toLocaleLowerCase().includes(query))
      : options
  }, [options, typed, value])

  useEffect(() => {
    if (!open) return
    const dismiss = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', dismiss)
    return () => document.removeEventListener('pointerdown', dismiss)
  }, [open])

  useEffect(() => {
    if (activeIndex >= visibleOptions.length) setActiveIndex(visibleOptions.length - 1)
  }, [activeIndex, visibleOptions.length])

  const choose = (option: PluginConfigurationOption) => {
    onChange(option.value)
    setOpen(false)
    setTyped(false)
    suppressFocusOpenRef.current = true
    requestAnimationFrame(() => {
      inputRef.current?.focus()
      suppressFocusOpenRef.current = false
    })
  }

  return <div ref={rootRef} className="relative min-w-0">
    <div className="relative flex h-9 min-w-0 items-center rounded-[10px] border border-input bg-card transition-colors focus-within:border-foreground/35">
      <input
        ref={inputRef}
        className={cx('h-full min-w-0 flex-1 bg-transparent px-3 text-[13px] text-foreground outline-none placeholder:text-muted-foreground', richDisplay && 'text-transparent caret-foreground')}
        role="combobox"
        aria-label={label}
        aria-autocomplete="list"
        aria-expanded={open}
        aria-controls={open ? listboxId : undefined}
        aria-activedescendant={open && activeIndex >= 0 ? `${listboxId}-${activeIndex}` : undefined}
        required={required}
        maxLength={maxLength}
        value={displayValue}
        placeholder={placeholder}
        autoComplete="off"
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        onFocus={() => {
          if (suppressFocusOpenRef.current) return
          setTyped(false)
          setOpen(true)
        }}
        onClick={() => {
          if (!open) {
            setTyped(false)
            setOpen(true)
          }
        }}
        onChange={(event) => {
          onChange(event.target.value)
          setTyped(true)
          setOpen(true)
          setActiveIndex(0)
        }}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            setOpen(false)
            return
          }
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault()
            setOpen(true)
            if (!visibleOptions.length) return
            setActiveIndex((current) => {
              if (current < 0) return event.key === 'ArrowDown' ? 0 : visibleOptions.length - 1
              return (current + (event.key === 'ArrowDown' ? 1 : -1) + visibleOptions.length) % visibleOptions.length
            })
            return
          }
          if (event.key === 'Enter' && open && activeIndex >= 0 && visibleOptions[activeIndex]) {
            event.preventDefault()
            choose(visibleOptions[activeIndex])
          }
        }}
      />
      {richDisplay && displayOption && <ConfigurationOptionLabel
        option={displayOption}
        className="pointer-events-none absolute inset-y-0 left-3 right-9 text-[13px] text-foreground"
      />}
      <button
        type="button"
        className="grid h-full w-8 shrink-0 place-items-center text-muted-foreground outline-none transition-colors hover:text-foreground"
        aria-label={error ? refreshLabel : label}
        onClick={() => {
          if (open) {
            setOpen(false)
            return
          }
          setTyped(false)
          if (error) onRefresh()
          setOpen(true)
        }}
      >
        {loading || resolvingValueLabel
          ? <LoaderCircle size={14} className="animate-spin" aria-hidden="true" />
          : error
            ? <RefreshCw size={13} aria-hidden="true" />
            : <ChevronDown
                size={14}
                className={cx('transition-transform duration-150', open && 'rotate-180')}
                aria-hidden="true"
              />}
      </button>
    </div>
    {open && <div
      id={listboxId}
      className="absolute left-0 right-0 top-[calc(100%+5px)] z-[7] max-h-52 overflow-y-auto rounded-[10px] border border-border bg-card p-1 shadow-[0_8px_24px_rgba(0,0,0,.10)]"
      role="listbox"
      aria-label={label}
    >
      {visibleOptions.map((option, index) => <button
        id={`${listboxId}-${index}`}
        key={option.value}
        type="button"
        className={cx(
          'flex min-h-7 w-full items-center justify-between gap-3 rounded-[7px] px-2 py-1 text-left text-[13px] outline-none transition-colors',
          index === activeIndex ? 'bg-muted text-foreground' : 'text-muted-foreground hover:bg-muted hover:text-foreground',
        )}
        role="option"
        aria-selected={option.value === value}
        onPointerMove={() => setActiveIndex(index)}
        onClick={() => choose(option)}
      >
        <span className="min-w-0">
          <ConfigurationOptionLabel option={option} className="flex-1" />
        </span>
        {option.value === value && <Check size={13} className="shrink-0" aria-hidden="true" />}
      </button>)}
      {!loading && !visibleOptions.length && <p className="m-0 px-2 py-2 text-[12px] text-muted-foreground">{error || unavailable ? unavailableMessage : emptyMessage}</p>}
    </div>}
  </div>
}
