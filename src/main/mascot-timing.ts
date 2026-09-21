export const mascotTiming = {
  minimumRunningMs: 2000,
  workingTransitionMs: 850,
  reviewMs: 1500,
  failedMs: 3000,
} as const

export function remainingMascotRunningMs(startedAt: number | undefined, now = Date.now()) {
  if (startedAt === undefined) return 0
  return Math.max(0, mascotTiming.minimumRunningMs - (now - startedAt))
}

export function mascotStateAfterUserInteraction(activeTaskCount: number): 'working' | 'idle' {
  return activeTaskCount > 0 ? 'working' : 'idle'
}
