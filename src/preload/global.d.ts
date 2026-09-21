import type { SeedApi, SeedWindowApi } from '../shared/contracts'

declare global {
  interface Window {
    motusSeed: SeedApi
    motusWindow: SeedWindowApi
  }
}

export {}
