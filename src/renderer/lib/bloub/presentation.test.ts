import { describe, expect, it } from 'vitest'
import { bloubStateForPresentation } from './presentation'

describe('Bloub presentation mapping', () => {
  it.each([
    ['idle', 'idle'], ['running', 'play'], ['working', 'thinking'], ['waiting', 'notify'], ['review', 'wink'],
    ['failed', 'exclaim'], ['listening', 'wide'], ['paused', 'sleep'], ['processing', 'swirl'],
  ] as const)('maps %s to the Bloub %s state', (state, expected) => {
    expect(bloubStateForPresentation(state)).toBe(expected)
  })

  it('uses a temporary Bloub reaction without changing the framework state', () => {
    expect(bloubStateForPresentation('working', 'surprise')).toBe('wide')
  })
})
