import { describe, expect, it } from 'vitest'
import { pluginAuditRecordSchema, seedCatalogResponseSchema, serverUrlSchema } from './validation'

describe('serverUrlSchema', () => {
  it('normalizes trailing slashes', () => {
    expect(serverUrlSchema.parse('https://agent.example.com/agent///')).toBe('https://agent.example.com/agent')
  })

  it.each(['file:///tmp/server', 'https://user:password@example.com', 'https://example.com?a=1'])('rejects unsafe URL %s', (url) => {
    expect(() => serverUrlSchema.parse(url)).toThrow()
  })
})

describe('pluginAuditRecordSchema', () => {
  it('accepts the bounded plugin activity fields exposed by the SDK', () => {
    expect(pluginAuditRecordSchema.parse({
      operation: 'conversation.completed',
      outcome: 'allowed',
      visibility: 'technical',
      run_id: 'run-test',
      metadata: { workspace_id: 'vault-test', duration_ms: 123, input_length: 10, output_length: 20 },
    })).toMatchObject({ operation: 'conversation.completed', outcome: 'allowed', visibility: 'technical' })
  })

  it('rejects arbitrary metadata and unbounded identifiers', () => {
    expect(() => pluginAuditRecordSchema.parse({ operation: 'conversation.completed', outcome: 'allowed', metadata: { prompt: 'secret' } })).toThrow()
    expect(() => pluginAuditRecordSchema.parse({ operation: '../conversation', outcome: 'allowed' })).toThrow()
  })
})

describe('seedCatalogResponseSchema', () => {
  it('accepts capabilities exposed to other plugins', () => {
    const capability = {
      id: 'agent_sessions',
      version: 1,
      exposure: 'plugin',
      methods: [{ name: 'sessions.open', risk: 'write' }],
    }
    const response = {
      items: [{
        plugin_id: 'com.example.agent',
        visibility: 'public',
        organization: null,
        name: { en_US: 'Agent', zh_Hans: '智能体' },
        description: { en_US: 'Agent provider', zh_Hans: '智能体提供方' },
        readme: { en_US: '# Agent', zh_Hans: '# 智能体' },
        labels: ['utilities'],
        publisher_id: 'com.example',
        publisher_type: 'official',
        latest_version: '0.1.57',
        package_sha256: 'a'.repeat(64),
        package_size: 1024,
        api_version: '1',
        min_seed_version: '0.1.67',
        runtime_kind: 'native-host',
        permissions: ['network.connect.internet'],
        capabilities: [capability],
        compatible: true,
        published_at: '2026-09-12T00:00:00.000Z',
        icon_url: null,
        icon_dark_url: null,
        download_url: '/api/v1/catalog/example/plugins/com.example.agent/download',
        platform: 'darwin',
        architecture: 'arm64',
      }],
      next_cursor: null,
    }
    expect(seedCatalogResponseSchema.parse(response).items[0]).toMatchObject({
      readme: { en_US: '# Agent', zh_Hans: '# 智能体' },
      capabilities: [{ exposure: 'plugin' }],
    })
    expect(seedCatalogResponseSchema.parse({
      ...response,
      items: [{ ...response.items[0], min_seed_version: null, compatible: false }],
    }).items[0]).toMatchObject({ minSeedVersion: null, compatible: false })
    const enterprise = {
      ...response,
      items: [{ ...response.items[0], visibility: 'organization', organization: { id: '091f5d72-686a-49e4-bd26-908524af83c3', name: 'Sinno' } }],
    }
    expect(seedCatalogResponseSchema.parse(enterprise).items[0]).toMatchObject({
      organization: { name: 'Sinno' },
    })
    expect(seedCatalogResponseSchema.safeParse({
      ...enterprise,
      items: [{ ...enterprise.items[0], organization: null }],
    }).success).toBe(false)
  })
})
