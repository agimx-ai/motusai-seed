import type { SeedBillingReceipt, SeedPluginErrorParameter } from '@motus-ai/seed-sdk'
import { isCreditAmount } from './credit-amount'

/** Copy only settlement contract fields, never arbitrary plugin error properties. */
export function pluginErrorBilling(error: unknown): SeedBillingReceipt | undefined {
  const billing = error && typeof error === 'object' && 'billing' in error ? error.billing : undefined
  if (!billing || typeof billing !== 'object' || !('version' in billing) || billing.version !== 1
    || !('complete' in billing) || typeof billing.complete !== 'boolean'
    || !('charges' in billing) || !Array.isArray(billing.charges) || billing.charges.length > 4096) return undefined
  const charges: SeedBillingReceipt['charges'] = []
  for (const charge of billing.charges) {
    if (!charge || typeof charge.call_id !== 'string' || !charge.call_id || charge.call_id.length > 256
      || !isCreditAmount(charge.charged_amount) || charge.charged_amount < 0) return undefined
    charges.push({ call_id: charge.call_id, charged_amount: charge.charged_amount })
  }
  return { version: 1, complete: billing.complete, charges }
}

/** Only declared scalar error parameters may cross plugin process boundaries. */
export function pluginErrorParams(error: unknown): Record<string, SeedPluginErrorParameter> | undefined {
  const params = error && typeof error === 'object' && 'params' in error ? error.params : undefined
  if (!params || typeof params !== 'object' || Array.isArray(params)) return undefined
  return Object.fromEntries(Object.entries(params).filter(([, value]) =>
    typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean',
  ))
}
