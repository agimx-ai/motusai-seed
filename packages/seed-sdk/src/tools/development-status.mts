import { lstat, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pluginDevelopmentStatusFile, type PluginDevelopmentStatus } from '../development-status.js';

export async function readDevelopmentFeedback(directory: string, id: string, manifestDigest: string): Promise<string> {
  const target = join(directory, pluginDevelopmentStatusFile);
  const metadata = await lstat(target).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== 'ENOENT') throw error;
    return undefined;
  });
  if (!metadata) return 'Waiting for Seed. Start Seed and enable Plugin development mode in Plugin settings.';
  if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size > 256 * 1024)
    return 'Cannot read Seed development status. Check the development directory.';
  let status: PluginDevelopmentStatus;
  try {
    status = JSON.parse(await readFile(target, 'utf8'));
  } catch {
    return 'Waiting for a valid Seed development status.';
  }
  if (
    status.schemaVersion !== 1 ||
    !Number.isInteger(status.pid) ||
    status.pid < 1 ||
    typeof status.updatedAt !== 'number' ||
    Date.now() - status.updatedAt > 10_000 ||
    status.updatedAt > Date.now() + 10_000
  )
    return 'Waiting for Seed. Start a compatible Seed client with Plugin development mode enabled.';
  try {
    process.kill(status.pid, 0);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EPERM')
      return 'Seed is not running. Start Seed to load this development plugin.';
  }
  if (status.enabled !== true) return 'Seed is running with Plugin development mode off. Enable it in Plugin settings.';
  const plugin = status.plugins?.[id];
  // Feedback belongs to an exact bundle; a previous generation must never acknowledge a new build.
  if (!plugin || plugin.manifestDigest !== manifestDigest) return 'Synced; waiting for Seed to load this build.';
  if (plugin.state === 'loaded') return 'Seed loaded this build. Open the plugin page to verify its interface.';
  if (plugin.state === 'failed')
    return 'Seed could not load this build: ' + (plugin.message || 'See Seed activity records.');
  if (plugin.state === 'superseded')
    return 'Seed selected a newer installed version. Increase the development version to test this build.';
  return 'Seed is loading this build.';
}
