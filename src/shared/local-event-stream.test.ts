import { describe, expect, it } from 'vitest'
import { SeedLocalEventStream } from '../../packages/seed-sdk/src/local-event-stream'

describe('SeedLocalEventStream', () => {
  it('starts event ids at the configured instance epoch', async () => {
    const events = new SeedLocalEventStream<{ value: string }>({ initialId: 42_000, heartbeatIntervalMs: 60_000 })
    expect(events.publish({ value: 'ready' })).toBe(42_000)
    const response = events.response({ after: 41_999, signal: AbortSignal.timeout(100) })
    const reader = response.body!.getReader()
    const first = new TextDecoder().decode((await reader.read()).value)
    const second = new TextDecoder().decode((await reader.read()).value)
    expect(`${first}${second}`).toContain('id: 42000')
    events.close()
  })

  it('keeps transient events out of replay and drops them for a backpressured subscriber', async () => {
    const events = new SeedLocalEventStream<{ value: string }>({ heartbeatIntervalMs: 60_000 })
    const response = events.response()
    const reader = response.body!.getReader()

    events.publish({ value: 'transient' }, 'delta', { replay: false, dropWhenBackpressured: true })
    const connected = new TextDecoder().decode((await reader.read()).value)
    events.publish({ value: 'durable' }, 'completed')
    const completed = new TextDecoder().decode((await reader.read()).value)

    expect(connected).not.toContain('transient')
    expect(completed).toContain('durable')
    await reader.cancel()

    const replay = events.response({ after: 0, signal: AbortSignal.timeout(100) })
    const replayReader = replay.body!.getReader()
    const replayed = `${new TextDecoder().decode((await replayReader.read()).value)}${new TextDecoder().decode((await replayReader.read()).value)}`
    expect(replayed).not.toContain('transient')
    expect(replayed).toContain('durable')
    await replayReader.cancel()
    events.close()
  })
})
