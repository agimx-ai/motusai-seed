import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { app } from 'electron';
import { z } from 'zod';

const registrySchema = z.object({
  vaults: z.record(z.string(), z.unknown()).optional(),
});
const vaultSchema = z.object({ path: z.string().min(1) });

async function readVaultRegistry() {
  const path = join(app.getPath('appData'), 'obsidian', 'obsidian.json');
  const contents = await readFile(path, 'utf8').catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return '{}';
    throw error;
  });
  return registrySchema.parse(JSON.parse(contents));
}

export async function registeredObsidianVaultPaths(): Promise<string[]> {
  const config = await readVaultRegistry();
  return Object.values(config.vaults ?? {}).flatMap((entry) => {
    const vault = vaultSchema.safeParse(entry);
    return vault.success ? [vault.data.path] : [];
  });
}
