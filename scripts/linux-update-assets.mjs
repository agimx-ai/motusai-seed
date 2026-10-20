import { createHash } from 'node:crypto';
import { open } from 'node:fs/promises';
import { buildBlockMap } from 'app-builder-lib/out/targets/blockmap/blockmap.js';

// Keep Cloud's existing three-file immutable installer bundle. Use the locked
// electron-builder's map implementation without changing the installer bytes.
export async function writeLinuxBlockmap(packagePath, fileRecord) {
  const file = await open(packagePath, 'r');
  try {
    const stat = await file.stat();
    if (!stat.isFile() || stat.size !== fileRecord?.size || !packagePath.endsWith('.deb'))
      throw new Error('Linux update feed must describe the DEB installer.');
    const hash = createHash('sha512');
    for await (const chunk of file.createReadStream({ autoClose: false })) hash.update(chunk);
    if (hash.digest('base64') !== fileRecord.sha512)
      throw new Error('Linux installer does not match its update feed.');
  } finally {
    await file.close();
  }
  await buildBlockMap(packagePath, 'gzip', `${packagePath}.blockmap`);
}
