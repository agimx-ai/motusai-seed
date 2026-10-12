import { describe, expect, it } from 'vitest'
import { pluginErrorParams } from './plugin-error'

describe('plugin error parameters', () => {
  it('preserves SDK scalar parameters and excludes non-contract values', () => {
    const error = Object.assign(new Error('failure'), {
      params: { detail: 'permission denied', count: 2, retry: false, nested: {}, callback: () => null },
    })
    expect(structuredClone(pluginErrorParams(error))).toEqual({ detail: 'permission denied', count: 2, retry: false })
  })
  it('does not invent parameters for ordinary errors', () => {
    expect(pluginErrorParams(new Error('failure'))).toBeUndefined()
    expect(pluginErrorParams(null)).toBeUndefined()
    expect(pluginErrorParams({ params: [] })).toBeUndefined()
  })
})
