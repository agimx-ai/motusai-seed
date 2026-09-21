import { describe, expect, it } from 'vitest'
import { initials } from './display'

describe('initials', () => {
  it('uses one CJK character for a fallback avatar', () => {
    expect(initials('杜志军')).toBe('杜')
  })

  it('uses one character for a Latin fallback avatar', () => {
    expect(initials('MotusAI')).toBe('M')
  })

})
