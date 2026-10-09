import { describe, expect, it } from 'vitest'
import { scrollEdges } from './scroll-edges'

describe('scrollEdges', () => {
  it.each([
    [0, 200, 320, false, false],
    [0, 320, 320, false, false],
    [0, 600, 320, false, true],
    [100, 600, 320, true, true],
    [280, 600, 320, true, false],
    [279.5, 600, 320, true, false],
    [-10, 600, 320, false, true],
  ])('detects hidden content at offset %s / height %s / viewport %s', (scrollTop, scrollHeight, clientHeight, top, bottom) => {
    expect(scrollEdges({ scrollTop, scrollHeight, clientHeight })).toEqual({ top, bottom })
  })
})
