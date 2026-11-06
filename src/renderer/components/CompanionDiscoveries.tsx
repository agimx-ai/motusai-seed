import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { ArrowUpRight } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useDiscoveryCarousel } from '../hooks/use-discovery-carousel'
import { useReducedMotion } from '../hooks/use-reduced-motion'
import type { CompanionVisualState } from '../lib/companion'
import type { CompanionDiscovery } from '../../shared/companion-discoveries'
import { prepareDiscoveries, discoveryFrontLook, discoveryIdleDelay, type PreparedDiscovery } from '../lib/companion-discoveries'
import { SeedlingMascot } from './SeedlingMascot'

function bubbleOutline(width: number, height: number, looking: boolean) {
  const radius = height / 2
  const arc = radius * 0.55228475
  const s = Math.min(height / 34, 1.25)
  // The Messages-style tail continues the lower corner, with most of its
  // extension below the capsule rather than sticking out of the side.
  // Mirror the same outline for the other three corners.
  return [
    `M ${radius} 0 H ${width - radius}`,
    `C ${width - radius + arc} 0 ${width} ${radius - arc} ${width} ${radius}`,
    ...(looking ? [
      `C ${width} ${radius + 6 * s} ${width - 2 * s} ${height + s} ${width + 2 * s} ${height + 4 * s}`,
      `C ${width + 4 * s} ${height + 5.5 * s} ${width + 2 * s} ${height + 6.5 * s} ${width} ${height + 5 * s}`,
      `C ${width - 4 * s} ${height + 2 * s} ${width - 7 * s} ${height} ${width - 12 * s} ${height}`,
    ] : [`C ${width} ${radius + arc} ${width - radius + arc} ${height} ${width - radius} ${height}`]),
    `H ${radius} C ${radius - arc} ${height} 0 ${radius + arc} 0 ${radius}`,
    `C 0 ${radius - arc} ${radius - arc} 0 ${radius} 0 Z`,
  ].join(' ')
}

function DiscoveryBubble({ discovery, phase, looking, setHovered, setFocused }: {
  discovery: PreparedDiscovery
  phase: 'look' | 'visible' | 'leaving'
  looking: boolean
  setHovered: (value: boolean) => void
  setFocused: (value: boolean) => void
}) {
  const { t, i18n } = useTranslation()
  const bubbleRef = useRef<HTMLAnchorElement | HTMLSpanElement>(null)
  const Bubble = discovery.url ? 'a' : 'span'
  const [bubbleSize, setBubbleSize] = useState({ width: 260, height: 46 })

  useLayoutEffect(() => {
    const bubble = bubbleRef.current
    if (!bubble) return
    const measure = () => {
      const { width, height } = bubble.getBoundingClientRect()
      if (!width || !height) return
      setBubbleSize((previous) => previous.width === width && previous.height === height
        ? previous : { width, height })
    }
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(measure)
    observer.observe(bubble)
    return () => observer.disconnect()
  }, [Bubble])

  return <div className="seed-discovery" data-corner={discovery.corner} data-phase={phase} data-looking={looking}
      aria-label={t('overview.discoveries.label')}
      aria-hidden={phase !== 'visible'} inert={phase !== 'visible'}
      onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}
      onFocusCapture={() => setFocused(true)}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setFocused(false)
      }}>
      <Bubble ref={(element) => { bubbleRef.current = element }} className="seed-discovery-link"
        {...(discovery.url ? { href: discovery.url, target: '_blank', rel: 'noopener noreferrer' } : {})}>
        <svg className="seed-discovery-outline" viewBox={`0 0 ${bubbleSize.width + 48} ${bubbleSize.height + 48}`}
          aria-hidden="true" focusable="false">
          <path d={bubbleOutline(bubbleSize.width, bubbleSize.height, looking)} transform="translate(24 24)" vectorEffect="non-scaling-stroke" />
        </svg>
        <span className="seed-discovery-title">
          {discovery.title[i18n.resolvedLanguage?.startsWith('en') ? 'en-US' : 'zh-CN']}
          {discovery.url && <ArrowUpRight size={12} strokeWidth={1.5} aria-hidden="true" />}
        </span>
      </Bubble>
  </div>
}

export function CompanionDiscoveries({ state, label, items }: { state: CompanionVisualState; label: string; items: CompanionDiscovery[] }) {
  const prepared = useMemo(() => prepareDiscoveries(items), [items])
  const reducedMotion = useReducedMotion()
  const [interacting, setInteracting] = useState(false)
  const [settled, setSettled] = useState(false)
  const idle = state === 'idle' && !interacting

  useEffect(() => {
    setSettled(false)
    if (!idle) return
    const timer = window.setTimeout(() => setSettled(true), discoveryIdleDelay)
    return () => window.clearTimeout(timer)
  }, [idle])

  const enabled = idle && settled
  const carousel = useDiscoveryCarousel(enabled, reducedMotion, prepared)
  const handleInteractionChange = useCallback((active: boolean) => {
    setInteracting(active)
    if (active) carousel.restart()
  }, [carousel.restart])
  const revealedCount = interacting ? 0 : carousel.revealedCount
  const finishing = ['front', 'wink', 'rest', 'leaving', 'gap'].includes(carousel.phase)
  const look = enabled && carousel.visible && !reducedMotion
    ? finishing ? discoveryFrontLook : carousel.discovery?.look ?? null : null

  return <div className="seed-companion-stage" data-discovery-phase={carousel.phase} data-interacting={interacting}>
    <SeedlingMascot state={state} label={label} look={look}
      idleAnimation={enabled && carousel.visible && carousel.phase === 'wink' ? 'wink' : undefined}
      onInteractionChange={handleInteractionChange} />
    {carousel.items.map((discovery, index) => <DiscoveryBubble key={discovery.corner} discovery={discovery}
      phase={index >= revealedCount ? 'look' : carousel.phase === 'leaving' ? 'leaving' : 'visible'}
      looking={look !== null && !finishing && index < revealedCount && discovery.corner === carousel.discovery?.corner}
      setHovered={carousel.setHovered} setFocused={carousel.setFocused} />)}
  </div>
}
