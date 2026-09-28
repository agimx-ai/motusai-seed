export type SeedLocalEventStreamOptions = {
  historyLimit?: number
  heartbeatIntervalMs?: number
  retryMs?: number
  initialId?: number
}

export type SeedLocalEventResponseOptions<T> = {
  signal?: AbortSignal
  after?: number
  filter?: (data: T) => boolean
  ready?: unknown
}

export type SeedLocalEventWaitOptions<T> = {
  after?: number
  filter?: (data: T) => boolean
  timeoutMs?: number
  signal?: AbortSignal
}

export type SeedLocalEventPublishOptions = {
  replay?: boolean
  dropWhenBackpressured?: boolean
}

type SeedLocalEvent<T> = { id: number; event: string; data: T }
type SeedLocalEventSubscriber<T> = {
  controller: ReadableStreamDefaultController<Uint8Array>
  heartbeat: ReturnType<typeof setInterval>
  filter?: (data: T) => boolean
}

export class SeedLocalEventStream<T = unknown> {
  private readonly subscribers = new Set<SeedLocalEventSubscriber<T>>()
  private readonly listeners = new Set<(entry: SeedLocalEvent<T> | null) => void>()
  private readonly history: SeedLocalEvent<T>[] = []
  private readonly transientHistory: SeedLocalEvent<T>[] = []
  private readonly encoder = new TextEncoder()
  private readonly historyLimit: number
  private readonly heartbeatIntervalMs: number
  private readonly retryMs: number
  private nextId: number

  constructor(options: SeedLocalEventStreamOptions = {}) {
    this.historyLimit = Math.max(0, options.historyLimit ?? 1_000)
    this.heartbeatIntervalMs = Math.max(1_000, options.heartbeatIntervalMs ?? 15_000)
    this.retryMs = Math.max(0, options.retryMs ?? 2_000)
    this.nextId = Number.isSafeInteger(options.initialId) && Number(options.initialId) > 0
      ? Number(options.initialId)
      : 1
  }

  publish(data: T | ((id: number) => T), event = 'message', options: SeedLocalEventPublishOptions = {}) {
    if (!/^[A-Za-z0-9_.-]+$/.test(event)) throw new Error('Local event name is invalid.')
    const id = this.nextId++
    const value = typeof data === 'function' ? (data as (id: number) => T)(id) : data
    const entry = { id, event, data: value }
    if (this.historyLimit > 0 && options.replay !== false) {
      this.history.push(entry)
      if (this.history.length > this.historyLimit) this.history.splice(0, this.history.length - this.historyLimit)
    } else if (this.historyLimit > 0) {
      // Keep a bounded cursor gap buffer for plugin readers without replaying
      // transient deltas to reconnecting SSE clients.
      this.transientHistory.push(entry)
      if (this.transientHistory.length > this.historyLimit) this.transientHistory.shift()
    }
    for (const subscriber of this.subscribers) {
      if (!subscriber.filter || subscriber.filter(value)) {
        if (options.dropWhenBackpressured && (subscriber.controller.desiredSize ?? 0) <= 0) continue
        try {
          this.enqueue(subscriber.controller, entry)
        } catch {
          clearInterval(subscriber.heartbeat)
          this.subscribers.delete(subscriber)
        }
      }
    }
    for (const listener of this.listeners) listener(entry)
    return id
  }

  /** Read the same event envelopes used by SSE, waiting for a live event when replay has none. */
  async waitFor(options: SeedLocalEventWaitOptions<T> = {}): Promise<Array<{ id: number; event: string; data: T }>> {
    const after = Number.isFinite(options.after) ? Math.max(0, Number(options.after)) : 0
    const available = [...this.history, ...this.transientHistory]
      .filter((entry) => entry.id > after && (!options.filter || options.filter(entry.data)))
      .sort((left, right) => left.id - right.id)
    if (available.length || options.signal?.aborted) return available
    return await new Promise((resolve) => {
      let timer: ReturnType<typeof setTimeout> | undefined
      const cleanup = () => {
        if (timer) clearTimeout(timer)
        this.listeners.delete(listener)
        options.signal?.removeEventListener('abort', abort)
      }
      const listener = (entry: SeedLocalEvent<T> | null) => {
        if (entry && (entry.id <= after || (options.filter && !options.filter(entry.data)))) return
        cleanup()
        resolve(entry ? [entry] : [])
      }
      const abort = () => listener(null)
      this.listeners.add(listener)
      options.signal?.addEventListener('abort', abort, { once: true })
      timer = setTimeout(() => listener(null), Math.max(0, Math.min(30_000, options.timeoutMs ?? 15_000)))
    })
  }

  response(signalOrOptions?: AbortSignal | SeedLocalEventResponseOptions<T>) {
    const options = signalOrOptions && 'aborted' in signalOrOptions
      ? { signal: signalOrOptions }
      : signalOrOptions ?? {}
    let subscriber: SeedLocalEventSubscriber<T> | null = null
    const cleanup = () => {
      if (subscriber) {
        clearInterval(subscriber.heartbeat)
        this.subscribers.delete(subscriber)
      }
      subscriber = null
    }
    const stream = new ReadableStream<Uint8Array>({
      start: (controller) => {
        if (options.signal?.aborted) {
          controller.close()
          return
        }
        controller.enqueue(this.encoder.encode(`: connected\nretry: ${this.retryMs}\n\n`))
        const after = Number.isFinite(options.after) ? Math.max(0, Number(options.after)) : 0
        for (const entry of this.history) {
          if (entry.id > after && (!options.filter || options.filter(entry.data))) this.enqueue(controller, entry)
        }
        if (options.ready !== undefined) this.enqueueData(controller, options.ready, 'ready')
        subscriber = {
          controller,
          filter: options.filter,
          heartbeat: setInterval(() => {
            try { controller.enqueue(this.encoder.encode(': heartbeat\n\n')) } catch { cleanup() }
          }, this.heartbeatIntervalMs),
        }
        this.subscribers.add(subscriber)
        options.signal?.addEventListener('abort', () => {
          cleanup()
          try { controller.close() } catch { /* already closed */ }
        }, { once: true })
      },
      cancel: cleanup,
    })
    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        'X-Accel-Buffering': 'no',
      },
    })
  }

  close() {
    for (const listener of this.listeners) listener(null)
    for (const subscriber of this.subscribers) {
      clearInterval(subscriber.heartbeat)
      try { subscriber.controller.close() } catch { /* already closed */ }
    }
    this.subscribers.clear()
  }

  latestId() {
    return this.nextId - 1
  }

  clearHistory() {
    this.history.length = 0
    this.transientHistory.length = 0
  }

  private enqueue(controller: ReadableStreamDefaultController<Uint8Array>, entry: SeedLocalEvent<T>) {
    this.enqueueData(controller, entry.data, entry.event, entry.id)
  }

  private enqueueData(controller: ReadableStreamDefaultController<Uint8Array>, data: unknown, event: string, id?: number) {
    const serialized = JSON.stringify(data)
    if (serialized === undefined) throw new Error('Local event data must be JSON serializable.')
    const payload = serialized.split('\n').map((line) => `data: ${line}`).join('\n')
    controller.enqueue(this.encoder.encode(`${id === undefined ? '' : `id: ${id}\n`}event: ${event}\n${payload}\n\n`))
  }
}
