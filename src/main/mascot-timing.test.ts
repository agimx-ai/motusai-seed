import { describe, expect, it } from 'vitest'
import { mascotStateAfterUserInteraction, mascotTiming, remainingMascotRunningMs } from './mascot-timing'

describe('mascot timing', () => {
  it('keeps a fast client invocation visible for two seconds', () => {
    expect(remainingMascotRunningMs(1_000, 1_250)).toBe(1_750)
  })

  it('does not delay the terminal state after a longer invocation', () => {
    expect(remainingMascotRunningMs(1_000, 3_500)).toBe(0)
  })

  it('uses the intended completion and failure reaction durations', () => {
    expect(mascotTiming).toEqual({ minimumRunningMs: 2_000, workingTransitionMs: 850, reviewMs: 1_500, failedMs: 3_000 })
  })

  it('leaves the waiting state after user interaction finishes', () => {
    expect(mascotStateAfterUserInteraction(0)).toBe('idle')
    expect(mascotStateAfterUserInteraction(1)).toBe('working')
  })
})
