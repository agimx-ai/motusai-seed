import { EventEmitter } from 'node:events'
import { afterEach, describe, expect, it, vi } from 'vitest'
import WebSocket from 'ws'
import { SeedDistributionEvents } from './distribution-events'

class FakeSocket extends EventEmitter {
  readyState: number = WebSocket.CONNECTING
  ping = vi.fn()
  close = vi.fn(() => {
    this.readyState = WebSocket.CLOSED
  })
  terminate = vi.fn(() => {
    if (this.readyState === WebSocket.CLOSED) return
    this.readyState = WebSocket.CLOSED
    this.emit('close')
  })

  open() {
    this.readyState = WebSocket.OPEN
    this.emit('open')
  }
}

function setup() {
  const sockets: FakeSocket[] = []
  const connected = vi.fn()
  const received = vi.fn()
  const events = new SeedDistributionEvents(received, connected, {
    createSocket: () => {
      const socket = new FakeSocket()
      sockets.push(socket)
      return socket as unknown as WebSocket
    },
    random: () => 0,
    reconnectBaseDelayMs: 100,
    reconnectMaxDelayMs: 800,
    connectTimeoutMs: 50,
    heartbeatIntervalMs: 200,
    heartbeatTimeoutMs: 50,
    stableConnectionMs: 300,
  })
  return { events, sockets, connected }
}

afterEach(() => {
  vi.useRealTimers()
})

describe('SeedDistributionEvents', () => {
  it('terminates a connection that does not finish its handshake and reconnects', () => {
    vi.useFakeTimers()
    const { events, sockets } = setup()
    events.configure('https://cloud.example.com/api/v1/distributions/motusai/events')

    expect(sockets).toHaveLength(1)
    vi.advanceTimersByTime(50)
    expect(sockets[0].terminate).toHaveBeenCalledOnce()
    vi.advanceTimersByTime(50)
    expect(sockets).toHaveLength(2)
    events.stop()
  })

  it('uses ping and pong to detect a silently dead connection', () => {
    vi.useFakeTimers()
    const { events, sockets, connected } = setup()
    events.configure('https://cloud.example.com/api/v1/distributions/motusai/events')
    sockets[0].open()

    expect(connected).toHaveBeenCalledOnce()
    vi.advanceTimersByTime(200)
    expect(sockets[0].ping).toHaveBeenCalledOnce()
    sockets[0].emit('pong')
    vi.advanceTimersByTime(200)
    expect(sockets[0].ping).toHaveBeenCalledTimes(2)
    vi.advanceTimersByTime(50)
    expect(sockets[0].terminate).toHaveBeenCalledOnce()
    vi.advanceTimersByTime(50)
    expect(sockets).toHaveLength(2)
    events.stop()
  })

  it('reconnects immediately after the system resumes', () => {
    vi.useFakeTimers()
    const { events, sockets } = setup()
    events.configure('https://cloud.example.com/api/v1/distributions/motusai/events')
    sockets[0].open()

    events.reconnectNow()

    expect(sockets[0].terminate).toHaveBeenCalledOnce()
    expect(sockets).toHaveLength(2)
    events.stop()
  })

  it.each(['resume', 'reconfigure', 'stop'] as const)(
    'handles an aborted handshake when %s retires a real WebSocket',
    async (action) => {
      const sockets: WebSocket[] = []
      const events = new SeedDistributionEvents(vi.fn(), vi.fn(), {
        createSocket: (url) => {
          const socket = new WebSocket(url)
          sockets.push(socket)
          return socket
        },
      })

      try {
        // Retire each socket synchronously, before any network connection can open.
        events.configure('http://127.0.0.1:1/events')
        expect(sockets[0].readyState).toBe(WebSocket.CONNECTING)

        if (action === 'resume') {
          events.reconnectNow()
          events.reconnectNow()
          expect(sockets).toHaveLength(3)
        } else if (action === 'reconfigure') {
          events.configure('http://127.0.0.1:1/other-events')
          expect(sockets).toHaveLength(2)
        }
        events.stop()

        // ws emits the handshake-abort error and close on the next tick.
        await new Promise<void>((resolve) => setImmediate(resolve))
        expect(sockets.every((socket) => socket.readyState === WebSocket.CLOSED)).toBe(true)
      } finally {
        events.stop()
      }
    },
  )
})
