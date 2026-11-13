import { z } from 'zod';

const iconId = z.string().regex(/^[a-z0-9-]{1,64}$/);
const entrySchema = z.object({ id: iconId, name: z.string().trim().min(1).max(80), icon_id: iconId });
export type McpClientEntry = z.infer<typeof entrySchema> & { uploadedIconUrl?: string };
export const mcpClientsResponseSchema = z.object({
  clients: z.array(iconId).max(50),
  entries: z.array(entrySchema).max(50).refine((entries) => new Set(entries.map(({ id }) => id)).size === entries.length).optional(),
});

