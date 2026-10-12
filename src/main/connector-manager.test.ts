import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { WorkerCommand, WorkerEvent } from '../shared/contracts'

const state = vi.hoisted(() => ({ children: [] as Array<{
  messages: WorkerCommand[]
  emit(event: string, ...args: unknown[]): void
}> }))

vi.mock('electron', async () => {
  const { EventEmitter } = await import('node:events')
  class Child extends EventEmitter {
    messages: WorkerCommand[] = []
    stdout = new EventEmitter()
    stderr = new EventEmitter()

    constructor() {
      super()
      state.children.push(this)
    }

    postMessage(message: WorkerCommand) {
      this.messages.push(message)
      if (message.type === 'shutdown') queueMicrotask(() => this.emit('message', {
        type: 'host.invoke', requestId: 'shutdown-request', service: 'seed.native.stop', arguments: {},
      } satisfies WorkerEvent))
      if (message.type === 'host.result' && message.requestId === 'shutdown-request') {
        queueMicrotask(() => this.emit('exit', 0))
      }
    }

    kill() { this.emit('exit', 9) }
  }

  return { utilityProcess: { fork: () => new Child() } }
})

import { ConnectorManager } from './connector-manager'

describe('ConnectorManager', () => {
  beforeEach(() => { state.children.length = 0 })

  it('preserves parameters returned by the capability router', async () => {
    const manager = new ConnectorManager('Seed', (event) => {
      if (event.type === 'host.invoke') manager.send({ type: 'host.result', requestId: event.requestId, ok: true, result: null })
    })
    manager.start()
    const pending = manager.invokeNativeCapability('com.example.consumer', { capability: 'probe', method: 'echo', arguments: {} }, [])
    const command = state.children[0]!.messages.find((message) => message.type === 'native.capability.invoke')!
    state.children[0]!.emit('message', { type: 'native.capability.result', requestId: command.requestId, ok: false,
      error: 'Failure: permission denied', errorCode: 'probe_failed', errorParams: { detail: 'permission denied' } } satisfies WorkerEvent)
    await expect(pending).rejects.toMatchObject({ code: 'probe_failed', params: { detail: 'permission denied' } })
    await manager.stop()
  })

  it('keeps the closing child available for host responses without starting another connector', async () => {
    const onExit = vi.fn()
    let manager!: ConnectorManager
    manager = new ConnectorManager('Seed', (event) => {
      if (event.type !== 'host.invoke') return
      manager.send({ type: 'host.result', requestId: event.requestId, ok: true, result: null })
    }, onExit)
    manager.start()

    await manager.stop()

    expect(state.children).toHaveLength(1)
    expect(state.children[0]!.messages.map((message) => message.type)).toEqual(['shutdown', 'host.result'])
    expect(onExit).not.toHaveBeenCalled()

    manager.send({ type: 'unconfigure' })
    expect(state.children).toHaveLength(1)
  })
})
