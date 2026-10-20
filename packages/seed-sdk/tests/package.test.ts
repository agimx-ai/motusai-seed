import { execFile } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';
import { build } from 'esbuild';

const run = promisify(execFile);
const directories: string[] = [];
afterEach(async () => {
  await Promise.all(directories.splice(0).map(path => rm(path, { recursive: true, force: true })));
});

describe('published SDK boundary', () => {
  it('keeps the full browser API while the Node entry loads only the runtime', async () => {
    const { stdout } = await run(process.execPath, ['--conditions=browser', '--input-type=module', '-e', `
      import assert from 'node:assert/strict';
      import {createRequire} from 'node:module';
      import {PluginService,PluginSettingTab,toast} from '@motus-ai/seed-sdk';
      const require = createRequire(import.meta.url);
      const sdk = require('@motus-ai/seed-sdk');
      assert.equal(typeof sdk.PluginService, 'function');
      assert.equal(typeof sdk.PluginSettingTab, 'function');
      assert.equal(PluginService, sdk.PluginService);
      assert.equal(PluginSettingTab, sdk.PluginSettingTab);
      assert.equal(toast, sdk.toast);
      assert.equal(sdk.toast, require('sonner').toast);
      assert(!Object.keys(require.cache).some(path => path.includes('/seed-sdk/dist/tools/')));
      console.log('browser API preserved');
    `], { cwd: process.cwd() });
    expect(stdout).toContain('browser API preserved');
  });

  it('builds and typechecks an independent consumer using only the published files', async () => {
    const root = await mkdtemp(join(tmpdir(), 'seed-sdk-published-'));
    directories.push(root);
    const published = join(root, 'sdk');
    const { stdout } = await run('npm', ['pack', '--dry-run', '--ignore-scripts', '--json', '-w', '@motus-ai/seed-sdk'], {
      shell: process.platform === 'win32',
    });
    const [metadata] = JSON.parse(stdout) as Array<{ files: Array<{ path: string }> }>;
    const files = metadata.files.map(file => file.path);
    expect(files).toContain('dist/tools/index.d.mts');
    expect(files).toContain('dist/tools/cli.mjs');
    expect(files.some(path => /^(src|tests|tools|scripts)\//.test(path) || path.endsWith('.map'))).toBe(false);
    for (const file of files) {
      const target = join(published, file);
      await mkdir(dirname(target), { recursive: true });
      await cp(resolve('packages/seed-sdk', file), target);
    }
    const directoryLink = process.platform === 'win32' ? 'junction' : 'dir';
    await symlink(resolve('node_modules'), join(published, 'node_modules'), directoryLink);
    const project = join(root, 'project');
    await cp(resolve('packages/seed-sdk/tests/fixtures/generic'), project, { recursive: true });
    await mkdir(join(project, 'node_modules/@motus-ai'), { recursive: true });
    await symlink(published, join(project, 'node_modules/@motus-ai/seed-sdk'), directoryLink);
    await writeFile(join(project, 'build.mts'), `
      import {toast, PluginSettingTab} from '@motus-ai/seed-sdk';
      import {buildPlugin, packPlugin, type BuildPluginOptions, type PluginPackageHook} from '@motus-ai/seed-sdk/tools';
      const options: BuildPluginOptions = {runtime:'native-host',service:'src/service.ts'};
      const hook: PluginPackageHook = ({manifest}) => [{manifest}];
      // @ts-expect-error unsupported runtime must not silently become any
      const invalid: BuildPluginOptions = {runtime:'legacy'};
      // @ts-expect-error resources require a source
      const resource: BuildPluginOptions = {resources:[{path:'icon.svg'}]};
      void [toast, PluginSettingTab, buildPlugin, packPlugin, options, hook, invalid, resource];
    `);
    await writeFile(join(project, 'tsconfig.json'), JSON.stringify({
      compilerOptions: {
        strict: true, noEmit: true, target: 'ES2022',
        module: 'NodeNext', moduleResolution: 'NodeNext', types: [],
      },
      files: ['build.mts'],
    }));
    await run(process.execPath, [resolve('node_modules/typescript/bin/tsc'), '-p', join(project, 'tsconfig.json')]);
    await run(process.execPath, ['--input-type=module', '-e', `
      import {buildPlugin,collectPluginFiles,packPlugin} from '@motus-ai/seed-sdk/tools';
      await buildPlugin({runtime:'native-host',service:'src/service.ts'});
      const {manifest} = await collectPluginFiles();
      if(manifest.apiVersion !== 2) throw new Error('Invalid plugin contract');
      await packPlugin();
    `], { cwd: project });
    expect(JSON.parse(await readFile(join(project, 'dist/manifest.json'), 'utf8')).apiVersion).toBe(2);
    await expect(build({
      stdin: {
        contents: "import {buildPlugin} from '@motus-ai/seed-sdk/tools'; console.log(buildPlugin)",
        resolveDir: project,
      },
      bundle: true, platform: 'browser', write: false, logLevel: 'silent',
    })).rejects.toThrow('Could not resolve');
  }, 15_000);
});
