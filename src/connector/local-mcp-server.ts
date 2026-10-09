import { randomUUID } from 'node:crypto'
import { createMcpHandler, McpServer } from '@modelcontextprotocol/server'
import { z } from 'zod'
import type { SeedPluginHost } from './plugin-host'

/** Streamable HTTP projection of tools explicitly declared by active plugins. */
export class SeedLocalMcpServer {
  private readonly handler = createMcpHandler(() => {
    const server = new McpServer({ name: 'MotusAI Seed', version: '1.0.0' }, { capabilities: { tools: {} } })
    for (const tool of this.pluginHost().mcpTools()) {
      server.registerTool(tool.name, {
        title: tool.method.display_name?.en_US || tool.name,
        description: tool.method.description?.en_US || tool.method.description?.zh_Hans || tool.name,
        inputSchema: z.fromJSONSchema(tool.method.inputSchema as Parameters<typeof z.fromJSONSchema>[0]),
        annotations: {
          readOnlyHint: tool.method.risk === 'read',
          destructiveHint: tool.method.risk === 'control',
        },
      }, async (args, context) => {
        try {
          const result = await this.pluginHost().invoke(tool.capability.id, tool.method.name, {
            request_id: randomUUID(), provider_plugin_id: tool.plugin.package_id,
            arguments: args as Record<string, unknown>, signal: context.mcpReq.signal,
          })
          return { content: [{ type: 'text', text: typeof result === 'string' ? result : JSON.stringify(result ?? null) }] }
        } catch (error) {
          return { isError: true, content: [{ type: 'text', text: error instanceof Error ? error.message : String(error) }] }
        }
      })
    }
    return server
  })

  constructor(private readonly pluginHost: () => SeedPluginHost) {}

  handle(request: Request) { return this.handler.fetch(request) }
  close() { return this.handler.close() }
}
