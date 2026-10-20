#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { packPlugin, readPackageVariants } from './package.mjs';
import { developPlugin } from './development.mjs';

if (process.argv[2] === 'dev') {
  const args = process.argv.slice(3);
  if (args.length && (args.length !== 2 || args[0] !== '--directory'))
    throw new Error('Usage: seed-plugin dev [--directory <development-root>]');
  const controller = new AbortController();
  const interrupt = () => controller.abort();
  // npm can forward a terminal signal again while asynchronous cleanup is still running.
  process.on('SIGINT', interrupt);
  process.on('SIGTERM', interrupt);
  await developPlugin({ directory: args[1], signal: controller.signal });
} else {
  if (process.argv[2] !== 'pack' || process.argv.length > 3)
    throw new Error('Usage: seed-plugin pack (run inside a built plugin project)');
  const root = process.cwd();
  const manifest = JSON.parse(await readFile(resolve(root, 'dist/manifest.json'), 'utf8'));
  const variants = await readPackageVariants(root, manifest);
  for (const variant of variants) process.stdout.write(JSON.stringify(await packPlugin({ root, variant })) + '\n');
}
