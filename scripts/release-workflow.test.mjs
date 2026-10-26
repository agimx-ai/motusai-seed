import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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

test('client and SDK release gates run before drafting and publish the same SDK artifact before GitHub', async () => {
  const workflow = parse(await readFile(new URL('../.github/workflows/release.yml', import.meta.url), 'utf8'));
  const { scripts } = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  assert.equal(scripts['version:check'], 'node scripts/update-client-version.mjs --check');
  assert.equal(scripts['publish:sdk'], undefined);
  const metadata = workflow.jobs.metadata.steps;
  const versionCheck = metadata.findIndex((step) => step.run?.includes('npm run version:check'));
  assert.ok(versionCheck >= 0 && versionCheck < metadata.findIndex((step) => step.name === 'Create or resume draft Release'));
  const sdk = workflow.jobs.sdk;
  assert.equal(sdk.needs, 'metadata');
  assert.equal(sdk.permissions['id-token'], undefined);
  assert.ok(sdk.steps.some((step) => step.run?.includes('npm pack --workspace @motus-ai/seed-sdk')));
  assert.ok(!sdk.steps.some((step) => step.run?.includes('npm publish')));
  assert.ok(sdk.steps.some((step) => step.run?.includes('sdk-release/motus-ai-seed-sdk-${RELEASE_VERSION}.tgz')));
  const publish = workflow.jobs.publish;
  for (const prerequisite of ['metadata', 'sdk', 'macos', 'windows', 'linux']) {
    assert.ok(publish.needs.includes(prerequisite));
  }
  assert.equal(publish.permissions['id-token'], 'write');
  const verify = publish.steps.findIndex((step) => step.name === 'Verify draft Release assets');
  const npm = publish.steps.findIndex((step) => step.run?.includes('node scripts/publish-sdk.mjs'));
  const github = publish.steps.findIndex((step) => step.run?.includes('--draft=false'));
  assert.ok(verify >= 0 && npm > verify && github > npm);
  assert.ok(publish.steps[verify].run.includes('motus-ai-seed-sdk-${RELEASE_VERSION}.tgz'));
  assert.ok(publish.steps[npm].run.includes('gh release download'));
  assert.ok(publish.steps[npm].run.includes('sdk-release/motus-ai-seed-sdk-${RELEASE_VERSION}.tgz'));
  assert.equal(publish.steps[github].id, 'publication');
  assert.equal(workflow.jobs['notify-website'].needs, 'publish');
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

test('tag pushes dispatch the exact release tag from the default branch so future versions can share caches', async () => {
  const workflow = parse(await readFile(new URL('../.github/workflows/release.yml', import.meta.url), 'utf8'));
  assert.deepEqual(Object.keys(workflow.on).sort(), ['push', 'workflow_dispatch']);
  assert.deepEqual(workflow.on.push, { tags: ['*.*.*'] });
  const dispatch = workflow.jobs['dispatch-release'];
  assert.equal(dispatch.if, "github.event_name == 'push'");
  assert.equal(dispatch.permissions.actions, 'write');
  assert.equal(workflow.jobs.metadata.if, "github.event_name == 'workflow_dispatch'");
  assert.ok(workflow.concurrency.group.includes('github.event_name'));
  const step = dispatch.steps[0];
  assert.equal(step.env.DEFAULT_BRANCH, '${{ github.event.repository.default_branch }}');
  assert.equal(step.env.RELEASE_TAG, '${{ github.ref_name }}');
  assert.equal(step.run, 'gh workflow run release.yml --ref "$DEFAULT_BRANCH" -f "tag=$RELEASE_TAG"');
  for (const name of ['metadata', 'sdk', 'macos', 'windows', 'linux', 'publish']) {
    assert.equal(
      workflow.jobs[name].steps.find((step) => step.name === 'Check out source').with.ref,
      "${{ github.event_name == 'workflow_dispatch' && inputs.tag || github.ref_name }}",
    );
  }
});

test('npm cache falls back only within a platform, always installs the lockfile and saves before building', async () => {
  const workflow = parse(await readFile(new URL('../.github/workflows/release.yml', import.meta.url), 'utf8'));
  const action = parse(await readFile(new URL('../.github/actions/setup-dependencies/action.yml', import.meta.url), 'utf8'));
  const steps = action.runs.steps;
  const restore = steps.find((step) => step.id === 'npm-cache');
  const save = steps.find((step) => step.name === 'Save npm download cache');
  const install = steps.find((step) => step.name === 'Install locked dependencies');
  const expand = (template, os, arch, hash) => template
    .replaceAll('${{ runner.os }}', os)
    .replaceAll('${{ steps.npm.outputs.arch }}', arch)
    .replaceAll("${{ hashFiles('package-lock.json') }}", hash).trim();
  const targets = [['Linux', 'x64'], ['Windows', 'x64'], ['macOS', 'arm64']];
  for (const [os, arch] of targets) {
    const fallback = expand(restore.with['restore-keys'], os, arch, 'new');
    assert.ok(expand(restore.with.key, os, arch, 'old').startsWith(fallback));
    assert.notEqual(expand(restore.with.key, os, arch, 'old'), expand(restore.with.key, os, arch, 'new'));
    for (const [otherOs, otherArch] of targets.filter(([a, b]) => a !== os || b !== arch)) {
      assert.ok(!expand(restore.with.key, otherOs, otherArch, 'old').startsWith(fallback));
    }
  }
  assert.equal(restore.with.path, '${{ steps.npm.outputs.path }}');
  assert.ok(steps.find((step) => step.id === 'npm').run.includes('npm config get cache'));
  assert.equal(steps[0].with['package-manager-cache'], false);
  assert.equal(install.env.SDK_ONLY, '${{ inputs.sdk-only }}');
  assert.ok(install.run.includes('--timing'));
  assert.equal(install.if, undefined);
  assert.ok(steps.indexOf(save) > steps.indexOf(install));
  assert.equal(save.with.key, '${{ steps.npm-cache.outputs.cache-primary-key }}');
  for (const name of ['sdk', 'macos', 'windows', 'linux']) {
    const job = workflow.jobs[name].steps;
    const setup = job.findIndex((step) => step.id === 'dependencies');
    assert.equal(job[setup].uses, './.github/actions/setup-dependencies');
    assert.ok(setup > job.findIndex((step) => step.name === 'Check out source'));
    assert.ok(setup < job.findIndex((step) => step.name.startsWith('Build ')));
  }
});

test('desktop jobs cache Electron and packaging tools separately from npm and preserve downloads on build failure', async () => {
  const workflow = parse(await readFile(new URL('../.github/workflows/release.yml', import.meta.url), 'utf8'));
  const action = parse(await readFile(new URL('../.github/actions/setup-dependencies/action.yml', import.meta.url), 'utf8'));
  const paths = action.runs.steps.find((step) => step.id === 'paths');
  assert.ok(paths.run.includes('electron_config_cache'));
  assert.ok(paths.run.includes('ELECTRON_BUILDER_CACHE'));
  assert.ok(paths.run.includes('process.env.GITHUB_ENV'));
  const restore = action.runs.steps.find((step) => step.id === 'packaging');
  assert.equal(restore.if, "inputs.packaging == 'true'");
  assert.ok(restore.with.key.startsWith('seed-packaging-${{ runner.os }}-${{ steps.npm.outputs.arch }}-'));
  assert.ok(!restore.with.path.includes('node_modules'));
  assert.ok(!restore.with.path.includes('release/'));
  for (const name of ['macos', 'windows', 'linux']) {
    const steps = workflow.jobs[name].steps;
    assert.equal(steps.find((step) => step.id === 'dependencies').with.packaging, 'true');
    const save = steps.findIndex((step) => step.name === 'Save packaging downloads');
    const build = steps.findIndex((step) => step.name.startsWith('Build '));
    const verify = steps.findIndex((step) => step.name.startsWith('Verify '));
    assert.ok(build < save && save < verify);
    assert.ok(steps[save].if.includes('!cancelled()'));
    assert.ok(steps[save].if.includes("packaging-key != ''"));
    assert.equal(steps[save].with.path, '${{ steps.dependencies.outputs.packaging-paths }}');
    assert.equal(steps[save].with.key, '${{ steps.dependencies.outputs.packaging-key }}');
  }
  assert.deepEqual(workflow.jobs.sdk.steps.find((step) => step.id === 'dependencies').with, { 'sdk-only': 'true' });
});

test('SDK-only installation excludes desktop dependencies while desktop jobs keep full installation and npm timing', async () => {
  const workflow = parse(await readFile(new URL('../.github/workflows/release.yml', import.meta.url), 'utf8'));
  const action = parse(await readFile(new URL('../.github/actions/setup-dependencies/action.yml', import.meta.url), 'utf8'));
  assert.equal(action.inputs['sdk-only'].default, 'false');
  for (const name of ['macos', 'windows', 'linux']) {
    assert.equal(workflow.jobs[name].steps.find((step) => step.id === 'dependencies').with['sdk-only'], undefined);
  }
  const run = action.runs.steps.find((step) => step.name === 'Install locked dependencies').run;
  const root = await mkdtemp(join(tmpdir(), 'seed-install-args-'));
  try {
    await writeFile(join(root, 'npm'), '#!/usr/bin/env bash\nprintf "%s\\n" "$@"\nexit "${MOCK_NPM_EXIT:-0}"\n', { mode: 0o755 });
    const execute = (sdkOnly, exit = '0') => promisify(execFile)('bash', ['-e', '-c', run], {
      env: { ...process.env, PATH: `${root}:${process.env.PATH}`, SDK_ONLY: sdkOnly, MOCK_NPM_EXIT: exit },
    });
    const base = ['ci', '--prefer-offline', '--no-fund', '--timing'];
    assert.deepEqual((await execute('false')).stdout.trim().split('\n'), base);
    assert.deepEqual((await execute('true')).stdout.trim().split('\n'), [
      ...base, '--workspace=@motus-ai/seed-sdk', '--include-workspace-root=false', '--include=dev', '--include=optional',
    ]);
    await assert.rejects(execute('invalid'), (error) => error.code === 1 && error.stdout === '');
    await assert.rejects(execute('true', '23'), (error) => error.code === 23);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});


test('packaging cache setup exports actual tool directories even when the runner path contains spaces', async () => {
  const action = parse(await readFile(new URL('../.github/actions/setup-dependencies/action.yml', import.meta.url), 'utf8'));
  const root = await mkdtemp(join(tmpdir(), 'seed runner cache '));
  const environment = join(root, 'environment');
  const output = join(root, 'output');
  try {
    await writeFile(environment, '');
    await writeFile(output, '');
    await promisify(execFile)('bash', ['-e', '-c', action.runs.steps.find((step) => step.id === 'paths').run], {
      env: { ...process.env, RUNNER_TEMP: root, GITHUB_ENV: environment, GITHUB_OUTPUT: output },
    });
    const parseLines = (text) => Object.fromEntries(text.trim().split('\n').map((line) => {
      const separator = line.indexOf('=');
      return [line.slice(0, separator), line.slice(separator + 1)];
    }));
    const variables = parseLines(await readFile(environment, 'utf8'));
    const paths = parseLines(await readFile(output, 'utf8'));
    assert.equal(variables.electron_config_cache, join(root, 'seed-electron-downloads'));
    assert.equal(variables.ELECTRON_BUILDER_CACHE, join(root, 'seed-builder-downloads'));
    assert.equal(paths.electron, variables.electron_config_cache);
    assert.equal(paths.builder, variables.ELECTRON_BUILDER_CACHE);
    // Check the installed builder uses the exported override, without downloading or packaging.
    const { stdout } = await promisify(execFile)(process.execPath, ['-e',
      'require("builder-util").getUserDefinedCacheDir().then(path => process.stdout.write(path))',
    ], { env: { ...process.env, ...variables } });
    assert.equal(stdout, paths.builder);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
