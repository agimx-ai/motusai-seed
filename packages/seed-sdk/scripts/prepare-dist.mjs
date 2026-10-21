import { chmod, cp, mkdir, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';

const packageRoot = resolve(import.meta.dirname, '..');
async function copy(directory, target) {
  await mkdir(target, { recursive: true });
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const source = resolve(directory, entry.name),
      destination = resolve(target, entry.name);
    if (entry.isDirectory()) await copy(source, destination);
    else if (!/\.tsx?$/.test(entry.name)) await cp(source, destination);
  }
}
await copy(resolve(packageRoot, 'src/react'), resolve(packageRoot, 'dist/react'));
for (const name of ['theme.css', 'components.css', 'tour.css'])
  await cp(resolve(packageRoot, 'src', name), resolve(packageRoot, 'dist', name));
await chmod(resolve(packageRoot, 'dist/tools/cli.mjs'), 0o755);
