import { useEffect, useState } from 'react'

const motionQuery = '(prefers-reduced-motion: reduce)'
const preferenceKey = 'seed.reducedMotion'
export type ReducedMotionPreference = 'system' | 'on' | 'off'

function readPreference(): ReducedMotionPreference {
  try {
    const saved = window.localStorage.getItem(preferenceKey)
    if (saved === 'on' || saved === 'off') return saved
  } catch {
    // Use the system preference when storage is unavailable.
  }
  return 'system'
}

function applyPreference(preference: ReducedMotionPreference, systemReducesMotion: boolean) {
  document.documentElement.dataset.reducedMotion = String(
    preference === 'system' ? systemReducesMotion : preference === 'on',
  )
}

export function initializeReducedMotion() {
  applyPreference(readPreference(), window.matchMedia(motionQuery).matches)
}

export function useReducedMotionPreference() {
  const [preference, setPreference] = useState(readPreference)

  useEffect(() => {
    const query = window.matchMedia(motionQuery)
    const update = () => applyPreference(preference, query.matches)
    update()
    if (preference !== 'system') return
    query.addEventListener('change', update)
    return () => query.removeEventListener('change', update)
  }, [preference])

  function setReducedMotionPreference(next: ReducedMotionPreference) {
    setPreference(next)
    try {
      window.localStorage.setItem(preferenceKey, next)
    } catch {
      // The choice still applies to the current session.
    }
  }

  return { reducedMotionPreference: preference, setReducedMotionPreference }
}

function resolveReducedMotion(systemReducesMotion: boolean) {
  const override = document.documentElement.dataset.reducedMotion
  return override === undefined ? systemReducesMotion : override === 'true'
}

export function useReducedMotion() {
  const [reduced, setReduced] = useState(() => typeof window !== 'undefined'
    && resolveReducedMotion(Boolean(window.matchMedia?.(motionQuery).matches)))

  useEffect(() => {
    const query = window.matchMedia?.(motionQuery)
    const update = () => setReduced(resolveReducedMotion(Boolean(query?.matches)))
    const observer = new MutationObserver(update)
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-reduced-motion'] })
    query?.addEventListener('change', update)
    update()
    return () => {
      observer.disconnect()
      query?.removeEventListener('change', update)
    }
  }, [])

  return reduced
}
