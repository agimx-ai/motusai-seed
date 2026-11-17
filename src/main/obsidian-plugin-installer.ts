import { createHash } from 'node:crypto';
import { copyFile, lstat, mkdir, mkdtemp, readFile, realpath, rename, rm, writeFile } from 'node:fs/promises';
import { basename, isAbsolute, join, parse } from 'node:path';
import { z } from 'zod';
import type {
  ObsidianPluginBatchResult,
  ObsidianPluginStatus,
  ObsidianPluginVaultError,
  ObsidianPluginVaultResult,
} from '../shared/obsidian-plugin';
import { compareSeedVersions, seedVersionPattern } from '../shared/seed-version';

export const obsidianPluginId = 'motusai-vault-agent';
const releasesPath = '/api/v1/obsidian-plugin/releases/';
const files = ['main.js', 'styles.css', 'manifest.json'] as const;
const updateMarker = 'seed-update.json';
const limits = { 'main.js': 64 * 1024 * 1024, 'styles.css': 4 * 1024 * 1024, 'manifest.json': 32 * 1024 };
const versionSchema = z.string().max(80).regex(seedVersionPattern);
const manifestSchema = z.object({ id: z.literal(obsidianPluginId), version: versionSchema });
const assetSchema = z.object({
  name: z.enum(files),
  size: z.number().int().positive(),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
});
const releaseSchema = z.object({
  version: z.string().max(80).regex(/^\d+\.\d+\.\d+$/),
  assets: z.array(assetSchema).length(files.length),
});

type Release = z.infer<typeof releaseSchema>;
type ReleaseFetch = (url: string, init?: RequestInit) => Promise<Response>;
type Distribution = Record<(typeof files)[number], Buffer>;
type InstalledVault = { path: string; installedVersion: string | null; complete: boolean };

class InstallerError extends Error {
  constructor(readonly code: ObsidianPluginVaultError) {
    super(code);
  }
}

async function statIfPresent(path: string) {
  try {
    return await lstat(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    return null;
  }
}

async function inspectVault(path: string): Promise<InstalledVault> {
  const config = join(path, '.obsidian');
  if (await realpath(path).catch(() => null) !== path || !(await statIfPresent(config))?.isDirectory()) {
    throw new InstallerError('invalidVault');
  }
  const plugins = join(config, 'plugins');
  const directory = join(plugins, obsidianPluginId);
  for (const path of [plugins, directory]) {
    const stat = await statIfPresent(path);
    if (stat && !stat.isDirectory()) throw new InstallerError('invalidInstallation');
  }
  const entries = await Promise.all(files.map(async (name) => {
    const stat = await statIfPresent(join(directory, name));
    if (stat && !stat.isFile()) throw new InstallerError('invalidInstallation');
    return stat;
  }));
  const manifest = entries[2];
  let installedVersion = null;
  if (manifest) {
    if (manifest.size > limits['manifest.json']) throw new InstallerError('invalidInstallation');
    try {
      installedVersion = manifestSchema.parse(JSON.parse(await readFile(join(directory, 'manifest.json'), 'utf8'))).version;
    } catch {
      throw new InstallerError('invalidInstallation');
    }
  }
  return { path, installedVersion, complete: entries.every((stat) => Boolean(stat?.size)) };
}

async function readResponse(response: Response, limit: number) {
  if (!response.ok || !response.body) throw new Error('Could not fetch Obsidian release');
  const chunks: Uint8Array[] = [];
  let size = 0;
  const reader = response.body.getReader();
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) return Buffer.concat(chunks, size);
      size += chunk.value.byteLength;
      if (size > limit) {
        await reader.cancel();
        throw new Error('Obsidian release asset exceeds its size limit');
      }
      chunks.push(chunk.value);
    }
  } finally {
    reader.releaseLock();
  }
}

async function getRelease(fetchRelease: ReleaseFetch, base: URL): Promise<Release> {
  const response = await fetchRelease(new URL('latest', base).href, {
    headers: { Accept: 'application/json' },
    redirect: 'error',
    signal: AbortSignal.timeout(12_000),
  });
  const json = await readResponse(response, 32 * 1024);
  const release = releaseSchema.parse(JSON.parse(json.toString('utf8')));
  const names = new Set(release.assets.map(({ name }) => name));
  if (names.size !== files.length || release.assets.some(({ name, size }) => size > limits[name])) {
    throw new Error('Unexpected Obsidian release asset');
  }
  return release;
}

