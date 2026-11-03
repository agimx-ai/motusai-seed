import { useCallback, useEffect, useRef, useState } from 'react'
import { companionDiscoveries, discoveryTiming, type DiscoveryPhase } from '../lib/companion-discoveries'

type Cursor = { index: number; phase: DiscoveryPhase }

export function useDiscoveryCarousel(enabled: boolean, reducedMotion: boolean) {
  const [cursor, setCursor] = useState<Cursor>({ index: 0, phase: 'look' })
  const [hovered, setHovered] = useState(false)
  const [focused, setFocused] = useState(false)
  const [visible, setVisible] = useState(() => !document.hidden)
  const remaining = useRef(discoveryTiming.look)
  const timedCursor = useRef(cursor)

  const restart = useCallback(() => {
    setCursor({ index: 0, phase: 'look' })
    setHovered(false)
    setFocused(false)
  }, [])

  useEffect(() => {
    const visibilityChanged = () => setVisible(!document.hidden)
    document.addEventListener('visibilitychange', visibilityChanged)
    return () => {
      document.removeEventListener('visibilitychange', visibilityChanged)
    }
  }, [])

  useEffect(() => {
    if (timedCursor.current !== cursor) {
      remaining.current = discoveryTiming[cursor.phase]
      timedCursor.current = cursor
    }
    if (!enabled || reducedMotion || hovered || focused || !visible) return
    const startedAt = performance.now()
    let completed = false
    const timer = window.setTimeout(() => {
      completed = true
      const next: Cursor = cursor.phase === 'look'
        ? { ...cursor, phase: 'visible' }
        : cursor.phase === 'visible'
          ? cursor.index < companionDiscoveries.length - 1
            ? { index: cursor.index + 1, phase: 'look' }
            : { ...cursor, phase: 'front' }
          : cursor.phase === 'front' ? { ...cursor, phase: 'wink' }
            : cursor.phase === 'wink' ? { ...cursor, phase: 'rest' }
              : cursor.phase === 'rest' ? { ...cursor, phase: 'leaving' }
                : cursor.phase === 'leaving' ? { index: 0, phase: 'gap' }
                  : { index: 0, phase: 'look' }
      setCursor(next)
    }, remaining.current)
    return () => {
      window.clearTimeout(timer)
      if (!completed) remaining.current = Math.max(0, remaining.current - (performance.now() - startedAt))
    }
  }, [cursor, enabled, reducedMotion, hovered, focused, visible])

  return {
    discovery: companionDiscoveries[cursor.index]!,
    phase: reducedMotion ? 'visible' as const : cursor.phase,
    revealedCount: reducedMotion ? companionDiscoveries.length
      : cursor.phase === 'gap' ? 0 : cursor.phase === 'look' ? cursor.index : cursor.index + 1,
    visible,
    setHovered,
    setFocused,
    restart,
  }
}
