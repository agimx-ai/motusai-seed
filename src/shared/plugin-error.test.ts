import { describe, expect, it } from 'vitest'
import { pluginErrorBilling, pluginErrorCode, pluginErrorParams } from './plugin-error'

describe('plugin error code', () => {
  it('normalizes native platform codes for the public audit contract', () => {
    expect(pluginErrorCode({ code: 'EPERM' })).toBe('eperm')
    expect(pluginErrorCode({ code: ' capability_denied ' })).toBe('capability_denied')
  })

  it('omits non-string and invalid error codes', () => {
    expect(pluginErrorCode({ code: 13 })).toBeUndefined()
    expect(pluginErrorCode({ code: 'not allowed' })).toBeUndefined()
    expect(pluginErrorCode(new Error('failure'))).toBeUndefined()
  })
})

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

  it('copies only valid billing fields, preserving confirmed zero and uncertainty', () => {
    for (const complete of [true, false]) {
      const billing = { version: 1, complete, charges: [{ call_id: 'zero', charged_amount: 0, secret: 'discard' }], secret: 'discard' }
      expect(structuredClone(pluginErrorBilling({ billing }))).toEqual({ version: 1, complete,
        charges: [{ call_id: 'zero', charged_amount: 0 }] })
    }
    expect(pluginErrorBilling({ billing: { version: 1, complete: true, charges: [] } })).toEqual({ version: 1, complete: true, charges: [] })
  })

  it.each([undefined, {}, { version: 2, complete: true, charges: [] },
    { version: 1, complete: 'true', charges: [] },
    ...[-1, NaN, Infinity, 0.001, '0'].map((charged_amount) => ({ version: 1, complete: true, charges: [{ call_id: 'bad', charged_amount }] })),
    { version: 1, complete: true, charges: [{ call_id: '', charged_amount: 0 }] },
  ])('does not turn invalid or missing billing into free usage: %j', (billing) => {
    expect(pluginErrorBilling({ billing })).toBeUndefined()
  })
})
