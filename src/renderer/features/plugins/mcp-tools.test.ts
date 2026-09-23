import { describe, expect, it } from 'vitest'
import type { SeedInstalledPlugin } from '../../../shared/contracts'
import { pluginMcpTools } from './mcp-tools'

describe('pluginMcpTools', () => {
  it('only lists methods explicitly exposed as MCP tools', () => {
    const plugin = {
      capabilities: [{
        id: 'web.search',
        methods: [
          { name: 'search', annotations: { 'mcp.tool': true, 'mcp.tool_name': 'web_search' } },
          { name: 'read', annotations: { 'mcp.tool': true } },
          { name: 'internal', annotations: { 'agent.tool': true } },
        ],
      }],
    } as unknown as Pick<SeedInstalledPlugin, 'capabilities'>

    expect(pluginMcpTools(plugin)).toEqual(['web_search', 'read'])
  })
})
