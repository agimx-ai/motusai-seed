import { createHash } from 'node:crypto'
import { z } from 'zod'
import type { SeedPluginRuntimeDefinition } from '../shared/contracts'
import type { CreditBillingClient } from './credit-billing'

/** Identity comes from the calling plugin; prices and confirmed settlement always come from Cloud. */
export async function invokeLocalCreditRelay(
  client: Pick<CreditBillingClient, 'prepare' | 'localRelay'>,
  plugin: SeedPluginRuntimeDefinition | undefined,
  service: string,
  argumentsValue: Record<string, unknown>,
) {
  const target = z.object({ capability_id: z.string().min(1), method: z.string().min(1) }).parse(argumentsValue)
  const method = plugin?.capabilities.find((capability) => capability.id === target.capability_id)
    ?.methods.find((candidate) => candidate.name === target.method)
  if (!plugin || method?.annotations?.['billing.settlement'] !== 'local_relay'
    || typeof method.annotations['billing.product'] !== 'string') {
    throw Object.assign(new Error('插件未声明此本地结算能力。'), { code: 'broker_permission_denied' })
  }
  if (service === 'seed.local.relay.prepare') {
    const input = z.object({ invocation_id: z.string().uuid(), plugin_version: z.string().min(1).max(40),
      arguments: z.record(z.string(), z.unknown()) }).parse(argumentsValue)
    if (input.plugin_version !== plugin.version) {
      throw Object.assign(new Error('计费请求的插件版本未在当前客户端运行。'), { code: 'broker_permission_denied' })
    }
    return client.prepare({ invocation_id: input.invocation_id, plugin_id: plugin.package_id,
      plugin_version: input.plugin_version, ...target,
      arguments_sha256: createHash('sha256').update(stableJson(input.arguments)).digest('hex') })
  }
  if (service !== 'seed.local.relay') throw new Error('Unknown local relay operation.')
  const input = z.object({ call_id: z.string().uuid(), task_id: z.string().uuid(),
    outcome: z.enum(['started', 'succeeded', 'failed', 'cancelled']) }).parse(argumentsValue)
  return client.localRelay({ ...input, ...target, plugin_id: plugin.package_id })
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
  if (value && typeof value === 'object') return `{${Object.entries(value as Record<string, unknown>)
    .sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`).join(',')}}`
  return JSON.stringify(value)
}
