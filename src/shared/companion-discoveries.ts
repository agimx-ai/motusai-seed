import { z } from 'zod';
const url = z.url().max(2048).refine((value) => { const parsed = new URL(value); return parsed.protocol === 'https:' && !parsed.username && !parsed.password; });
export const companionDiscoverySchema = z.object({
  corner: z.enum(['top-left', 'bottom-left', 'top-right', 'bottom-right']),
  enabled: z.boolean(),
  title: z.object({ 'zh-CN': z.string().trim().min(1).max(48), 'en-US': z.string().trim().min(1).max(48) }).strict(),
  url,
}).strict();
export const companionDiscoveryFeedSchema = z.object({
  revision: z.number().int().positive(),
  items: z.array(companionDiscoverySchema).length(4).refine((items) => new Set(items.map((item) => item.corner)).size === 4),
  updated_at: z.string().datetime(),
}).strict();
export type CompanionDiscovery = z.infer<typeof companionDiscoverySchema>;
