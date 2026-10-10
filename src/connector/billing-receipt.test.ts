import { describe, expect, it } from 'vitest'
import { BillingReceipt } from './billing-receipt'

describe('invocation billing receipt', () => {
  it('deduplicates nested receipts and preserves actual zero', () => {
    const receipt = new BillingReceipt()
    receipt.add('charge', 2)
    receipt.merge({ version: 1, complete: true, charges: [{ call_id: 'charge', charged_amount: 2 }, { call_id: 'zero', charged_amount: 0 }] })
    expect(receipt.snapshot()).toEqual({ version: 1, complete: true,
      charges: [{ call_id: 'charge', charged_amount: 2 }, { call_id: 'zero', charged_amount: 0 }] })
  })

  it.each([undefined, -1, 0.001, NaN, Infinity, '2'])('does not treat invalid settlement as zero: %s', (amount) => {
    const receipt = new BillingReceipt()
    receipt.add('charge', amount)
    expect(receipt.snapshot()).toMatchObject({ complete: false, charges: [] })
  })

  it('rejects conflicting receipts rather than double charging or picking an amount', () => {
    const receipt = new BillingReceipt()
    receipt.add('charge', 2)
    receipt.add('charge', 3)
    expect(receipt.snapshot()).toMatchObject({ complete: false })
  })

  it('requires confirmation for every started relay stream, including closed streams', () => {
    const receipt = new BillingReceipt()
    receipt.relay('seed.cloud.relay.stream.start', { stream_id: 'stream' })
    expect(receipt.snapshot().complete).toBe(false)
    receipt.relay('seed.cloud.relay.stream.next', { done: true, billing: { state: 'settled', call_id: 'charge', charged_amount: 1 } })
    receipt.endStream('stream')
    expect(receipt.snapshot()).toMatchObject({ complete: true, charges: [{ call_id: 'charge', charged_amount: 1 }] })
    const closed = new BillingReceipt()
    closed.relay('seed.cloud.relay.stream.start', { stream_id: 'closed' })
    closed.relay('seed.cloud.relay.stream.close', { closed: true })
    expect(closed.snapshot().complete).toBe(false)
  })

  it('never infers settlement from a quote or payload supplied by a plugin', () => {
    const receipt = new BillingReceipt()
    receipt.relay('seed.cloud.relay', { payload: { charged_amount: 2 }, billing: { state: 'uncertain', amount: 2 } })
    expect(receipt.snapshot()).toEqual({ version: 1, complete: false, charges: [] })
  })

  it('does not call a still-running internal operation free', () => {
    const receipt = new BillingReceipt()
    receipt.begin()
    expect(receipt.snapshot().complete).toBe(false)
    receipt.add('charge', 2)
    receipt.end()
    expect(receipt.snapshot().complete).toBe(true)
  })
})
