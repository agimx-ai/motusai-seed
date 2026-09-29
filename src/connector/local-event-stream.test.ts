import { describe, expect, it } from 'vitest'
import { SeedLocalEventStream } from '@motus-ai/seed-sdk'

describe('SeedLocalEventStream', () => {
  it('replays filtered events after the requested event id', async () => {
    const events = new SeedLocalEventStream<{ workspace: string; value: number }>({ heartbeatIntervalMs: 60_000 })
    events.publish({ workspace: 'one', value: 1 }, 'updated')
    const after = events.publish({ workspace: 'two', value: 2 }, 'updated')
    events.publish({ workspace: 'one', value: 3 }, 'updated')

    const response = events.response({
      after,
      filter: (event) => event.workspace === 'one',
      ready: { protocol_version: 1 },
    })
    const reader = response.body!.getReader()
    const decoder = new TextDecoder()
    const text = [await reader.read(), await reader.read(), await reader.read()]
      .map((chunk) => decoder.decode(chunk.value))
      .join('')

    expect(response.headers.get('content-type')).toBe('text/event-stream; charset=utf-8')
    expect(text).toContain('id: 3\nevent: updated')
    expect(text).toContain('"value":3')
    expect(text).not.toContain('"value":1')
    expect(text).toContain('event: ready')
    await reader.cancel()
    events.close()
  })

  it('can discard history without closing current subscribers', async () => {
    const events = new SeedLocalEventStream<{ value: number }>({ heartbeatIntervalMs: 60_000 })
    events.publish({ value: 1 })
    events.clearHistory()
    const response = events.response()
    const reader = response.body!.getReader()
    events.publish({ value: 2 })
    const decoder = new TextDecoder()
    const first = `${decoder.decode((await reader.read()).value)}${decoder.decode((await reader.read()).value)}`

    expect(first).not.toContain('"value":1')
    expect(first).toContain('"value":2')
    await reader.cancel()
    events.close()
  })

  it('delivers the same live event data to a capability reader without changing SSE replay', async () => {
    const events = new SeedLocalEventStream<{ run_id: string; text: string }>({ heartbeatIntervalMs: 60_000 })
    const waiting = events.waitFor({ after: 0, filter: (entry) => entry.run_id === 'run-1', timeoutMs: 1_000 })
    events.publish({ run_id: 'other', text: 'ignore' }, 'assistant.delta', { replay: false })
    events.publish({ run_id: 'run-1', text: 'hello' }, 'assistant.delta', { replay: false })
    expect(await waiting).toEqual([{ id: 2, event: 'assistant.delta', data: { run_id: 'run-1', text: 'hello' } }])
    events.publish({ run_id: 'run-1', text: ' world' }, 'assistant.delta', { replay: false })
    expect(await events.waitFor({ after: 2, filter: (entry) => entry.run_id === 'run-1' }))
      .toEqual([{ id: 3, event: 'assistant.delta', data: { run_id: 'run-1', text: ' world' } }])

    const response = events.response()
    const reader = response.body!.getReader()
    const first = new TextDecoder().decode((await reader.read()).value)
    expect(first).not.toContain('hello')
    await reader.cancel()
    events.close()
  })
})
