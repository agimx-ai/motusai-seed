import { describe, expect, it, vi } from 'vitest'
import { ConnectorCommandDispatcher } from './command-dispatcher'

type TestCommand = { type: string; release?: Promise<void> }

describe('ConnectorCommandDispatcher', () => {
  it('serializes lifecycle changes while allowing host responses to complete', async () => {
    const events: string[] = []
    let releaseFirstConfigure!: () => void
    const firstConfigureReleased = new Promise<void>((resolve) => { releaseFirstConfigure = resolve })
    const reportFailure = vi.fn()
    const dispatcher = new ConnectorCommandDispatcher<TestCommand>(async (command) => {
      events.push(`${command.type}:start`)
      await command.release
      events.push(`${command.type}:end`)
    }, reportFailure)

    dispatcher.dispatch({ type: 'configure', release: firstConfigureReleased })
    dispatcher.dispatch({ type: 'unconfigure' })
    dispatcher.dispatch({ type: 'configure' })
    dispatcher.dispatch({ type: 'host.result' })
    await vi.waitFor(() => expect(events).toContain('host.result:end'))

    expect(events).toContain('configure:start')
    expect(events).not.toContain('configure:end')
    expect(events).not.toContain('unconfigure:start')
    releaseFirstConfigure()
    await dispatcher.lifecycleIdle()

    expect(events.filter((event) => !event.startsWith('host.result'))).toEqual([
      'configure:start',
      'configure:end',
      'unconfigure:start',
      'unconfigure:end',
      'configure:start',
      'configure:end',
    ])
    expect(reportFailure).not.toHaveBeenCalled()
  })

  it('continues with the next lifecycle command after a failure', async () => {
    const events: string[] = []
    const failure = new Error('configure failed')
    const reportFailure = vi.fn()
    const dispatcher = new ConnectorCommandDispatcher<TestCommand>(async (command) => {
      events.push(command.type)
      if (command.type === 'configure') throw failure
    }, reportFailure)

    dispatcher.dispatch({ type: 'configure' })
    dispatcher.dispatch({ type: 'unconfigure' })
    await dispatcher.lifecycleIdle()

    expect(events).toEqual(['configure', 'unconfigure'])
    expect(reportFailure).toHaveBeenCalledWith(failure)
  })
})
