import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { watch } from 'node:fs';
import { access, chmod, lstat, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { collectPluginFiles } from './index.mjs';

export function developmentPluginDirectory(platform = process.platform, environment = process.env, home = homedir()) {
  const appData =
    platform === 'darwin'
      ? join(home, 'Library/Application Support')
      : platform === 'win32'
        ? (environment.APPDATA ?? join(home, 'AppData/Roaming'))
        : (environment.XDG_CONFIG_HOME ?? join(home, '.config'));
  return join(appData, 'MotusAI Seed/plugins/development');
}

async function packageVariant(root, manifest) {
  const hook = join(root, 'package.mjs');
  if (
    !(await access(hook).then(
      () => true,
      () => false,
    ))
  )
    return undefined;
  const variants = await (
    await import(pathToFileURL(hook).href + '?generation=' + randomUUID())
  ).default({ pluginRoot: root, manifest });
  if (!Array.isArray(variants)) throw new Error('Package hook must return targets.');
  const matches = variants.filter(
    (variant) =>
      !variant ||
      (!variant.platform && !variant.architecture) ||
      (variant.platform === process.platform && variant.architecture === process.arch),
  );
  if (matches.length !== 1)
    throw new Error('The plugin must provide exactly one development target for this platform.');
  return matches[0];
}

/** Deploy the same declared files as .seedpkg, without producing or uploading an archive. */
export async function publishDevelopmentPlugin({
  root = process.cwd(),
  directory = developmentPluginDirectory(),
} = {}) {
  root = resolve(root);
  directory = resolve(directory);
  const built = JSON.parse(await readFile(join(root, 'dist/manifest.json'), 'utf8'));
  const variant = await packageVariant(root, built);
  const { manifest, entries } = await collectPluginFiles({ root, variant });
  await mkdir(directory, { recursive: true, mode: 0o700 });
  if ((await lstat(directory)).isSymbolicLink()) throw new Error('Development directory cannot be a symbolic link.');
  const staging = join(directory, '.building-' + randomUUID()),
    previous = join(directory, '.previous-' + randomUUID());
  const destination = join(directory, manifest.id);
  await mkdir(staging, { mode: 0o700 });
  const ownership = await lstat(staging);
  let moved = false;
  try {
    for (const [path, body] of entries) {
      const target = join(staging, path);
      await mkdir(dirname(target), { recursive: true, mode: 0o700 });
      await writeFile(target, body, { flag: 'wx', mode: 0o600 });
    }
    for (const sidecar of manifest.sidecars ?? []) await chmod(join(staging, sidecar.path), 0o700);
    const existing = await lstat(destination).catch((error) => {
      if (error.code !== 'ENOENT') throw error;
    });
    if (existing) {
      if (!existing.isDirectory() || existing.isSymbolicLink())
        throw new Error('Development destination must be a regular directory.');
      await rename(destination, previous);
      moved = true;
    }
    try {
      await rename(staging, destination);
    } catch (error) {
      if (moved) await rename(previous, destination);
      throw error;
    }
    if (moved) await rm(previous, { recursive: true, force: true });
    return { id: manifest.id, directory: destination, ownership: { dev: ownership.dev, ino: ownership.ino } };
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}

async function removeOwnedDevelopmentPlugin(deployed) {
  const parent = dirname(deployed.directory);
  const parentState = await lstat(parent).catch((error) => {
    if (error.code !== 'ENOENT') throw error;
  });
  if (!parentState) return;
  if (!parentState.isDirectory() || parentState.isSymbolicLink())
    throw new Error('Development directory must remain a regular directory.');
  const current = await lstat(deployed.directory).catch((error) => {
    if (error.code !== 'ENOENT') throw error;
  });
  const owns = (state) => state?.isDirectory() && !state.isSymbolicLink()
    && state.dev === deployed.ownership.dev && state.ino === deployed.ownership.ino;
  if (!owns(current)) return;
  const retiring = join(parent, '.cleanup-' + randomUUID());
  try {
    await rename(deployed.directory, retiring);
  } catch (error) {
    if (error.code === 'ENOENT') return;
    throw error;
  }
  // Recheck after the atomic rename: a concurrent deployment must never be deleted.
  if (!owns(await lstat(retiring))) {
    await rename(retiring, deployed.directory);
    return;
  }
  await rm(retiring, { recursive: true, force: true });
}

/** Watch an independent source project; its own build.mjs remains the authoritative build. */
export async function developPlugin({
  root = process.cwd(),
  directory,
  log = (message) => process.stdout.write(message + '\n'),
  signal,
} = {}) {
  root = resolve(root);
  directory = resolve(directory ?? developmentPluginDirectory());
  const ignored = new Set(['node_modules', 'dist', 'artifacts', '.git']);
  const deployed = new Map();
  let timer,
    child,
    stopped = false,
    pending = false,
    running,
    stopWork;
  const compile = async () => {
    do {
      pending = false;
      try {
        await new Promise((done, reject) => {
          child = spawn(process.execPath, [join(root, 'build.mjs')], { cwd: root, stdio: 'inherit' });
          child.once('error', reject);
          child.once('exit', (code) =>
            code === 0 ? done() : reject(new Error('Plugin build failed (' + code + ').')),
          );
        });
        child = undefined;
        if (!stopped) {
          const published = await publishDevelopmentPlugin({ root, directory });
          deployed.set(published.directory, published);
          log('Synced development plugin: ' + published.directory);
        }
      } catch (error) {
        if (!stopped) log(String(error));
      }
    } while (pending && !stopped);
  };
  const rebuild = () => {
    if (stopped) return Promise.resolve();
    if (running) {
      pending = true;
      return running;
    }
    running = compile().finally(() => {
      running = undefined;
    });
    return running;
  };
  const watcher = watch(root, { recursive: true }, (_event, filename) => {
    const path = filename?.toString().replaceAll('\\', '/');
    if (
      !path ||
      ignored.has(path.split('/')[0]) ||
      path.split('/')[0].startsWith('dist.') ||
      join(root, path).startsWith(directory + '/')
    )
      return;
    clearTimeout(timer);
    timer = setTimeout(() => void rebuild(), 100);
  });
  watcher.on('error', (error) => log(String(error)));
  const stop = () => {
    if (!stopWork) {
      stopped = true;
      clearTimeout(timer);
      watcher.close();
      child?.kill();
      stopWork = (async () => {
        await running;
        signal?.removeEventListener('abort', onAbort);
        for (const published of deployed.values()) await removeOwnedDevelopmentPlugin(published);
      })();
    }
    return stopWork;
  };
  const onAbort = () => void stop().catch((error) => {
    process.exitCode = 1;
    log(String(error));
  });
  signal?.addEventListener('abort', onAbort, { once: true });
  if (signal?.aborted) await stop();
  else await rebuild();
  if (!stopped) log('Watching source changes. Press Ctrl+C to stop. Seed loads the synced directory.');
  return { rebuild, stop };
}
