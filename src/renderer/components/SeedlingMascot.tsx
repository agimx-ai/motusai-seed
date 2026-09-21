import { useEffect, useId, useRef, useState } from 'react'
import { buildConfig } from '../../shared/build-config.generated'
import { companionInteraction, type CompanionInteraction, type CompanionVisualState } from '../lib/companion'
import { NOTIF_BLUE, type DotRender } from '../lib/bloub/decor'
import { BotEngine, type BotFrame } from '../lib/bloub/engine'
import { bloubStateForPresentation } from '../lib/bloub/presentation'
import { DEMI_VIEWBOX, RAYON } from '../lib/bloub/repere'
import { mixHex } from '../lib/bloub/skins'
import { POSES } from '../lib/bloub/states'

type SeedlingMascotProps = {
  state: CompanionVisualState
  label: string
}

type ActiveInteraction = { name: CompanionInteraction; id: number }
type Palette = { ink: string; paper: string }

const LIGHT_PALETTE: Palette = { ink: buildConfig.mascotColorLight, paper: '#ffffff' }
const DARK_PALETTE: Palette = { ink: buildConfig.mascotColorDark, paper: '#171717' }

function currentPalette(): Palette {
  return document.documentElement.dataset.theme === 'dark' ? DARK_PALETTE : LIGHT_PALETTE
}

function usePalette() {
  const [palette, setPalette] = useState(currentPalette)
  useEffect(() => {
    const observer = new MutationObserver(() => setPalette(currentPalette()))
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
    return () => observer.disconnect()
  }, [])
  return palette
}

function useReducedMotion() {
  const isReduced = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches
    || document.documentElement.dataset.reducedMotion === 'true'
  const [reduced, setReduced] = useState(isReduced)
  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)')
    const update = () => setReduced(isReduced())
    query.addEventListener('change', update)
    return () => query.removeEventListener('change', update)
  }, [])
  return reduced
}

function dotElement(dot: DotRender, key: string, ink: string, paper: string) {
  const fill = dot.color ?? (dot.depth === undefined ? ink : mixHex(paper, ink, dot.depth))
  return dot.d
    ? <path key={key} d={dot.d} fill={fill} opacity={dot.opacity} transform={`translate(${dot.x} ${dot.y}) rotate(${dot.rot ?? 0}) scale(${RAYON})`} />
    : <circle key={key} cx={dot.x} cy={dot.y} r={dot.r} fill={fill} opacity={dot.opacity} />
}

export function SeedlingMascot({ state, label }: SeedlingMascotProps) {
  const [interaction, setInteraction] = useState<ActiveInteraction | null>(null)
  const targetState = bloubStateForPresentation(state, interaction?.name)
  const reducedMotion = useReducedMotion()
  const { ink, paper } = usePalette()
  const engineRef = useRef<BotEngine | null>(null)
  if (!engineRef.current) engineRef.current = new BotEngine(RAYON, targetState)
  const engine = engineRef.current
  const clock = useRef(0)
  const lastFrameAt = useRef(0)
  const [frame, setFrame] = useState<BotFrame>(() => engine.sample(0))
  const sequence = useRef(0)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const uid = useId().replace(/:/g, '')
  const maskId = `bloub-mask-${uid}`

  useEffect(() => {
    engine.setState(targetState, clock.current)
    if (reducedMotion) {
      const readableTime = targetState === 'burst' ? 2.25 : POSES[targetState]
      setFrame(new BotEngine(RAYON, targetState).sample(readableTime))
    }
  }, [engine, reducedMotion, targetState])

  useEffect(() => {
    if (reducedMotion) return
    let raf = 0
    const tick = (now: number) => {
      const delta = lastFrameAt.current ? Math.min((now - lastFrameAt.current) / 1000, 0.064) : 0
      lastFrameAt.current = now
      clock.current += delta
      setFrame(engine.sample(clock.current))
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => {
      cancelAnimationFrame(raf)
      lastFrameAt.current = 0
    }
  }, [engine, reducedMotion])

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current)
  }, [])

  const interact = () => {
    const name = companionInteraction(state, sequence.current)
    sequence.current += 1
    setInteraction({ name, id: sequence.current })
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => {
      timer.current = null
      setInteraction(null)
    }, 1150)
  }

  const rearDots = frame.dotsBehind ? frame.dots : []
  const frontDots = frame.dotsBehind ? [] : frame.dots

  return <button type="button" className="seedling-mascot-button" aria-label={label} onClick={interact}>
    <span className="bloub-mascot-frame">
      <svg
        className="bloub-mascot"
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
    </span>
  </button>
}
