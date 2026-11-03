import type { Look } from './bloub/engine'

// Reading order is intentional: left top, left bottom, right top, right bottom.
export const companionDiscoveries = [
  { id: 'assistant', corner: 'top-left', slug: 'use-personal-assistant', yaw: -38, pitch: 26 },
  { id: 'memory', corner: 'bottom-left', slug: 'use-global-memory', yaw: -38, pitch: -24 },
  { id: 'weixin', corner: 'top-right', slug: 'use-motusai-in-weixin', yaw: 38, pitch: 26 },
  { id: 'wecom', corner: 'bottom-right', slug: 'use-motusai-in-wecom', yaw: 38, pitch: -24 },
].map((item) => ({
  ...item,
  href: `https://motusseed.com/guides/${item.slug}`,
  look: { yaw: item.yaw, pitch: item.pitch, mix: 1, spin: 0, wander: 0.18 } satisfies Look,
}))

export type DiscoveryPhase = 'look' | 'visible' | 'front' | 'wink' | 'rest' | 'leaving' | 'gap'

export const discoveryFrontLook: Look = { yaw: 0, pitch: 0, mix: 1, spin: 0, wander: 0 }

export const discoveryTiming: Record<DiscoveryPhase, number> = {
  look: 320,
  visible: 3_000,
  front: 400,
  wink: 700,
  rest: 1_800,
  leaving: 160,
  gap: 500,
}

// Let the original return-to-idle morph finish before directing the eyes.
export const discoveryIdleDelay = 650
