import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { test } from 'vitest';
import { writeLinuxBlockmap } from './linux-update-assets.mjs';

test('Linux release maps cover the actual installer without modifying its bytes', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'seed-linux-update-'));
  try {
    const path = join(directory, 'Seed-linux-x64.deb');
    const body = Buffer.concat([Buffer.from('!<arch>\n'), Buffer.alloc(48_000, 19)]);
    await writeFile(path, body);
    const record = { size: body.length, sha512: createHash('sha512').update(body).digest('base64') };
    await writeLinuxBlockmap(path, record);
    assert.deepEqual(await readFile(path), body);
    const map = JSON.parse(gunzipSync(await readFile(`${path}.blockmap`)));
    assert.equal(map.version, '2');
    assert.equal(map.files.length, 1);
    assert.equal(map.files[0].offset, 0);
    assert.equal(map.files[0].sizes.reduce((sum, value) => sum + value, 0), body.length);
    assert.equal(map.files[0].checksums.length, map.files[0].sizes.length);
    await assert.rejects(writeLinuxBlockmap(path, { ...record, size: body.length + 1 }), /DEB installer/);
    await assert.rejects(writeLinuxBlockmap(path, { ...record, sha512: 'wrong' }), /does not match/);
    await writeFile(join(directory, 'wrong.AppImage'), body);
    await assert.rejects(writeLinuxBlockmap(join(directory, 'wrong.AppImage'), record), /DEB installer/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
