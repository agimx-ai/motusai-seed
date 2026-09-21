import { describe, expect, it } from 'vitest'
import { compareSeedVersions } from './seed-version'

describe('compareSeedVersions', () => {
  it('compares numeric components instead of sorting text', () => {
    expect(compareSeedVersions('0.1.10', '0.1.9')).toBe(1)
    expect(compareSeedVersions('0.1.67', '0.1.67')).toBe(0)
    expect(compareSeedVersions('0.1.66', '0.1.67')).toBe(-1)
  })

  it('orders prereleases below final versions', () => {
    expect(compareSeedVersions('0.1.67-beta.2', '0.1.67-beta.10')).toBe(-1)
    expect(compareSeedVersions('0.1.67-beta.10', '0.1.67')).toBe(-1)
    expect(compareSeedVersions('0.1.67-beta-1', '0.1.67-beta-2')).toBe(-1)
  })
})
