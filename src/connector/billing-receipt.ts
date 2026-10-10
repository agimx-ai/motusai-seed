import type { SeedBillingReceipt } from '@motus-ai/seed-sdk'
import { isCreditAmount } from '../shared/credit-amount'

/** One invocation tree; never derives charges from quotes, tokens or plugin output. */
export class BillingReceipt {
  private complete = true
  private pending = 0
  private readonly charges = new Map<string, number>()
  private readonly streams = new Set<string>()

  uncertain() { this.complete = false }
  begin() { this.pending += 1 }
  end() { this.pending -= 1 }

  add(callId: unknown, amount: unknown) {
    if (typeof callId !== 'string' || !callId || !isCreditAmount(amount) || Number(amount) < 0) {
      this.uncertain()
      return
    }
    const previous = this.charges.get(callId)
    if (previous !== undefined && previous !== amount) this.uncertain()
    else this.charges.set(callId, Number(amount))
  }

  merge(receipt: SeedBillingReceipt) {
    if (receipt.version !== 1 || !receipt.complete) this.uncertain()
    for (const charge of receipt.charges) this.add(charge.call_id, charge.charged_amount)
  }

  relay(service: string, result: unknown) {
    const response = result as { stream_id?: string; done?: boolean; billing?: { state?: string; call_id?: string; charged_amount?: number } }
    if (service === 'seed.cloud.relay.stream.start') {
      if (response.stream_id) this.streams.add(response.stream_id)
      else this.uncertain()
    } else if (service === 'seed.cloud.relay' || (service === 'seed.cloud.relay.stream.next' && response.done)) {
      if (response.billing?.state === 'settled') this.add(response.billing.call_id, response.billing.charged_amount)
      else this.uncertain()
    }
  }

  endStream(streamId: string) { this.streams.delete(streamId) }

  snapshot(): SeedBillingReceipt {
    return { version: 1, complete: this.complete && this.pending === 0 && this.streams.size === 0,
      charges: [...this.charges].map(([call_id, charged_amount]) => ({ call_id, charged_amount })) }
  }
}
