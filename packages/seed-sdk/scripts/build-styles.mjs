import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compile } from '@tailwindcss/node';
import { Scanner } from '@tailwindcss/oxide';

const root = resolve(import.meta.dirname, '..');
const compiler = await compile(await readFile(resolve(root, 'src/styles.css'), 'utf8'), {
  base: resolve(root, 'src'),
  onDependency() {},
});
const scanner = new Scanner({
  sources: [
    ...compiler.sources,
    { base: dirname(fileURLToPath(import.meta.resolve('streamdown'))), pattern: '*.js', negated: false },
  ],
});
// Publish ready-to-use shared styles; consumers do not need SDK TS sources or a Tailwind compiler.
await writeFile(resolve(root, 'dist/styles.css'), compiler.build(scanner.scan()));
