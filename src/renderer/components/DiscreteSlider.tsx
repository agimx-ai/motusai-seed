import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Liquid } from '../vendor/liquid-gooey'

type Option = { value: string; label: string }
type Props = {
  label: string
  value: string
  options: Option[]
  placeholder: string
  unselectedLabel: string
  active?: boolean
  onChange(value: string): void
}
const thumbSize = 24
const progressAt = (index: number, count: number) => count === 1 ? 0.5 : Math.max(0, index) / Math.max(1, count - 1)

/** Discrete values remain native range input; the pinned Move engine owns only the liquid silhouette. */
export function DiscreteSlider({ label, value, options, placeholder, unselectedLabel, active = true, onChange }: Props) {
  const selectedIndex = options.findIndex((option) => option.value === value)
  const [preview, setPreview] = useState<number | null>(null)
  const [pointerProgress, setPointerProgress] = useState<number | null>(null)
  const [dragging, setDragging] = useState(false)
  const [keyboardFocus, setKeyboardFocus] = useState(false)
  const [width, setWidth] = useState(0)
  const [reduced, setReduced] = useState(() => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches)
  const rangeRef = useRef<HTMLInputElement>(null)
  const trackRef = useRef<HTMLDivElement>(null)
  const layerRef = useRef<HTMLDivElement>(null)
  const cancelledRef = useRef(false)
  const draggingRef = useRef(false)
  const committedRef = useRef(value)
  const selectedIndexRef = useRef(selectedIndex)
  selectedIndexRef.current = selectedIndex
  const index = preview ?? selectedIndex
  const progress = pointerProgress ?? progressAt(index, options.length)

  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)')
    const update = () => setReduced(media.matches)
    update()
    media.addEventListener('change', update)
    return () => media.removeEventListener('change', update)
  }, [])

  useLayoutEffect(() => {
    if (!active || !trackRef.current) return
    const track = trackRef.current
    const measure = () => setWidth(track.clientWidth)
    measure()
    const resize = new ResizeObserver(measure)
    resize.observe(track)
    return () => resize.disconnect()
  }, [active])

  useEffect(() => {
    committedRef.current = value
    if (!draggingRef.current) { setPreview(null); setPointerProgress(null) }
  }, [value])

  useEffect(() => {
    if (active) return
    draggingRef.current = false
    setDragging(false)
    setPreview(null)
    setPointerProgress(null)
  }, [active])

  const commit = (next: number) => {
    const option = options[next]
    if (cancelledRef.current || !option || committedRef.current === option.value) return
    committedRef.current = option.value
    onChange(option.value)
  }
  useEffect(() => {
    const range = rangeRef.current
    if (!range || !active) return
    // React's range onChange also fires during input; native change commits once on release.
    const change = () => commit(Number(range.value))
    range.addEventListener('change', change)
    return () => range.removeEventListener('change', change)
  }, [active, options, onChange])

  useEffect(() => {
    if (!active) return
    const move = (event: PointerEvent) => {
      if (!draggingRef.current || !rangeRef.current) return
      const rect = rangeRef.current.getBoundingClientRect()
      setPointerProgress(Math.min(1, Math.max(0, (event.clientX - rect.left - thumbSize / 2) / Math.max(1, rect.width - thumbSize))))
    }
    const finish = () => {
      if (!draggingRef.current) return
      draggingRef.current = false
      setDragging(false)
      setPreview(Number(rangeRef.current?.value || 0))
      setPointerProgress(null)
    }
    const cancel = () => {
      if (!draggingRef.current) return
      cancelledRef.current = true
      draggingRef.current = false
      setDragging(false)
      setPreview(null)
      setPointerProgress(null)
      if (rangeRef.current) rangeRef.current.value = String(Math.max(0, selectedIndexRef.current))
    }
    const keyboard = (event: KeyboardEvent) => { if (event.key === 'Tab') setKeyboardFocus(true) }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', finish)
    window.addEventListener('pointercancel', cancel)
    window.addEventListener('blur', cancel)
    document.addEventListener('keydown', keyboard, true)
    return () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', finish)
      window.removeEventListener('pointercancel', cancel)
      window.removeEventListener('blur', cancel)
      document.removeEventListener('keydown', keyboard, true)
      draggingRef.current = false
    }
  }, [active])

  useLayoutEffect(() => {
    const track = trackRef.current
    const layer = layerRef.current
    if (!track || !layer) return
    const syncFill = () => {
      const body = layer.querySelector<SVGRectElement>('[data-gooey-svg] g[id$="-sil"] > rect')
      const translation = body?.style.transform.match(/^translate\(([-\d.]+)px,/)
      const position = active && !reduced && translation && body
        ? (Number(translation[1]) + (Number(body.getAttribute('width')) - thumbSize) / 2) / Math.max(1, width - thumbSize)
        : progress
      const filled = Math.max(0, Math.min(1, position))
      track.style.setProperty('--seed-slider-progress', String(filled))
      track.querySelectorAll<HTMLElement>('.seed-discrete-slider-tick').forEach((tick) => {
        tick.classList.toggle('is-filled', Number.parseFloat(tick.style.left) / 100 <= filled + 0.001)
      })
    }
    syncFill()
    const observer = new MutationObserver(syncFill)
    observer.observe(layer, { subtree: true, childList: true, attributes: true, attributeFilter: ['style'] })
    return () => observer.disconnect()
  }, [active, progress, reduced, width])

  if (!options.length) return null
  const thumb = <span className={`seed-discrete-slider-thumb${reduced || !active || width === 0 ? ' is-static' : ''}`}
    style={{ transform: `translateX(${progress * Math.max(0, width - thumbSize)}px)` }} />
  return <div className="seed-discrete-slider">
    <div className="seed-discrete-slider-summary"><span>{options[index]?.label || placeholder}</span>
      {options.length > 1 && <span className="text-muted-foreground">{options.at(-1)?.label}</span>}
    </div>
    <div ref={trackRef} className={`seed-discrete-slider-track${index < 0 ? ' is-unselected' : ''}`}>
      <div className="seed-discrete-slider-ticks" aria-hidden="true">{options.map((option, optionIndex) =>
        <span key={option.value} className="seed-discrete-slider-tick" style={{ left: `${progressAt(optionIndex, options.length) * 100}%` }} />)}</div>
      <input ref={rangeRef} type="range" min={0} max={Math.max(0, options.length - 1)} step={1} value={Math.max(0, index)}
        aria-label={label} aria-valuetext={options[index]?.label || unselectedLabel} disabled={!active}
        className={`seed-discrete-slider-range${dragging ? ' is-dragging' : ''}${keyboardFocus ? ' is-keyboard-focus' : ''}`}
        onChange={(event) => {
          if (cancelledRef.current) { event.currentTarget.value = String(Math.max(0, selectedIndex)); return }
          setPreview(Number(event.target.value))
          if (!draggingRef.current) setPointerProgress(null)
        }}
        onPointerDown={(event) => {
          cancelledRef.current = false
          draggingRef.current = true
          setDragging(true)
          setKeyboardFocus(false)
          const rect = event.currentTarget.getBoundingClientRect()
          setPointerProgress(Math.min(1, Math.max(0, (event.clientX - rect.left - thumbSize / 2) / Math.max(1, rect.width - thumbSize))))
        }}
        onClick={(event) => { if (selectedIndex < 0) commit(Number(event.currentTarget.value)) }}
        onKeyDown={(event) => {
          cancelledRef.current = false
          setKeyboardFocus(true)
          if (selectedIndex < 0 && ['Enter', ' ', 'Home', 'ArrowLeft'].includes(event.key)) commit(0)
        }}
        onBlur={() => setKeyboardFocus(false)} />
      <div ref={layerRef} className="seed-discrete-slider-motion" aria-hidden="true">
        <span className="seed-discrete-slider-thumb-underlay" />
        {active && !reduced && width > 0
          ? <Liquid className="seed-discrete-slider-surface" blur={6} contrast={18} fill="var(--card)" shadow="0 0 0 1px var(--border), 0 1px 5px rgba(0,0,0,0.08)">
              <Liquid.Item effect="move" move={{ springiness: 0.5, stretch: 0.6, trail: 0.35 }}>{thumb}</Liquid.Item>
            </Liquid>
          : thumb}
      </div>
    </div>
  </div>
}
