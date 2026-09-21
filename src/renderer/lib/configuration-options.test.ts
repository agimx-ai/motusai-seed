import { describe, expect, it } from 'vitest'
import { configurationOptionDisplayLabel } from './configuration-options'

describe('configuration option display labels', () => {
  it('hides a duplicated machine value from a human-readable label', () => {
    expect(configurationOptionDisplayLabel({
      value: 'com.motusai.seed.agent-harness',
      label: 'Agent Harness (com.motusai.seed.agent-harness)',
    })).toBe('Agent Harness')
    expect(configurationOptionDisplayLabel({ value: 'provider-one', label: '服务商（provider-one）' })).toBe('服务商')
  })

  it('preserves labels that do not merely repeat the option value', () => {
    expect(configurationOptionDisplayLabel({ value: 'cn', label: '中国（大陆）' })).toBe('中国（大陆）')
  })
})
