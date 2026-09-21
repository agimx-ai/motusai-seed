import { describe, expect, it, vi } from 'vitest'
import { waitForSettlement } from './shutdown'

describe('waitForSettlement', () => {
  it('returns immediately when cleanup completes', async () => {
    await expect(waitForSettlement(Promise.resolve(), 500)).resolves.toBe(true)
  })

  it('stops waiting after the cleanup grace period', async () => {
    vi.useFakeTimers()
    try {
      const result = waitForSettlement(new Promise(() => undefined), 500)
      await vi.advanceTimersByTimeAsync(500)
      await expect(result).resolves.toBe(false)
    } finally {
      vi.useRealTimers()
    }
  })
})
