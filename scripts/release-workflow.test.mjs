import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import { test } from 'vitest';
import { parse } from 'yaml';

test('desktop packaging uses current build scripts without the removed Python preparation', async () => {
  const workflow = parse(await readFile(new URL('../.github/workflows/release.yml', import.meta.url), 'utf8'));
  const { scripts } = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  for (const name of ['macos', 'windows', 'linux']) {
    const steps = workflow.jobs[name].steps;
    assert.ok(!steps.some((step) => step.uses?.startsWith('astral-sh/setup-uv@')));
    const commands = steps.map((step) => step.run ?? '').join('\n') + '\n' + (name === 'linux' ? scripts['package:linux'] : '');
    assert.ok(!commands.includes('python:prepare'));
    assert.ok(commands.includes('npm run build'));
    for (const [, script] of commands.matchAll(/npm run ([a-z0-9:-]+)/g)) {
      assert.equal(typeof scripts[script], 'string', `Missing packaging script: ${script}`);
    }
  }
});

test('publishing waits for Ubuntu packages and verifies the Linux installer and feed', async () => {
  const workflow = parse(await readFile(new URL('../.github/workflows/release.yml', import.meta.url), 'utf8'));
  assert.equal(workflow.jobs.linux['runs-on'], 'ubuntu-24.04');
  assert.equal(workflow.jobs.linux.env.MOTUSAI_RELEASE_PLATFORM, 'linux-x64');
  assert.ok(workflow.jobs.publish.needs.includes('linux'));
  const commands = workflow.jobs.linux.steps.map((step) => step.run ?? '').join('\n');
  assert.ok(commands.includes('npm run package:linux'));
  assert.ok(commands.includes('node scripts/verify-linux-package.mjs'));
  const publication = workflow.jobs.publish.steps.map((step) => step.run ?? '').join('\n');
  for (const asset of ['linux-x64.deb', 'linux-x64.deb.blockmap']) {
    assert.ok(publication.includes(asset), `Missing publication gate: ${asset}`);
  }
});

test('Linux production packaging uses the locked Electron runtime and never publishes directly', async () => {
  const { scripts } = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  assert.ok(scripts['package:linux'].includes('--linux deb --x64 --publish never'));
  assert.ok(scripts['package:linux'].includes('npm exec -- install-electron --no'));
  assert.ok(scripts['package:linux'].includes('node scripts/create-update-feed.mjs'));
});

test('Linux launcher identity matches the app and uses a multi-resolution icon source', async () => {
  const root = new URL('../', import.meta.url);
  const { stdout } = await promisify(execFile)(process.execPath, ['--input-type=module', '-e',
    'import config from "./electron-builder.config.mjs"; console.log(JSON.stringify(config.linux))',
  ], { cwd: root, env: { ...process.env, MOTUSAI_RELEASE_PLATFORM: 'linux-x64', MOTUSAI_SEED_CLOUD_URL: 'https://cloud.example.test' } });
  const linux = JSON.parse(stdout);
  const metadata = JSON.parse(await readFile(new URL('package.json', root), 'utf8'));
  assert.equal(metadata.desktopName, `${metadata.name}.desktop`);
  assert.equal(linux.syncDesktopName, true);
  assert.equal(linux.icon, 'resources/app/app-icon.icns');
  const icon = await readFile(new URL(linux.icon, root));
  assert.equal(icon.toString('ascii', 0, 4), 'icns');
  assert.equal(icon.readUInt32BE(4), icon.length);
  const representations = new Set();
  for (let offset = 8; offset < icon.length;) {
    const length = icon.readUInt32BE(offset + 4);
    assert.ok(length >= 8 && offset + length <= icon.length);
    representations.add(icon.toString('ascii', offset, offset + 4));
    offset += length;
  }
  for (const types of [['ic04', 'icp4'], ['ic05', 'icp5'], ['ic12', 'icp6'], ['ic07'], ['ic08'], ['ic09']]) {
    assert.ok(types.some((type) => representations.has(type)), `Missing icon representation: ${types.join('/')}`);
  }
});
