import type { MascotState, SeedSnapshot } from '../../shared/contracts'

export type CompanionVisualState = MascotState | 'listening' | 'paused' | 'processing'
export type CompanionInteraction = 'surprise' | 'wave' | 'sprout' | 'acknowledge' | 'heart' | 'point' | 'comfort'
export type CompanionCopyKey = MascotState
  | 'runningMultiple'
  | 'workingMultiple'
  | 'waitingWithTasks'
  | 'preparingRecording'
  | 'listening'
  | 'listeningWithTasks'
  | 'recordingPaused'
  | 'recordingPausedWithTasks'
  | 'processingRecording'
  | 'processingRecordingWithTasks'
  | 'recordingFailed'
  | 'recordingFailedWithTasks'

type CompanionSnapshot = Pick<SeedSnapshot, 'audio' | 'mascot'>
export type CompanionPresentation = {
  state: CompanionVisualState
  copyKey: CompanionCopyKey
  count?: number
}

const playfulInteractions = ['surprise', 'wave', 'sprout'] as const

export function companionInteraction(state: CompanionVisualState, sequence: number): CompanionInteraction {
  if (state === 'listening' || state === 'paused') return 'heart'
  if (state === 'waiting') return 'point'
  if (state === 'failed') return 'comfort'
  if (state === 'running' || state === 'working' || state === 'processing') return 'acknowledge'
  return playfulInteractions[sequence % playfulInteractions.length]
}

export function companionPresentation(snapshot: CompanionSnapshot): CompanionPresentation {
  const activeCount = snapshot.mascot.activeTaskCount
  switch (snapshot.audio.state) {
    case 'starting': return { state: 'listening', copyKey: 'preparingRecording' }
    case 'recording': return activeCount > 0
      ? { state: 'listening', copyKey: 'listeningWithTasks', count: activeCount }
      : { state: 'listening', copyKey: 'listening' }
    case 'paused': return activeCount > 0
      ? { state: 'paused', copyKey: 'recordingPausedWithTasks', count: activeCount }
      : { state: 'paused', copyKey: 'recordingPaused' }
    case 'stopping': {
      const otherTaskCount = Math.max(0, activeCount - 1)
      return otherTaskCount > 0
        ? { state: 'processing', copyKey: 'processingRecordingWithTasks', count: otherTaskCount }
        : { state: 'processing', copyKey: 'processingRecording' }
    }
    case 'failed': return activeCount > 0
      ? { state: 'failed', copyKey: 'recordingFailedWithTasks', count: activeCount }
      : { state: 'failed', copyKey: 'recordingFailed' }
  }

  if (snapshot.mascot.state === 'running' && activeCount > 1) {
    return { state: 'running', copyKey: 'runningMultiple', count: activeCount }
  }
  if (snapshot.mascot.state === 'working' && activeCount > 1) {
    return { state: 'working', copyKey: 'workingMultiple', count: activeCount }
  }
  if (snapshot.mascot.state === 'waiting' && activeCount > 1) {
    return { state: 'waiting', copyKey: 'waitingWithTasks', count: activeCount - 1 }
  }
  return { state: snapshot.mascot.state, copyKey: snapshot.mascot.state }
}
