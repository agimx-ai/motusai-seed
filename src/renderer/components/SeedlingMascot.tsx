import { useEffect, useRef, useState } from 'react'
import { Companion, type Look } from '@motus-ai/seed-sdk/companion'
import { buildConfig } from '../../shared/build-config.generated'
import { companionInteraction, type CompanionInteraction, type CompanionVisualState } from '../lib/companion'
import { useReducedMotion } from '../hooks/use-reduced-motion'
import { bloubStateForPresentation } from '../lib/bloub/presentation'

type SeedlingMascotProps = {
  state: CompanionVisualState
  label: string
  look?: Look | null
  idleAnimation?: 'wink'
  onInteractionChange?: (active: boolean) => void
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

export function SeedlingMascot({ state, label, look, idleAnimation, onInteractionChange }: SeedlingMascotProps) {
  const [interaction, setInteraction] = useState<ActiveInteraction | null>(null)
  const reducedMotion = useReducedMotion()
  const idleOverlay = state === 'idle' && !interaction && !reducedMotion
  const targetState = idleOverlay && idleAnimation ? idleAnimation : bloubStateForPresentation(state, interaction?.name)
  const { ink, paper } = usePalette()
  const sequence = useRef(0)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    onInteractionChange?.(interaction !== null)
  }, [interaction, onInteractionChange])

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

  return <button type="button" className="seedling-mascot-button" aria-label={label} onClick={interact}>
    <span className="bloub-mascot-frame">
      <Companion
        state={targetState}
        look={idleOverlay ? look : null}
        immediateLookReset={!idleOverlay}
        reducedMotion={reducedMotion}
        ink={ink}
        paper={paper}
        className="bloub-mascot"
      />
    </span>
  </button>
}
