import { describe, expect, it, vi } from 'vitest'
import type { SeedPluginRuntimeDefinition, WorkerCommand } from '../shared/contracts'
import type { NativePluginCommand, NativePluginEvent } from '../shared/native-plugin-process'

const state = vi.hoisted(() => ({ children: [] as Array<{
  messages: NativePluginCommand[]
  emit(event: string, ...args: unknown[]): void
  kill(): void
}> }))

vi.mock('electron', async () => {
  const { EventEmitter } = await import('node:events')
  class Child extends EventEmitter {
    messages: NativePluginCommand[] = []
    stdout = new EventEmitter()
    stderr = new EventEmitter()
    constructor() { super(); state.children.push(this) }
    postMessage(message: NativePluginCommand) {
      this.messages.push(message)
      if (message.type === 'start') queueMicrotask(() => this.emit('message', {
        type: 'ready', snapshot: { capabilities: ['probe'], configurations: [], managementViews: [], connections: [] },
      } satisfies NativePluginEvent))
      if (message.type === 'call' && message.operation.type !== 'invoke') queueMicrotask(() => this.emit('message', {
        type: 'result', requestId: message.requestId, ok: true, result: null,
      } satisfies NativePluginEvent))
      if (message.type === 'call' && message.operation.type === 'invoke' && message.operation.method !== 'hang') {
        queueMicrotask(() => this.emit('message', {
          type: 'result', requestId: message.requestId, ok: true, result: message.operation.invocation.arguments,
        } satisfies NativePluginEvent))
      }
      if (message.type === 'stop') queueMicrotask(() => this.kill())
    }
    kill() { this.emit('exit', 9) }
  }
  return { utilityProcess: { fork: () => new Child() } }
})

import { NativePluginManager } from './native-plugin-manager'

function plugin(name: string): SeedPluginRuntimeDefinition {
  return { package_id: `com.example.${name}`, version: '1.0.0', runtime_kind: 'native-host', publisher_type: 'official',
    root_path: `/plugins/${name}`, entry_path: `/plugins/${name}/index.mjs`, sidecars: [], permissions: [], consumes: [], capabilities: [] }
}

const configuration: Extract<WorkerCommand, { type: 'configure' }> = {
  type: 'configure',
  appVersion: '1.0.0', locale: 'zh-CN', backupRoot: '/backups', pluginDataRoot: '/data', plugins: [],
}

describe('NativePluginManager', () => {
  it('records broker failures from an isolated plugin before returning the error', async () => {
    state.children.length = 0
    const failures: Array<{ event: string; message: string }> = []
    const manager = new NativePluginManager('Seed', async () => {
      throw Object.assign(new Error('积分不足'), { code: 'insufficient_credits' })
    }, () => undefined, (_id, event, error) => failures.push({ event, message: error.message }),
    () => undefined, () => undefined)
    try {
      await manager.start(plugin('billing'), configuration)
      state.children[0]!.emit('message', {
        type: 'host.invoke', requestId: 'billing-request', service: 'seed.cloud.relay', arguments: {},
      } satisfies NativePluginEvent)
      await vi.waitFor(() => expect(state.children[0]!.messages.some((item) => item.type === 'host.result')))
      expect(failures).toContainEqual({ event: 'native.host.invoke.failed', message: '积分不足' })
      expect(state.children[0]!.messages).toContainEqual({
        type: 'host.result', requestId: 'billing-request', ok: false,
        error: '积分不足', errorCode: 'insufficient_credits',
      })
    } finally { await manager.stopAll() }
  })

  it('runs plugins in separate processes and restarts only the crashed plugin', async () => {
    state.children.length = 0
    const snapshots: string[] = []
    const tasks: string[] = []
    const manager = new NativePluginManager('Seed', async () => null,
      (id, snapshot) => snapshots.push(`${id}:${snapshot ? 'ready' : 'gone'}`),
      () => undefined, (event) => tasks.push(`${event.requestId}:${event.phase}`), () => undefined)
    try {
      await Promise.all([manager.start(plugin('one'), configuration), manager.start(plugin('two'), configuration)])
      expect(state.children).toHaveLength(2)
      const startMessage = state.children[0]!.messages[0]
      expect(startMessage?.type).toBe('start')
      const pending = manager.call('com.example.one', { type: 'invoke', capability: 'probe', method: 'hang',
        invocation: { request_id: 'pending', arguments: {} }, chain: [] }, 'pending')
      await vi.waitFor(() => expect(state.children[0]!.messages.some((item) => item.type === 'call')).toBe(true))
      state.children[0]!.emit('message', { type: 'task.changed', requestId: 'task-1', taskId: 'task-1', phase: 'started', operation: 'probe.hang' })
      state.children[0]!.kill()
      await expect(pending).rejects.toMatchObject({ code: 'native_plugin_process_gone' })
      expect(tasks).toEqual(['task-1:started', 'task-1:failed'])
      expect(snapshots).toContain('com.example.one:gone')
      await expect(manager.call('com.example.two', { type: 'invoke', capability: 'probe', method: 'echo',
        invocation: { request_id: 'healthy', arguments: { value: 1 } }, chain: [] })).resolves.toEqual({ value: 1 })
      await vi.waitFor(() => expect(state.children).toHaveLength(3), { timeout: 2_000 })
      expect(snapshots.filter((item) => item === 'com.example.two:gone')).toHaveLength(0)
    } finally { await manager.stopAll() }
  })
})
