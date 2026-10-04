import { Check } from 'lucide-react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import type { PluginInstallProgress } from '../../../shared/contracts'
import { cx } from '../../lib/display'

type Props = {
  action: 'install' | 'update' | 'details' | 'uninstall'
  progress?: PluginInstallProgress
  busy?: boolean
  disabled?: boolean
  onStart: () => void
  onCancel?: () => void
}

const layoutEase = [0.22, 1, 0.36, 1] as const
const ringSize = 20
const ringWidth = 1.5
const ringRadius = (ringSize - ringWidth) / 2

function drawProgressRing(canvas: HTMLCanvasElement, startAngle: number, fraction: number) {
  const ratio = Math.max(1, window.devicePixelRatio || 1)
  const bitmapSize = Math.round(ringSize * ratio)
  if (canvas.width !== bitmapSize || canvas.height !== bitmapSize) {
    canvas.width = bitmapSize
    canvas.height = bitmapSize
  }
  const context = canvas.getContext('2d')
  if (!context) return
  context.setTransform(ratio, 0, 0, ratio, 0, 0)
  context.clearRect(0, 0, ringSize, ringSize)
  context.strokeStyle = getComputedStyle(canvas).color
  context.lineWidth = ringWidth

  context.globalAlpha = 0.2
  context.lineCap = 'butt'
  context.beginPath()
  context.arc(ringSize / 2, ringSize / 2, ringRadius, 0, Math.PI * 2)
  context.stroke()

  if (fraction <= 0) return
  context.globalAlpha = 1
  context.lineCap = fraction >= 0.999 ? 'butt' : 'round'
  context.beginPath()
  context.arc(
    ringSize / 2,
    ringSize / 2,
    ringRadius,
    fraction >= 0.999 ? 0 : startAngle,
    fraction >= 0.999 ? Math.PI * 2 : startAngle + Math.PI * 2 * fraction,
  )
  context.stroke()
}

function ProgressRing({ phase, percent, cancelable = false }: {
  phase?: PluginInstallProgress['phase']
  percent?: number
  cancelable?: boolean
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const displayedValueRef = useRef(0)
  const reduceMotion = useReducedMotion()
  const completed = phase === 'completed'
  const downloadProgress = phase === 'downloading' && typeof percent === 'number'
  const downloadFinished = phase === 'verifying'
    || phase === 'installing'
    || phase === 'activating'
    || completed
  const determinate = downloadProgress || downloadFinished
  const value = downloadFinished ? 1 : downloadProgress ? Math.max(0, Math.min(1, percent! / 100)) : 0

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    let animationFrame = 0
    if (!determinate) {
      displayedValueRef.current = 0
      if (reduceMotion) {
        drawProgressRing(canvas, -Math.PI / 2, 0.26)
        return
      }
      const startedAt = performance.now()
      const drawFrame = (now: number) => {
        const rotation = (now - startedAt) / 850 * Math.PI * 2
        drawProgressRing(canvas, -Math.PI / 2 + rotation, 0.26)
        animationFrame = requestAnimationFrame(drawFrame)
      }
      animationFrame = requestAnimationFrame(drawFrame)
      return () => cancelAnimationFrame(animationFrame)
    }

    if (completed && displayedValueRef.current === 0) {
      displayedValueRef.current = 1
      drawProgressRing(canvas, -Math.PI / 2, 1)
      return
    }

    const from = displayedValueRef.current
    const startedAt = performance.now()
    const drawFrame = (now: number) => {
      const elapsed = reduceMotion ? 1 : Math.min(1, (now - startedAt) / 220)
      const eased = 1 - Math.pow(1 - elapsed, 3)
      const displayed = from + (value - from) * eased
      displayedValueRef.current = displayed
      drawProgressRing(canvas, -Math.PI / 2, displayed)
      if (elapsed < 1) animationFrame = requestAnimationFrame(drawFrame)
    }
    animationFrame = requestAnimationFrame(drawFrame)
    return () => cancelAnimationFrame(animationFrame)
  }, [completed, determinate, reduceMotion, value])

  return <span className="relative grid size-[20px] place-items-center text-[#007aff] dark:text-[#0a84ff]" aria-hidden="true">
    <canvas ref={canvasRef} className="absolute inset-0 size-full" />
    {completed
      ? <Check size={10} strokeWidth={2.4} />
      : cancelable ? <span className="size-[5px] rounded-[1px] bg-current" /> : null}
  </span>
}

