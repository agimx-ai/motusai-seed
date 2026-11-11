import { useEffect, useId, useRef, useState } from 'react'
import { NOTIF_BLUE, type DotRender } from './decor.js'
import { BotEngine, type Look } from './engine.js'
import { EXPRESSIONS, type ExpressionId } from './expressions.js'
import { DEMI_VIEWBOX, RAYON } from './repere.js'
import { mixHex } from './skins.js'
import { POSES, type StateId } from './states.js'

export type CompanionProps = {
  state?: StateId
  expression?: ExpressionId
  look?: Look | null
  immediateLookReset?: boolean
  reducedMotion?: boolean
  ink: string
  paper: string
  className?: string
}

function dotElement(dot: DotRender, key: string, ink: string, paper: string) {
  const fill = dot.color ?? (dot.depth === undefined ? ink : mixHex(paper, ink, dot.depth))
  return dot.d
    ? <path key={key} d={dot.d} fill={fill} opacity={dot.opacity} transform={`translate(${dot.x} ${dot.y}) rotate(${dot.rot ?? 0}) scale(${RAYON})`} />
    : <circle key={key} cx={dot.x} cy={dot.y} r={dot.r} fill={fill} opacity={dot.opacity} />
}

const motionQuery = '(prefers-reduced-motion: reduce)'

function useSystemReducedMotion(override: boolean | undefined) {
  const [system, setSystem] = useState(() => typeof window !== 'undefined' && Boolean(window.matchMedia?.(motionQuery).matches))
  useEffect(() => {
    if (override !== undefined) return
    const media = window.matchMedia?.(motionQuery)
    if (!media) return
    const update = () => setSystem(media.matches)
    media.addEventListener('change', update)
    update()
    return () => media.removeEventListener('change', update)
  }, [override])
  return override ?? system
}

export function Companion({
  state = 'idle', expression, look, immediateLookReset = false, reducedMotion, ink, paper, className,
}: CompanionProps) {
  const reduce = useSystemReducedMotion(reducedMotion)
  const face = expression ? EXPRESSIONS.find((item) => item.id === expression) ?? null : null
  const [engine] = useState(() => new BotEngine(RAYON, state, null, face))
  const [frame, setFrame] = useState(() => engine.sample(0))
  const clock = useRef(0)
  const directedLook = useRef(false)
  const uid = useId().replace(/:/g, '')
  const maskId = `bloub-mask-${uid}`

  useEffect(() => {
    if (look) {
      engine.setLook(look, clock.current)
      directedLook.current = true
    } else if (directedLook.current) {
      engine.setLook(null, clock.current - (immediateLookReset ? BotEngine.LOOK_MORPH : 0))
      directedLook.current = false
    }
    engine.setExpression(face, clock.current)
    engine.setState(state, clock.current)
  }, [engine, face, immediateLookReset, look, state])

  useEffect(() => {
    if (!reduce) return
    if (face) clock.current += BotEngine.SHAPE_MORPH
    const readableTime = state === 'burst' ? 2.25 : POSES[state]
    setFrame(new BotEngine(RAYON, state, null, face).sample(readableTime))
  }, [face, reduce, state])

  useEffect(() => {
    if (reduce) return
    let request: number | undefined
    let previous: number | undefined

    function stop() {
      if (request !== undefined) cancelAnimationFrame(request)
      request = undefined
      previous = undefined
    }

    function tick(now: number) {
      request = undefined
      if (document.hidden) {
        previous = undefined
        return
      }
      clock.current += previous === undefined ? 0 : Math.max(0, Math.min((now - previous) / 1000, 0.064))
      previous = now
      setFrame(engine.sample(clock.current))
      request = requestAnimationFrame(tick)
    }

    function reconcile() {
      stop()
      if (!document.hidden) request = requestAnimationFrame(tick)
    }

    document.addEventListener('visibilitychange', reconcile)
    reconcile()
    return () => {
      stop()
      document.removeEventListener('visibilitychange', reconcile)
    }
  }, [engine, reduce])

  const rearDots = frame.dotsBehind ? frame.dots : []
  const frontDots = frame.dotsBehind ? [] : frame.dots
  return (
    <svg
      className={className}
      viewBox={`${-DEMI_VIEWBOX} ${-DEMI_VIEWBOX} ${DEMI_VIEWBOX * 2} ${DEMI_VIEWBOX * 2}`}
      focusable="false"
      aria-hidden="true"
    >
      <defs>
        <mask id={maskId} maskUnits="userSpaceOnUse" x={-DEMI_VIEWBOX} y={-DEMI_VIEWBOX} width={DEMI_VIEWBOX * 2} height={DEMI_VIEWBOX * 2}>
          <path d={frame.bodyPath} fill="#fff" />
          {frame.eyes.map((eye, index) => <path key={index} d={eye.d} transform={eye.matrix} opacity={eye.alpha} fill="#000" />)}
          {frame.notch && <circle cx={frame.notch.x} cy={frame.notch.y} r={frame.notch.r} fill="#000" />}
        </mask>
        {frame.arcs.map((arc) => <linearGradient
          id={`${uid}-${arc.id}`}
          key={arc.id}
          gradientUnits="userSpaceOnUse"
          x1={arc.grad.x1}
          y1={arc.grad.y1}
          x2={arc.grad.x2}
          y2={arc.grad.y2}
        >
          {arc.grad.stops.map((color, index) => <stop key={index} offset={index / (arc.grad.stops.length - 1)} stopColor={color} />)}
        </linearGradient>)}
      </defs>

      <g fill="none" strokeLinecap="round">
        {frame.arcs.map((arc) => <path key={`back-${arc.id}`} d={arc.back} stroke={`url(#${uid}-${arc.id})`} strokeWidth={arc.width} opacity={arc.opacity} />)}
      </g>
      <g>{rearDots.map((dot, index) => dotElement(dot, `rear-${index}`, ink, paper))}</g>
      <g opacity={frame.bodyAlpha}>
        <path d={frame.bodyPath} fill={paper} />
        <g mask={`url(#${maskId})`}>
          <rect x={-DEMI_VIEWBOX} y={-DEMI_VIEWBOX} width={DEMI_VIEWBOX * 2} height={DEMI_VIEWBOX * 2} fill={ink} />
        </g>
      </g>
      <g>{frontDots.map((dot, index) => dotElement(dot, `front-${index}`, ink, paper))}</g>
      {frame.notif && <circle cx={frame.notif.x} cy={frame.notif.y} r={frame.notif.r} fill={NOTIF_BLUE} />}
      <g fill="none" strokeLinecap="round">
        {frame.arcs.map((arc) => <path key={`front-${arc.id}`} d={arc.front} stroke={`url(#${uid}-${arc.id})`} strokeWidth={arc.width} opacity={arc.opacity} />)}
      </g>
    </svg>
  )
}
