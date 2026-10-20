import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { parse } from 'yaml';

const root = resolve(import.meta.dirname, '..');
const { version } = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'));
const channel = process.env.MOTUSAI_UPDATE_CHANNEL || 'stable';
assert.ok(['stable', 'beta'].includes(channel), 'Invalid update channel.');
const metadataName = channel === 'stable' ? 'latest-linux.yml' : 'beta-linux.yml';
const installerName = `MotusAI-Seed-${version}-linux-x64.deb`;
const installer = resolve(root, 'release', installerName);
const run = (command, args) => execFileSync(command, args, { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
assert.equal(run('dpkg-deb', ['-f', installer, 'Architecture']).trim(), 'amd64');
assert.equal(run('dpkg-deb', ['-f', installer, 'Version']).trim(), version);
const contents = run('dpkg-deb', ['--contents', installer]).split('\n');
for (const size of [16, 24, 32, 48, 64, 128, 256, 512]) {
  const path = `./usr/share/icons/hicolor/${size}x${size}/apps/motusai-seed.png`;
  assert.ok(contents.some((line) => line.endsWith(` ${path}`)), `Missing ${path}`);
}
const desktop = run('bash', ['-o', 'pipefail', '-c',
  'dpkg-deb --fsys-tarfile "$1" | tar -xOf - ./usr/share/applications/motusai-seed.desktop',
  'verify-linux-package', installer,
]).split('\n');
assert.ok(desktop.includes('Icon=motusai-seed'));
assert.ok(desktop.includes('StartupWMClass=motusai-seed'));
const metadata = parse(await readFile(resolve(root, 'release', metadataName), 'utf8'));
assert.equal(metadata.version, version);
const record = metadata.files.find((file) => file.url === installerName);
assert.ok(record, 'Update feed must reference the DEB.');
const body = await readFile(installer);
assert.equal(body.length, record.size);
assert.equal(createHash('sha512').update(body).digest('base64'), record.sha512);
const map = JSON.parse(gunzipSync(await readFile(`${installer}.blockmap`)));
assert.equal(map.version, '2');
assert.equal(map.files.length, 1);
assert.equal(map.files[0].sizes.reduce((sum, size) => sum + size, 0), body.length);
assert.equal(map.files[0].checksums.length, map.files[0].sizes.length);
const bundleName = `MotusAI-Seed-${version}-linux-x64-update-feed.zip`;
const entries = run('unzip', ['-Z', '-1', resolve(root, 'release', bundleName)]).trim().split('\n').sort();
assert.deepEqual(entries, [metadataName, installerName, `${installerName}.blockmap`].sort());
console.log(JSON.stringify({
  version,
  commit: process.env.GITHUB_SHA || null,
  installer: installerName,
  sha256: createHash('sha256').update(body).digest('hex'),
  architecture: 'amd64',
  iconSizes: [16, 24, 32, 48, 64, 128, 256, 512],
  updateBundle: bundleName,
}, null, 2));
