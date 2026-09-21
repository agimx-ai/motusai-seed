type Command = { type: string }

const lifecycleCommandTypes = new Set(['configure', 'unconfigure', 'shutdown'])

export class ConnectorCommandDispatcher<T extends Command> {
  private lifecycleQueue: Promise<void> = Promise.resolve()

  constructor(
    private readonly handle: (command: T) => Promise<void>,
    private readonly reportFailure: (error: unknown) => void,
  ) {}

  dispatch(command: T) {
    if (!lifecycleCommandTypes.has(command.type)) {
      void this.handle(command).catch((error) => this.reportFailure(error))
      return
    }

    this.lifecycleQueue = this.lifecycleQueue
      .then(() => this.handle(command))
      .catch((error) => this.reportFailure(error))
  }

  async lifecycleIdle() {
    await this.lifecycleQueue
  }
}
