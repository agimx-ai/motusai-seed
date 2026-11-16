import { createHash } from 'node:crypto';
import { copyFile, lstat, mkdir, mkdtemp, readFile, realpath, rename, rm, writeFile } from 'node:fs/promises';
import { basename, isAbsolute, join, parse } from 'node:path';
import { z } from 'zod';
import type {
  ObsidianPluginActivation,
  ObsidianPluginBatchResult,
  ObsidianPluginStatus,
  ObsidianPluginVaultError,
  ObsidianPluginVaultResult,
} from '../shared/obsidian-plugin';
import { compareSeedVersions, seedVersionPattern } from '../shared/seed-version';

export const obsidianPluginId = 'motusai-vault-agent';
const repository = 'agimx-ai/motusai-obsidian-agent';
const releaseUrl = `https://api.github.com/repos/${repository}/releases/latest`;
const releasesPage = `https://github.com/${repository}/releases`;
const stableTag = /^v?\d+\.\d+\.\d+$/;
const files = ['main.js', 'styles.css', 'manifest.json'] as const;
const limits = { 'main.js': 64 * 1024 * 1024, 'styles.css': 4 * 1024 * 1024, 'manifest.json': 32 * 1024 };
const versionSchema = z.string().max(80).regex(seedVersionPattern);
const manifestSchema = z.object({ id: z.literal(obsidianPluginId), version: versionSchema });
const assetSchema = z.object({
  name: z.string(),
  size: z.number().int().positive(),
  digest: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  browser_download_url: z.string(),
});
const releaseSchema = z.object({
  tag_name: z.string().max(81),
  draft: z.literal(false),
  prerelease: z.literal(false),
  assets: z.array(z.object({ name: z.string() }).passthrough()),
});

type Release = { version: string; assets: Map<(typeof files)[number], { url: string; digest: string; size?: number }> };
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

function releaseVersion(tag: string) {
  if (tag.length > 81 || !stableTag.test(tag)) throw new Error('Expected a stable Obsidian release');
  return tag.replace(/^v/, '');
}

async function getReleaseFromWebsite(fetchRelease: ReleaseFetch): Promise<Release> {
  // GitHub's anonymous REST quota can be shared by every user behind one IP.
  const latest = await fetchRelease(`${releasesPage}/latest`, { signal: AbortSignal.timeout(12_000) });
  const page = (await readResponse(latest, 1024 * 1024)).toString('utf8');
  const prefix = `${releasesPage}/expanded_assets/`;
  const fragments = [...page.matchAll(/<include-fragment\b[^>]*\bsrc="([^"]+)"/gi)]
    .map((match) => match[1]!)
    .filter((url) => url.startsWith(prefix));
  if (fragments.length !== 1) throw new Error('Invalid GitHub release page');
  const tag = fragments[0]!.slice(prefix.length);
  const version = releaseVersion(tag);
  const response = await fetchRelease(`${prefix}${tag}`, {
    redirect: 'error', signal: AbortSignal.timeout(12_000),
  });
  const html = (await readResponse(response, 512 * 1024)).toString('utf8');
  const rows = html.match(/<li\b[^>]*>[\s\S]*?<\/li>/gi) ?? [];
  const assets: Release['assets'] = new Map();
  for (const name of files) {
    const path = `/${repository}/releases/download/${tag}/${name}`;
    const matches = rows.filter((row) => row.includes(`href="${path}"`));
    const digest = matches.length === 1
      ? matches[0]?.match(/<clipboard-copy\b[^>]*\bvalue="(sha256:[a-f0-9]{64})"/)?.[1]
      : undefined;
    if (!digest) throw new Error('Missing published Obsidian release digest');
    assets.set(name, { url: `https://github.com${path}`, digest });
  }
  return { version, assets };
}

