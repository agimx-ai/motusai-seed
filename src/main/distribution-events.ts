import WebSocket from 'ws'
import type { SeedDistributionEvent } from '../shared/contracts'
import { seedDistributionEventSchema } from '../shared/validation'

type DistributionEventsOptions = {
  createSocket?: (url: string) => WebSocket
  random?: () => number
  reconnectBaseDelayMs?: number
  reconnectMaxDelayMs?: number
  connectTimeoutMs?: number
  heartbeatIntervalMs?: number
  heartbeatTimeoutMs?: number
  stableConnectionMs?: number
}

const defaults = {
  reconnectBaseDelayMs: 250,
  reconnectMaxDelayMs: 3_000,
  connectTimeoutMs: 5_000,
  heartbeatIntervalMs: 5_000,
  heartbeatTimeoutMs: 3_000,
  stableConnectionMs: 10_000,
}

export class SeedDistributionEvents {
  private socket: WebSocket | null = null
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private connectTimer: ReturnType<typeof setTimeout> | null = null
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null
  private heartbeatTimeout: ReturnType<typeof setTimeout> | null = null
  private stableConnectionTimer: ReturnType<typeof setTimeout> | null = null
  private reconnectAttempt = 0
  private eventsUrl = ''
  private stopped = false
  private readonly createSocket: (url: string) => WebSocket
  private readonly random: () => number
  private readonly reconnectBaseDelayMs: number
  private readonly reconnectMaxDelayMs: number
  private readonly connectTimeoutMs: number
  private readonly heartbeatIntervalMs: number
  private readonly heartbeatTimeoutMs: number
  private readonly stableConnectionMs: number

  constructor(
    private readonly received: (event: SeedDistributionEvent) => void,
    private readonly connected: () => void,
    options: DistributionEventsOptions = {},
  ) {
    this.createSocket = options.createSocket ?? ((url) => new WebSocket(url))
    this.random = options.random ?? Math.random
    this.reconnectBaseDelayMs = options.reconnectBaseDelayMs ?? defaults.reconnectBaseDelayMs
    this.reconnectMaxDelayMs = options.reconnectMaxDelayMs ?? defaults.reconnectMaxDelayMs
    this.connectTimeoutMs = options.connectTimeoutMs ?? defaults.connectTimeoutMs
    this.heartbeatIntervalMs = options.heartbeatIntervalMs ?? defaults.heartbeatIntervalMs
    this.heartbeatTimeoutMs = options.heartbeatTimeoutMs ?? defaults.heartbeatTimeoutMs
    this.stableConnectionMs = options.stableConnectionMs ?? defaults.stableConnectionMs
  }

  configure(eventsUrl: string) {
    if (eventsUrl === this.eventsUrl && (this.socket || this.reconnectTimer)) return
    this.eventsUrl = eventsUrl
    this.stopped = false
    this.disconnectSocket()
    this.connect()
  }

  reconnectNow() {
    if (this.stopped || !this.eventsUrl) return
    this.clearReconnectTimer()
    this.disconnectSocket(true)
    this.connect()
  }

  stop() {
    this.stopped = true
    this.eventsUrl = ''
    this.clearReconnectTimer()
    this.disconnectSocket()
  }

  private clearReconnectTimer() {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer)
    this.reconnectTimer = null
  }

  private clearSocketTimers() {
    if (this.connectTimer) clearTimeout(this.connectTimer)
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer)
    if (this.heartbeatTimeout) clearTimeout(this.heartbeatTimeout)
    if (this.stableConnectionTimer) clearTimeout(this.stableConnectionTimer)
    this.connectTimer = null
    this.heartbeatTimer = null
    this.heartbeatTimeout = null
    this.stableConnectionTimer = null
  }

  private disconnectSocket(terminate = false) {
    this.clearSocketTimers()
    const socket = this.socket
    this.socket = null
    socket?.removeAllListeners()
    if (terminate) socket?.terminate()
    else socket?.close()
  }

  private markAlive(socket: WebSocket) {
    if (this.socket !== socket) return
    if (this.heartbeatTimeout) clearTimeout(this.heartbeatTimeout)
    this.heartbeatTimeout = null
  }

  private startHeartbeat(socket: WebSocket) {
    this.heartbeatTimer = setInterval(() => {
      if (this.socket !== socket || socket.readyState !== WebSocket.OPEN) return
      if (this.heartbeatTimeout) {
        socket.terminate()
        return
      }
      socket.ping()
      this.heartbeatTimeout = setTimeout(() => {
        if (this.socket === socket) socket.terminate()
      }, this.heartbeatTimeoutMs)
    }, this.heartbeatIntervalMs)
  }

  private scheduleReconnect() {
    if (this.stopped || !this.eventsUrl || this.reconnectTimer) return
    const exponentialDelay = Math.min(
      this.reconnectBaseDelayMs * 2 ** Math.min(this.reconnectAttempt, 10),
      this.reconnectMaxDelayMs,
    )
    const delay = Math.round(exponentialDelay * (0.5 + this.random() * 0.5))
    this.reconnectAttempt += 1
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      this.connect()
    }, delay)
  }

  private connect() {
    if (this.stopped || !this.eventsUrl || this.socket) return
    const url = new URL(this.eventsUrl)
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
    const socket = this.createSocket(url.toString())
    this.socket = socket
    this.connectTimer = setTimeout(() => {
      if (this.socket === socket && socket.readyState !== WebSocket.OPEN) socket.terminate()
    }, this.connectTimeoutMs)
    socket.on('open', () => {
      if (this.socket !== socket) return
      if (this.connectTimer) clearTimeout(this.connectTimer)
      this.connectTimer = null
      this.stableConnectionTimer = setTimeout(() => {
        if (this.socket === socket && socket.readyState === WebSocket.OPEN) this.reconnectAttempt = 0
      }, this.stableConnectionMs)
      this.startHeartbeat(socket)
      this.connected()
    })
    socket.on('pong', () => this.markAlive(socket))
    socket.on('message', (data) => {
      this.markAlive(socket)
      try {
        const event = seedDistributionEventSchema.parse(JSON.parse(String(data)))
        this.received(event)
      } catch {
        // Ignore malformed or unsupported messages from the public invalidation stream.
      }
    })
    socket.on('close', () => {
      if (this.socket !== socket) return
      this.clearSocketTimers()
      this.socket = null
      this.scheduleReconnect()
    })
    socket.on('error', () => {
      if (this.socket === socket) socket.terminate()
    })
  }
}
