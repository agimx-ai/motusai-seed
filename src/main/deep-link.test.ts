import { describe, expect, it } from 'vitest'
import { createSeedDeepLink } from '@motusai/seed-sdk'
import { parseSeedDeepLink, seedDeepLinkFromArguments } from './deep-link'

describe('Seed deep links', () => {
  it('round-trips a registered navigation target through the public SDK', () => {
    const deepLink = createSeedDeepLink({ destination: 'plugins', query: 'com.motusai.seed.agent-harness' })
    expect(deepLink).toBe('motusai-seed://open/plugins?query=com.motusai.seed.agent-harness')
    expect(parseSeedDeepLink(deepLink)).toEqual({
      destination: 'plugins',
      query: 'com.motusai.seed.agent-harness',
    })
  })

  it('opens a registered destination without destination-specific parameters', () => {
    expect(parseSeedDeepLink('motusai-seed://open/plugins')).toEqual({ destination: 'plugins' })
  })

  it('opens a plugin detail target', () => {
    const deepLink = createSeedDeepLink({ destination: 'plugins', pluginId: 'com.motusai.seed.agent-harness' })
    expect(deepLink).toBe('motusai-seed://open/plugins?pluginId=com.motusai.seed.agent-harness')
    expect(parseSeedDeepLink(deepLink)).toEqual({
      destination: 'plugins',
      pluginId: 'com.motusai.seed.agent-harness',
    })
  })

  it('rejects unsupported or unsafe routes', () => {
    expect(parseSeedDeepLink('motusai-seed://install/plugins?query=anything')).toBeNull()
    expect(parseSeedDeepLink('motusai-seed://open/settings')).toBeNull()
    expect(parseSeedDeepLink('https://open/plugins?query=anything')).toBeNull()
    expect(parseSeedDeepLink('motusai-seed://user@open/plugins')).toBeNull()
  })

  it('finds a deep link in application arguments', () => {
    expect(seedDeepLinkFromArguments(['MotusAI Seed', '--flag', 'motusai-seed://open/plugins?query=agent-harness']))
      .toEqual({ destination: 'plugins', query: 'agent-harness' })
  })
})
