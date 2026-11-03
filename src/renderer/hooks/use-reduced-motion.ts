import { useEffect, useState } from 'react'

export function useReducedMotion() {
  const isReduced = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches
    || document.documentElement.dataset.reducedMotion === 'true'
  const [reduced, setReduced] = useState(isReduced)

  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)')
    const update = () => setReduced(isReduced())
    const observer = new MutationObserver(update)
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-reduced-motion'] })
    query.addEventListener('change', update)
    return () => {
      observer.disconnect()
      query.removeEventListener('change', update)
    }
  }, [])

  return reduced
}
