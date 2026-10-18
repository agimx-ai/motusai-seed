#!/usr/bin/env node
import { access, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { packPlugin } from './index.mjs';
import { developPlugin } from './development.mjs';

if (process.argv[2] === 'dev') {
  const args = process.argv.slice(3);
  if (args.length && (args.length !== 2 || args[0] !== '--directory'))
    throw new Error('Usage: seed-plugin-tools dev [--directory <development-root>]');
  const controller = new AbortController();
  const interrupt = () => controller.abort();
  // npm can forward a terminal signal again while asynchronous cleanup is still running.
  process.on('SIGINT', interrupt);
  process.on('SIGTERM', interrupt);
  await developPlugin({ directory: args[1], signal: controller.signal });
} else {
  if (process.argv[2] !== 'pack' || process.argv.length > 3)
    throw new Error('Usage: seed-plugin-tools pack (run inside a built plugin project)');
  const root = process.cwd(),
    hook = resolve(root, 'package.mjs');
  const manifest = JSON.parse(await readFile(resolve(root, 'dist/manifest.json'), 'utf8'));
  const variants = await access(hook).then(
    async () => {
      const packageHook = (await import(pathToFileURL(hook).href)).default;
      return await packageHook({ pluginRoot: root, manifest });
    },
    () => [undefined],
  );
  if (!Array.isArray(variants) || !variants.length) throw new Error('Package hook returned no targets.');
  for (const variant of variants) process.stdout.write(JSON.stringify(await packPlugin({ root, variant })) + '\n');
}
