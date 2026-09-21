import { describe, expect, it } from 'vitest'
import type { SeedSnapshot } from '../../shared/contracts'
import { companionInteraction, companionPresentation } from './companion'

function snapshot(
  audioState: SeedSnapshot['audio']['state'],
  mascotState: SeedSnapshot['mascot']['state'] = 'running',
  activeTaskCount = 0,
) {
  return {
    audio: { state: audioState, durationMs: 0 },
    mascot: { state: mascotState, changedAt: '2026-08-27T00:00:00.000Z', activeTaskCount },
  } satisfies Pick<SeedSnapshot, 'audio' | 'mascot'>
}

describe('companion presentation', () => {
  it.each([
    ['starting', 'listening', 'preparingRecording'],
    ['recording', 'listening', 'listening'],
    ['paused', 'paused', 'recordingPaused'],
    ['stopping', 'processing', 'processingRecording'],
    ['failed', 'failed', 'recordingFailed'],
  ] as const)('gives audio state %s priority over the generic task state', (audioState, state, copyKey) => {
    expect(companionPresentation(snapshot(audioState))).toEqual({ state, copyKey })
  })

  it('returns to the generic task presentation when audio is idle', () => {
    expect(companionPresentation(snapshot('idle', 'review'))).toEqual({ state: 'review', copyKey: 'review' })
  })

  it('summarizes concurrent generic tasks without changing the running pose', () => {
    expect(companionPresentation(snapshot('idle', 'running', 3)))
      .toEqual({ state: 'running', copyKey: 'runningMultiple', count: 3 })
  })

  it('keeps the seated working pose while summarizing sustained concurrent tasks', () => {
    expect(companionPresentation(snapshot('idle', 'working', 3)))
      .toEqual({ state: 'working', copyKey: 'workingMultiple', count: 3 })
  })

  it('keeps listening primary and reports other work during recording', () => {
    expect(companionPresentation(snapshot('recording', 'running', 2)))
      .toEqual({ state: 'listening', copyKey: 'listeningWithTasks', count: 2 })
  })

  it('does not count the stop invocation itself as another task', () => {
    expect(companionPresentation(snapshot('stopping', 'running', 1)))
      .toEqual({ state: 'processing', copyKey: 'processingRecording' })
  })

  it('reports unrelated work while a recording is stopping', () => {
    expect(companionPresentation(snapshot('stopping', 'running', 3)))
      .toEqual({ state: 'processing', copyKey: 'processingRecordingWithTasks', count: 2 })
  })
})

describe('companion interaction', () => {
  it('cycles playful idle reactions', () => {
    expect([0, 1, 2, 3].map((sequence) => companionInteraction('idle', sequence)))
      .toEqual(['surprise', 'wave', 'sprout', 'surprise'])
  })

  it.each([
    ['working', 'acknowledge'],
    ['listening', 'heart'],
    ['paused', 'heart'],
    ['waiting', 'point'],
    ['failed', 'comfort'],
  ] as const)('uses the %s-aware reaction', (state, interaction) => {
    expect(companionInteraction(state, 0)).toBe(interaction)
  })
})
