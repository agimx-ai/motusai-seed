import type { ClientReleaseNotes } from '../shared/contracts'
import { compareSeedVersions } from '../shared/seed-version'

export type ClientReleaseReadState = {
  highestVersion: string
  pendingVersion?: string
}

export function nextReleaseReadState(current: string, saved: ClientReleaseReadState | undefined): ClientReleaseReadState {
  if (!saved) return { highestVersion: current, pendingVersion: current }
  // A downgrade must not make a previously acknowledged release appear new.
  if (compareSeedVersions(current, saved.highestVersion) <= 0) return saved
  return { highestVersion: current, pendingVersion: current }
}

type Persistence = {
  read(): Promise<ClientReleaseReadState | undefined>
  write(state: ClientReleaseReadState): Promise<void>
}

export class ClientReleaseNotesService {
  private state: ClientReleaseReadState | undefined
  private enabled = false
  constructor(private readonly contents: Omit<ClientReleaseNotes, 'unread'>, private readonly persistence: Persistence) {}

  async initialize(currentVersion: string, packaged: boolean) {
    if (currentVersion !== this.contents.version) throw new Error('Bundled release notes do not match the running client version.')
    this.enabled = packaged
    if (!packaged) return
    const state = nextReleaseReadState(currentVersion, await this.persistence.read())
    await this.persistence.write(state)
    this.state = state
  }

  snapshot(): ClientReleaseNotes {
    return { ...this.contents, unread: this.enabled && this.state?.pendingVersion === this.contents.version }
  }

  async acknowledge(version: string) {
    if (version !== this.contents.version) throw new Error('Cannot acknowledge a different client release.')
    if (!this.enabled || this.state?.pendingVersion !== version) return
    const state = { highestVersion: this.state.highestVersion }
    await this.persistence.write(state)
    this.state = state
  }
}
