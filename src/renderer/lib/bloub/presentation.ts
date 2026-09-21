import type { CompanionInteraction, CompanionVisualState } from '../companion'
import type { StateId } from './states'

const visualStates: Record<CompanionVisualState, StateId> = {
  idle: 'idle', running: 'play', working: 'thinking', waiting: 'notify', review: 'wink', failed: 'exclaim',
  listening: 'wide', paused: 'sleep', processing: 'swirl',
}

const interactionStates: Record<CompanionInteraction, StateId> = {
  surprise: 'wide', wave: 'wink', sprout: 'burst', acknowledge: 'wink', heart: 'notify', point: 'alert', comfort: 'egg',
}

export function bloubStateForPresentation(state: CompanionVisualState, interaction?: CompanionInteraction): StateId {
  return interaction ? interactionStates[interaction] : visualStates[state]
}
