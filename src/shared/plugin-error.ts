import type { SeedPluginErrorParameter } from '@motus-ai/seed-sdk'

/** Only declared scalar error parameters may cross plugin process boundaries. */
export function pluginErrorParams(error: unknown): Record<string, SeedPluginErrorParameter> | undefined {
  const params = error && typeof error === 'object' && 'params' in error ? error.params : undefined
  if (!params || typeof params !== 'object' || Array.isArray(params)) return undefined
  return Object.fromEntries(Object.entries(params).filter(([, value]) =>
    typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean',
  ))
}
