import type { CompanionDiscovery } from '../../shared/companion-discoveries'
import type { Look } from '@motus-ai/seed-sdk/companion'

export const discoveryCorners = [
  { corner: 'top-left', yaw: -38, pitch: 26 },
  { corner: 'bottom-left', yaw: -38, pitch: -24 },
  { corner: 'top-right', yaw: 38, pitch: 26 },
  { corner: 'bottom-right', yaw: 38, pitch: -24 },
] as const
export function prepareDiscoveries(items: CompanionDiscovery[]) {
  return discoveryCorners.flatMap(({ corner, yaw, pitch }) => {
    const item = items.find((candidate) => candidate.corner === corner && candidate.enabled)
    return item ? [{ ...item, look: { yaw, pitch, mix: 1, spin: 0, wander: 0.18 } satisfies Look }] : []
  })
}
export type PreparedDiscovery = ReturnType<typeof prepareDiscoveries>[number]
export type DiscoveryPhase = 'look' | 'visible' | 'front' | 'wink' | 'rest' | 'leaving' | 'gap'
export const discoveryFrontLook: Look = { yaw: 0, pitch: 0, mix: 1, spin: 0, wander: 0 }
export const discoveryTiming: Record<DiscoveryPhase, number> = { look: 320, visible: 1_500, front: 400, wink: 700, rest: 1_800, leaving: 160, gap: 500 }
export const discoveryIdleDelay = 650
