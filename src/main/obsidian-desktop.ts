import { execFile } from 'node:child_process';
import { constants } from 'node:fs';
import { access, readFile, realpath } from 'node:fs/promises';
import { homedir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import { promisify } from 'node:util';
import { app } from 'electron';
import { z } from 'zod';
import type { ObsidianPluginActivation } from '../shared/obsidian-plugin';
import { obsidianPluginId } from './obsidian-plugin-installer';

const registrySchema = z.object({
  cli: z.unknown().optional(),
  vaults: z.record(z.string(), z.unknown()).optional(),
});
const vaultSchema = z.object({ path: z.string().min(1), open: z.unknown().optional() });
const execute = promisify(execFile);

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

async function findCli() {
  const home = homedir();
  const localAppData = process.env.LOCALAPPDATA;
  const candidates = process.platform === 'darwin'
    ? ['/Applications/Obsidian.app/Contents/MacOS/obsidian-cli', join(home, 'Applications/Obsidian.app/Contents/MacOS/obsidian-cli')]
    : process.platform === 'win32'
      ? (localAppData && isAbsolute(localAppData)
        ? [join(localAppData, 'Obsidian/Obsidian.com'), join(localAppData, 'Programs/Obsidian/Obsidian.com')]
        : [])
      : [join(home, '.local/bin/obsidian')];
  for (const candidate of candidates) {
    if (await access(candidate, constants.X_OK).then(() => true, () => false)) return candidate;
  }
  return null;
}

export async function activateObsidianPlugin(
  path: string,
  update: boolean,
): Promise<ObsidianPluginActivation> {
  const fallback = update ? 'reload' : 'enable';
  const config = await readVaultRegistry();
  if (config.cli !== true) return fallback;
  const cli = await findCli();
  if (!cli) return fallback;
  for (const [id, entry] of Object.entries(config.vaults ?? {})) {
    const vault = vaultSchema.safeParse(entry);
    // The official CLI may launch Obsidian. Only attempt activation for an open registered vault.
    if (!/^[a-f0-9]{16}$/i.test(id) || !vault.success || vault.data.open !== true) continue;
    if (await realpath(vault.data.path).catch(() => null) !== path) continue;
    const command = async (...args: string[]) => {
      const { stdout, stderr } = await execute(cli, [`vault=${id}`, ...args], {
        cwd: homedir(), timeout: 10_000, maxBuffer: 1024 * 1024, windowsHide: true,
      });
      if (/^(Error:|Command line interface is not enabled|The CLI is unable)/im.test(`${stdout}\n${stderr}`)) {
        throw new Error('Obsidian CLI could not activate the plugin');
      }
      return stdout.trim();
    };
    const actual = await command('vault', 'info=path');
    if (!isAbsolute(actual) || await realpath(actual) !== path) return fallback;
    const enabled = async () => (await command('plugins:enabled', 'filter=community')).split(/\r?\n/).some((line) => line.trim() === obsidianPluginId);
    if (await enabled()) await command('plugin:reload', `id=${obsidianPluginId}`);
    else if (update) return 'enable';
    else await command('plugin:enable', `id=${obsidianPluginId}`);
    return await enabled() ? 'active' : fallback;
  }
  return fallback;
}