export function PluginActionButton({ action, progress, busy = false, disabled = false, onStart, onCancel }: Props) {
  const { t } = useTranslation()
  const reduceMotion = useReducedMotion()
  const uninstall = action === 'uninstall'
  const active = !uninstall && (busy || Boolean(progress))
  const cancelable = Boolean(progress?.cancelable)
  const idleLabel = uninstall
    ? t(busy ? 'plugins.uninstalling' : 'plugins.uninstall')
    : t(`plugins.storeAction.${action === 'install' ? 'get' : action}`)
  const statusLabel = progress?.phase === 'downloading' && typeof progress.percent === 'number'
    ? t('plugins.installProgress.downloading', { percent: Math.round(progress.percent) })
    : t(`plugins.installProgress.${progress?.phase || 'preparing'}`)
  const tooltip = active
    ? cancelable ? `${statusLabel} · ${t('plugins.installProgress.cancel')}` : statusLabel
    : undefined

  return <motion.button
      layout="size"
      type="button"
      className={cx(
        'seed-plugin-action-button relative z-20 inline-grid h-[28px] shrink-0 place-items-center overflow-hidden rounded-full border-0 font-medium outline-none',
        uninstall ? 'text-danger' : 'text-[#007aff] dark:text-[#0a84ff]',
        'focus-visible:ring-2 focus-visible:ring-[#007aff]/35 focus-visible:ring-offset-2 focus-visible:ring-offset-background dark:focus-visible:ring-[#0a84ff]/35',
        active
          ? 'w-[28px] min-w-[28px] bg-transparent p-0 hover:bg-transparent'
          : 'min-w-[64px] bg-[rgba(120,120,128,0.12)] px-4 hover:bg-[rgba(120,120,128,0.12)]',
        (disabled || (uninstall && busy)) && !active && 'cursor-default opacity-55',
        disabled && !active && 'text-muted-foreground',
        active && !cancelable && 'cursor-default',
      )}
      disabled={disabled || (uninstall && busy) || (active && !cancelable)}
      aria-label={active ? tooltip : idleLabel}
      aria-live="polite"
      onClick={(event) => {
        event.stopPropagation()
        if (active) {
          if (cancelable) onCancel?.()
          return
        }
        onStart()
      }}
      transition={{ layout: { duration: reduceMotion ? 0 : 0.22, ease: layoutEase } }}
      whileTap={!reduceMotion && !disabled && !(uninstall && busy) && (!active || cancelable) ? { scale: 0.94 } : undefined}
    >
      <AnimatePresence initial={false} mode="popLayout">
        {active
          ? <motion.span
              key="progress"
              initial={reduceMotion ? false : { opacity: 0, scale: 0.78 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={reduceMotion ? undefined : { opacity: 0, scale: 0.78 }}
              transition={{ duration: reduceMotion ? 0 : 0.16 }}
            >
              <ProgressRing phase={progress?.phase} percent={progress?.percent} cancelable={progress?.cancelable} />
            </motion.span>
          : <motion.span
              key="label"
              className="whitespace-nowrap text-[13px] leading-none"
              initial={reduceMotion ? false : { opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={reduceMotion ? undefined : { opacity: 0, scale: 0.9 }}
              transition={{ duration: reduceMotion ? 0 : 0.14 }}
            >{idleLabel}</motion.span>}
      </AnimatePresence>
    </motion.button>
}
