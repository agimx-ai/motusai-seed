import { LoaderCircle } from 'lucide-react'
import { useEffect, useRef } from 'react'

export function InfiniteScrollTrigger({
  hasMore,
  loading,
  label,
  onLoadMore,
}: {
  hasMore: boolean
  loading: boolean
  label: string
  onLoadMore: () => void
}) {
  const triggerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const trigger = triggerRef.current
    if (!trigger || !hasMore || loading) return
    const observer = new IntersectionObserver(([entry]) => {
      if (entry?.isIntersecting) onLoadMore()
    }, { rootMargin: '160px 0px' })
    observer.observe(trigger)
    return () => observer.disconnect()
  }, [hasMore, loading, onLoadMore])

  if (!hasMore && !loading) return null
  return <div ref={triggerRef} className="flex min-h-12 items-center justify-center py-3 text-[12px] text-muted-foreground">
    {loading && <span className="inline-flex items-center gap-2">
      <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
      {label}
    </span>}
  </div>
}
