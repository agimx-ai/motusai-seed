import { Blocks } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { cx } from '../lib/display'

const iconBackgroundCache = new Map<string, boolean>()
const gridColumns = { 1: 'grid-cols-1', 2: 'grid-cols-2', 3: 'grid-cols-3', 4: 'grid-cols-4' } as const

export function resourceCardGridClass(columns: 1 | 2 | 3 | 4 = 2) {
  return cx('grid gap-x-8 gap-y-1 pt-2 max-[900px]:grid-cols-1', gridColumns[columns])
}

function imageHasBackground(image: HTMLImageElement) {
  const canvas = document.createElement('canvas')
  canvas.width = 4
  canvas.height = 4
  const context = canvas.getContext('2d')
  if (!context) return false
  try {
    context.drawImage(image, 0, 0, canvas.width, canvas.height)
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data
    return [0, 3, 12, 15].every((pixel) => pixels[pixel * 4 + 3] > 240)
  } catch {
    return false
  }
}

function AdaptiveIconImage({ src, sizeClass, className }: {
  src: string
  sizeClass: string
  className?: string
}) {
  const [detectedIcon, setDetectedIcon] = useState<{ src: string; hasBackground: boolean }>()
  const hasBackground = detectedIcon?.src === src ? detectedIcon.hasBackground : iconBackgroundCache.get(src)
  const imageClass = cx('h-full w-full', hasBackground === false ? 'object-contain p-1' : 'object-cover')
  const detectIconBackground = (image: HTMLImageElement) => {
    const detected = imageHasBackground(image)
    iconBackgroundCache.set(src, detected)
    setDetectedIcon({ src, hasBackground: detected })
  }

  return <span className={cx('block shrink-0 overflow-hidden bg-card', hasBackground === false && 'border border-plugin-icon-border', sizeClass, className)} aria-hidden="true">
    <img
      className={imageClass}
      crossOrigin={/^https?:\/\//i.test(src) ? 'anonymous' : undefined}
      src={src}
      alt=""
      onLoad={(event) => detectIconBackground(event.currentTarget)}
    />
  </span>
}

export function AdaptiveIcon({ iconUrl, iconDarkUrl, fallback, large = false }: {
  iconUrl?: string
  iconDarkUrl?: string
  fallback?: ReactNode
  large?: boolean
}) {
  const sizeClass = large ? 'h-14 w-14 rounded-[14px]' : 'h-9 w-9 rounded-[10px]'
  if (iconUrl) return <>
    <AdaptiveIconImage src={iconUrl} sizeClass={sizeClass} className={iconDarkUrl ? 'dark:hidden' : undefined} />
    {iconDarkUrl && <AdaptiveIconImage src={iconDarkUrl} sizeClass={sizeClass} className="hidden dark:block" />}
  </>
  return <span className={cx('grid shrink-0 place-items-center border border-plugin-icon-border bg-card text-muted-foreground', sizeClass)} aria-hidden="true">
    {fallback || <Blocks size={large ? 25 : 18} />}
  </span>
}

export function ResourceCard({ icon, title, description, trailing, onOpen }: {
  icon: ReactNode
  title: ReactNode
  description?: ReactNode
  trailing?: ReactNode
  onOpen?: () => void
}) {
  return <article className={`grid min-h-[68px] min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-4 rounded-[16px] px-2 py-2 transition-colors ${onOpen ? 'cursor-pointer hover:bg-muted' : ''}`} onClick={onOpen}>
    <button className="grid min-w-0 grid-cols-[36px_minmax(0,1fr)] items-center gap-3 border-0 bg-transparent p-0 text-left" type="button" disabled={!onOpen}>
      {icon}
      <span className="min-w-0">
        <strong className="mb-0.5 flex min-w-0 items-center gap-1.5 text-[14px] font-medium text-foreground">{title}</strong>
        {description != null && description !== '' && <small className="block truncate text-[13px] text-muted-foreground">{description}</small>}
      </span>
    </button>
    {trailing}
  </article>
}
