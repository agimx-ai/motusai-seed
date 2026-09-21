import { describe, expect, it, vi } from 'vitest'
import { CapsRegistry } from './caps'

describe('package-level Cordis registry', () => {
  it('waits for required services before applying the package Fiber', async () => {
    const registry = new CapsRegistry()
    const applied = vi.fn()
    registry.register('com.example.probe', {
      name: 'probe',
      inject: ['probe.service'],
      apply: (context) => { applied(context.get('probe.service')) },
    })
    const starting = registry.start()
    expect(applied).not.toHaveBeenCalled()
    registry.context.provide('probe.service', 'ready')
    await starting
    expect(applied).toHaveBeenCalledWith('ready')
    await registry.stop()
  })

  it('runs Cordis effects exactly once and in reverse order', async () => {
    const registry = new CapsRegistry()
    const lifecycle: string[] = []
    registry.register('com.example.effects', {
      name: 'effects',
      apply: (context) => {
        context.effect(() => {
          lifecycle.push('first:start')
          return () => { lifecycle.push('first:stop') }
        })
        context.effect(() => {
          lifecycle.push('second:start')
          return () => { lifecycle.push('second:stop') }
        })
      },
    })
    await registry.start()
    await Promise.all([registry.stop(), registry.stop()])
    expect(lifecycle).toEqual(['first:start', 'second:start', 'second:stop', 'first:stop'])
  })

  it('re-applies one package Fiber on reload', async () => {
    const registry = new CapsRegistry()
    let generation = 0
    registry.register('com.example.reload', { name: 'reload', apply: () => { generation += 1 } })
    await registry.start()
    expect(generation).toBe(1)
    await registry.reload('com.example.reload')
    expect(generation).toBe(2)
  })

  it('rejects duplicate package registrations', () => {
    const registry = new CapsRegistry()
    registry.register('com.example.duplicate', { name: 'one', apply: () => undefined })
    expect(() => registry.register('com.example.duplicate', { name: 'two', apply: () => undefined })).toThrow(/already registered/)
  })

  it('removes event effects when a package is unregistered', async () => {
    const registry = new CapsRegistry()
    const observed: string[] = []
    const unregister = registry.register('com.example.events', {
      name: 'events',
      apply: (context) => { context.on('example.event', (value) => observed.push(String(value))) },
    })
    await registry.start()
    registry.context.emit('example.event', 'before')
    await unregister()
    registry.context.emit('example.event', 'after')
    expect(observed).toEqual(['before'])
  })

  it('keeps Cordis waterfall contracts available to plugins', async () => {
    const registry = new CapsRegistry()
    registry.register('com.example.waterfall', {
      name: 'waterfall',
      apply: (context) => {
        context.on('transform', async (value, next) => `outer:${await (next as (nextValue: unknown) => Promise<unknown>)(`${String(value)}:first`)}`)
        context.on('transform', (value) => `${String(value)}:second`)
      },
    })
    await registry.start()
    await expect(registry.context.waterfall('transform', 'start')).resolves.toBe('outer:start:first:second')
  })
})
