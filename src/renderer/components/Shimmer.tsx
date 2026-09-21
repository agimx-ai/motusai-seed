import React, { type ReactNode, useCallback, useEffect, useRef, useState } from 'react'
import { motion, useAnimationFrame, useMotionValue, useReducedMotion, useTransform } from 'motion/react'

interface ShimmerAnimationOptions {
  delay: number
  direction: 'left' | 'right'
  disabled: boolean
  isPaused: boolean
  speed: number
  yoyo: boolean
}

function useShimmerProgress({ delay, direction, disabled, isPaused, speed, yoyo }: ShimmerAnimationOptions) {
  const progress = useMotionValue(0)
  const elapsedRef = useRef(0)
  const lastTimeRef = useRef<number | null>(null)
  const directionRef = useRef(direction === 'left' ? 1 : -1)

  const animationDuration = speed * 1000
  const delayDuration = delay * 1000

  useAnimationFrame((time) => {
    if (disabled || isPaused) {
      lastTimeRef.current = null
      return
    }

    if (lastTimeRef.current === null) {
      lastTimeRef.current = time
      return
    }

    const deltaTime = time - lastTimeRef.current
    lastTimeRef.current = time
    elapsedRef.current += deltaTime

    if (yoyo) {
      const cycleDuration = animationDuration + delayDuration
      const fullCycle = cycleDuration * 2
      const cycleTime = elapsedRef.current % fullCycle

      if (cycleTime < animationDuration) {
        const p = (cycleTime / animationDuration) * 100
        progress.set(directionRef.current === 1 ? p : 100 - p)
      } else if (cycleTime < cycleDuration) {
        progress.set(directionRef.current === 1 ? 100 : 0)
      } else if (cycleTime < cycleDuration + animationDuration) {
        const reverseTime = cycleTime - cycleDuration
        const p = 100 - (reverseTime / animationDuration) * 100
        progress.set(directionRef.current === 1 ? p : 100 - p)
      } else {
        progress.set(directionRef.current === 1 ? 0 : 100)
      }
    } else {
      const cycleDuration = animationDuration + delayDuration
      const cycleTime = elapsedRef.current % cycleDuration

      if (cycleTime < animationDuration) {
        const p = (cycleTime / animationDuration) * 100
        progress.set(directionRef.current === 1 ? p : 100 - p)
      } else {
        progress.set(directionRef.current === 1 ? 100 : 0)
      }
    }
  })

  useEffect(() => {
    directionRef.current = direction === 'left' ? 1 : -1
    elapsedRef.current = 0
    lastTimeRef.current = null
    progress.set(0)
  }, [direction, disabled, progress])

  return progress
}

interface ShimmerTextProps {
  className?: string
  color?: string
  delay?: number
  direction?: 'left' | 'right'
  disabled?: boolean
  pauseOnHover?: boolean
  shineColor?: string
  speed?: number
  spread?: number
  text: string
  yoyo?: boolean
}

export function ShimmerText({
  className = '',
  color = '#b5b5b5',
  delay = 0,
  direction = 'left',
  disabled = false,
  pauseOnHover = false,
  shineColor = '#ffffff',
  speed = 2,
  spread = 120,
  text,
  yoyo = false,
}: ShimmerTextProps) {
  const [isPaused, setIsPaused] = useState(false)
  const progress = useShimmerProgress({ delay, direction, disabled, isPaused, speed, yoyo })
  const backgroundPosition = useTransform(progress, (value) => `${150 - value * 2}% center`)

  const handleMouseEnter = useCallback(() => {
    if (pauseOnHover) setIsPaused(true)
  }, [pauseOnHover])

  const handleMouseLeave = useCallback(() => {
    if (pauseOnHover) setIsPaused(false)
  }, [pauseOnHover])

  const gradientStyle: React.CSSProperties = {
    backgroundImage: `linear-gradient(${spread}deg, ${color} 0%, ${color} 35%, ${shineColor} 50%, ${color} 65%, ${color} 100%)`,
    backgroundSize: '200% auto',
    WebkitBackgroundClip: 'text',
    backgroundClip: 'text',
    WebkitTextFillColor: 'transparent',
  }

  return (
    <motion.span
      className={`inline-block ${className}`}
      style={{ ...gradientStyle, backgroundPosition }}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      {text}
    </motion.span>
  )
}

interface ShimmerIconProps {
  baseClassName?: string
  children: ReactNode
  className?: string
  delay?: number
  direction?: 'left' | 'right'
  disabled?: boolean
  overlayClassName?: string
  shineColor?: string
  speed?: number
}

export function ShimmerIcon({
  baseClassName = '',
  children,
  className = '',
  delay = 1.2,
  direction = 'left',
  disabled = false,
  overlayClassName = '',
  shineColor = '#ffffff',
  speed = 1,
}: ShimmerIconProps) {
  const shouldReduceMotion = useReducedMotion()
  const animationDisabled = disabled || Boolean(shouldReduceMotion)
  const progress = useShimmerProgress({
    delay,
    direction,
    disabled: animationDisabled,
    isPaused: false,
    speed,
    yoyo: false,
  })
  const maskPosition = useTransform(progress, (value) => `${150 - value * 2}% center`)
  const maskImage = 'linear-gradient(105deg, transparent 35%, #000 48%, #000 52%, transparent 65%)'

  return (
    <span className={`relative inline-flex ${className}`} aria-hidden>
      <span className={`inline-flex ${animationDisabled ? '' : baseClassName}`}>
        {children}
      </span>
      {!animationDisabled ? (
        <motion.span
          className={`pointer-events-none absolute inset-0 inline-flex ${overlayClassName}`}
          style={{
            color: shineColor,
            maskImage,
            maskPosition,
            maskRepeat: 'no-repeat',
            maskSize: '200% auto',
            WebkitMaskImage: maskImage,
            WebkitMaskPosition: maskPosition,
            WebkitMaskRepeat: 'no-repeat',
            WebkitMaskSize: '200% auto',
          }}
        >
          {children}
        </motion.span>
      ) : null}
    </span>
  )
}