async function downloadRelease(fetchRelease: ReleaseFetch, base: URL, release: Release): Promise<Distribution> {
  const results = await Promise.allSettled(release.assets.map(async ({ name, size, sha256 }) => {
    const response = await fetchRelease(new URL(`${release.version}/${name}`, base).href, {
      headers: { Accept: 'application/octet-stream' },
      redirect: 'error',
      signal: AbortSignal.timeout(90_000),
    });
    const bytes = await readResponse(response, size);
    const digest = createHash('sha256').update(bytes).digest('hex');
    if (bytes.length !== size || digest !== sha256) {
      throw new Error('Invalid Obsidian release digest');
    }
    if (name === 'manifest.json' && manifestSchema.parse(JSON.parse(bytes.toString('utf8'))).version !== release.version) {
      throw new Error('Obsidian manifest does not match the release');
    }
    return [name, bytes] as const;
  }));
  const entries = results.map((result) => {
    if (result.status === 'rejected') throw result.reason;
    return result.value;
  });
  return Object.fromEntries(entries) as Distribution;
}

async function assertUnchanged(vault: InstalledVault) {
  const current = await inspectVault(vault.path);
  if (current.installedVersion !== vault.installedVersion || current.complete !== vault.complete) {
    throw new InstallerError('changed');
  }
}

async function installRelease(distribution: Distribution, vault: InstalledVault, version: string) {
  await assertUnchanged(vault);
  const config = join(vault.path, '.obsidian');
  const plugins = join(config, 'plugins');
  const target = join(plugins, obsidianPluginId);
  const staging = await mkdtemp(join(config, '.motusai-plugin-'));
  let preserveBackup = false;
  try {
    for (const name of files) {
      await writeFile(join(staging, name), distribution[name], { flag: 'wx' });
    }
    await assertUnchanged(vault);
    if (!(await statIfPresent(plugins))) await mkdir(plugins);
    if (!(await statIfPresent(target))) {
      await rename(staging, target);
      return;
    }

    // Only replace distribution files. Obsidian may be writing data.json in this directory.
    const previous = join(staging, 'previous');
    await mkdir(previous);
    const existing = new Set<string>();
    for (const name of files) {
      if (await statIfPresent(join(target, name))) {
        await copyFile(join(target, name), join(previous, name));
        existing.add(name);
      }
    }
    const replaced: string[] = [];
    try {
      if (vault.installedVersion !== null) {
        await writeFile(join(staging, updateMarker), JSON.stringify({ version }), { flag: 'wx' });
      }
      for (const name of files) {
        await rename(join(staging, name), join(target, name));
        replaced.push(name);
      }
      if (vault.installedVersion !== null) {
        // Publish the marker only once Obsidian can load the complete release.
        await rename(join(staging, updateMarker), join(target, updateMarker));
      }
    } catch (error) {
      const rollback = await Promise.allSettled(replaced.reverse().map((name) => existing.has(name)
        ? rename(join(previous, name), join(target, name))
        : rm(join(target, name), { force: true })));
      preserveBackup = rollback.some((result) => result.status === 'rejected');
      throw error;
    }
  } finally {
    if (!preserveBackup) await rm(staging, { recursive: true, force: true }).catch(() => {});
  }
}

function vaultAction(vault: InstalledVault, latestVersion: string) {
  if (!vault.installedVersion) return 'install';
  const comparison = compareSeedVersions(latestVersion, vault.installedVersion);
  if (comparison > 0) return 'update';
  if (comparison === 0 && !vault.complete) return 'install';
  return 'current';
}

export class ObsidianPluginInstaller {
  private installing: Promise<ObsidianPluginBatchResult> | null = null;
  private release: { value: Release; expires: number } | null = null;
  private checkingRelease: Promise<Release> | null = null;
  private readonly releaseBase: URL;

  constructor(
    cloudUrl: string,
    private readonly fetchRelease: ReleaseFetch,
    private readonly registeredVaultPaths: () => Promise<string[]>,
  ) {
    this.releaseBase = new URL(releasesPath, cloudUrl);
  }

  invalidateRelease() {
    this.release = null;
    this.checkingRelease = null;
  }

