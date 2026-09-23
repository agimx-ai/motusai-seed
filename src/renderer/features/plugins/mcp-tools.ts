import type { SeedInstalledPlugin } from '../../../shared/contracts'

export function pluginMcpTools(plugin: Pick<SeedInstalledPlugin, 'capabilities'>): string[] {
  return plugin.capabilities.flatMap((capability) => capability.methods.flatMap((method) => {
    if (method.annotations?.['mcp.tool'] !== true) return []
    const name = method.annotations['mcp.tool_name']
    return [typeof name === 'string' ? name : method.name]
  }))
}