async function getRelease(fetchRelease: ReleaseFetch): Promise<Release> {
  const response = await fetchRelease(releaseUrl, {
    headers: { Accept: 'application/vnd.github+json' },
    redirect: 'error',
    signal: AbortSignal.timeout(12_000),
  });
  if (response.status === 403 || response.status === 429) {
    await response.body?.cancel();
    return getReleaseFromWebsite(fetchRelease);
  }
  const json = await readResponse(response, 512 * 1024);
  const release = releaseSchema.parse(JSON.parse(json.toString('utf8')));
  const version = releaseVersion(release.tag_name);
  const assets: Release['assets'] = new Map();
  for (const name of files) {
    const matches = release.assets.filter((asset) => asset.name === name);
    const asset = assetSchema.parse(matches.length === 1 ? matches[0] : undefined);
    const url = `${releasesPage}/download/${release.tag_name}/${name}`;
    if (asset.size > limits[name] || asset.browser_download_url !== url) {
      throw new Error('Unexpected Obsidian release asset');
    }
    assets.set(name, { url, size: asset.size, digest: asset.digest });
  }
  return { version, assets };
}

async function downloadRelease(fetchRelease: ReleaseFetch, release: Release): Promise<Distribution> {
  const results = await Promise.allSettled(files.map(async (name) => {
    const asset = release.assets.get(name)!;
    const response = await fetchRelease(asset.url, {
      headers: { Accept: 'application/octet-stream' },
      signal: AbortSignal.timeout(90_000),
    });
    const bytes = await readResponse(response, asset.size ?? limits[name]);
    const digest = createHash('sha256').update(bytes).digest('hex');
    if (!bytes.length || (asset.size !== undefined && bytes.length !== asset.size) || `sha256:${digest}` !== asset.digest) {
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

async function installRelease(distribution: Distribution, vault: InstalledVault) {
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
      for (const name of files) {
        await rename(join(staging, name), join(target, name));
        replaced.push(name);
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

  constructor(
    private readonly fetchRelease: ReleaseFetch,
    private readonly registeredVaultPaths: () => Promise<string[]>,
    private readonly activate: (path: string, update: boolean) => Promise<ObsidianPluginActivation>,
  ) {}

  installAll(): Promise<ObsidianPluginBatchResult> {
    this.installing ??= this.installBatch().finally(() => { this.installing = null; });
    return this.installing;
  }

  private latestRelease(force = false) {
    if (this.checkingRelease) return this.checkingRelease;
    if (!force && this.release && this.release.expires > Date.now()) return Promise.resolve(this.release.value);
    this.checkingRelease = getRelease(this.fetchRelease).then((value) => {
      this.release = { value, expires: Date.now() + 5 * 60_000 };
      return value;
    }).finally(() => { this.checkingRelease = null; });
    return this.checkingRelease;
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
    if (targets.some((vault) => vault.installedVersion === null)) return { state: 'install' };

    const release = await this.latestRelease(force).catch(() => null);
    if (!release) return { state: 'error', error: 'releaseUnavailable' };
    const actions = targets.map((vault) => vaultAction(vault, release.version));
    if (actions.includes('update')) return { state: 'update' };
    if (actions.includes('install')) return { state: 'install' };
    return failures.length ? { state: 'error', error: 'invalidVaults' } : { state: 'current' };
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

    const distribution = await downloadRelease(this.fetchRelease, release).catch(() => null);
    if (!distribution) return { ok: false, error: 'downloadFailed' };
    for (const vault of pending) {
      const { path } = vault;
      const name = basename(path);
      try {
        await installRelease(distribution, vault);
        const update = vault.installedVersion !== null;
        const fallback: ObsidianPluginActivation = update ? 'reload' : 'enable';
        const activation = await this.activate(path, update).catch(() => fallback);
        vaults.push({ path, name, status: update ? 'updated' : 'installed', version: release.version, activation });
      } catch (error) {
        vaults.push({ path, name, status: 'failed', error: error instanceof InstallerError ? error.code : 'installFailed' });
      }
    }
    return { ok: true, vaults };
  }
}
