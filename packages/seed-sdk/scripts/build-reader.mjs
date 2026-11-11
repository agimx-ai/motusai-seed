import { cp, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';

const require = createRequire(import.meta.url);
const assets = resolve(import.meta.dirname, '../src/reader/themes');
const output = resolve(import.meta.dirname, '../dist/reader');
const catalog = JSON.parse(await readFile(join(assets, 'themes.json'), 'utf8'));
const palettes = new Set(['github', ...Object.values(catalog).map((theme) => theme.highlight)]);
const themes = Object.fromEntries(await Promise.all(Object.entries(catalog).map(async ([id, theme]) => [
  id, { style: await readFile(join(assets, 'styles', theme.file), 'utf8'), highlight: theme.highlight },
])));
const highlights = Object.fromEntries(await Promise.all([...palettes].map(async (palette) => [
  palette, await readFile(require.resolve(`highlight.js/styles/${palette}.css`), 'utf8'),
])));
await writeFile(join(output, 'theme-styles.mjs'), [
  '// Generated from the SDK Markdown renderer theme assets.',
  `export const themes = ${JSON.stringify(themes)};`,
  `export const highlights = ${JSON.stringify(highlights)};`,
  '',
].join('\n'));
await cp(join(assets, 'licenses'), join(output, 'licenses'), { recursive: true });
await cp(join(assets, 'LICENSE'), join(output, 'licenses/theme-collection.txt'));
await cp(require.resolve('highlight.js/package.json').replace(/package\.json$/, 'LICENSE'), join(output, 'licenses/highlight.js.txt'));