  installAll(): Promise<ObsidianPluginBatchResult> {
    this.installing ??= this.installBatch().finally(() => { this.installing = null; });
    return this.installing;
  }

  private latestRelease(force = false) {
    if (this.checkingRelease) return this.checkingRelease;
    if (!force && this.release && this.release.expires > Date.now()) return Promise.resolve(this.release.value);
    const checking = getRelease(this.fetchRelease, this.releaseBase).then((value) => {
      if (this.checkingRelease === checking) this.release = { value, expires: Date.now() + 5 * 60_000 };
      return value;
    }).finally(() => {
      if (this.checkingRelease === checking) this.checkingRelease = null;
    });
    this.checkingRelease = checking;
    return checking;
  }

  private async scanVaults() {
    const paths = await this.registeredVaultPaths().catch(() => null);
    if (!paths) return null;

    const checked = new Set<string>();
    const targets: InstalledVault[] = [];
    const failures: ObsidianPluginVaultResult[] = [];
    for (const suppliedPath of paths) {
      const resolved = isAbsolute(suppliedPath) ? await realpath(suppliedPath).catch(() => null) : null;
      const path = resolved ?? suppliedPath;
      if (checked.has(path)) continue;
      checked.add(path);
      try {
        if (!resolved || resolved === parse(resolved).root) throw new InstallerError('invalidVault');
        targets.push(await inspectVault(resolved));
      } catch (error) {
        failures.push({ path, name: basename(path), status: 'failed', error: error instanceof InstallerError ? error.code : 'invalidVault' });
      }
    }
    return { targets, failures };
  }

  async status(force = false): Promise<ObsidianPluginStatus> {
    const scan = await this.scanVaults();
    if (!scan) return { state: 'error', error: 'vaultsUnavailable' };
    const { targets, failures } = scan;
    if (!targets.length) return failures.length ? { state: 'error', error: 'invalidVaults' } : { state: 'noVaults' };
    const needsInstall = targets.some((vault) => vault.installedVersion === null);
    const installedVersions = [...new Set(targets.flatMap((vault) => vault.installedVersion ? [vault.installedVersion] : []))]
      .sort(compareSeedVersions);
    if (!installedVersions.length) return { state: 'install', updateAvailable: false };

    const release = await this.latestRelease(force).catch(() => null);
    if (!release) return needsInstall
      ? { state: 'install', installedVersions }
      : { state: 'error', error: 'releaseUnavailable', installedVersions };
    const actions = targets.map((vault) => vaultAction(vault, release.version));
    const updateAvailable = actions.includes('update');
    const targetVersion = updateAvailable ? release.version : undefined;
    if (needsInstall) return { state: 'install', updateAvailable, installedVersions, targetVersion };
    if (updateAvailable) return { state: 'update', installedVersions, targetVersion };
    if (actions.includes('install')) return { state: 'install', updateAvailable: false, installedVersions };
    return failures.length ? { state: 'error', error: 'invalidVaults', installedVersions } : { state: 'current', installedVersions };
  }

  private async installBatch(): Promise<ObsidianPluginBatchResult> {
    const scan = await this.scanVaults();
    if (!scan) return { ok: false, error: 'vaultsUnavailable' };
    const { targets, failures: vaults } = scan;
    if (!targets.length) return { ok: true, vaults };

    const release = await this.latestRelease(true).catch(() => null);
    if (!release) return { ok: false, error: 'releaseUnavailable' };
    const pending = targets.filter((vault) => {
      if (!vault.installedVersion || vaultAction(vault, release.version) !== 'current') return true;
      vaults.push({ path: vault.path, name: basename(vault.path), status: 'current', version: vault.installedVersion });
      return false;
    });
    if (!pending.length) return { ok: true, vaults };

    const distribution = await downloadRelease(this.fetchRelease, this.releaseBase, release).catch(() => null);
    if (!distribution) return { ok: false, error: 'downloadFailed' };
    for (const vault of pending) {
      const { path } = vault;
      const name = basename(path);
      try {
        await installRelease(distribution, vault, release.version);
        const update = vault.installedVersion !== null;
        vaults.push({ path, name, status: update ? 'updated' : 'installed', version: release.version });
      } catch (error) {
        vaults.push({ path, name, status: 'failed', error: error instanceof InstallerError ? error.code : 'installFailed' });
      }
    }
    return { ok: true, vaults };
  }
}
