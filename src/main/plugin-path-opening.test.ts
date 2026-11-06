import { mkdtemp, mkdir, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ pick: vi.fn(), open: vi.fn(), execute: vi.fn() }));
vi.mock('electron', () => ({ dialog: { showOpenDialog: mocks.pick }, shell: { openPath: mocks.open } }));
vi.mock('node:child_process', () => ({ execFile: mocks.execute, spawn: vi.fn() }));
import { openPluginPath } from './plugin-path-opening';

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
  vi.resetAllMocks();
});
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'seed-path-opening-'));
  roots.push(root);
  const privateRoot = join(root, 'private');
  await mkdir(privateRoot);
  const file = join(privateRoot, '库存（中文）.csv');
  await writeFile(file, 'red,7');
  mocks.open.mockResolvedValue('');
  const active = vi.fn();
  return {
    root,
    privateRoot,
    file,
    options: { window: null, title: 'Open With', applicationLabel: 'Application', assertActive: active },
  };
}
it('opens private files but rejects traversal and symlinks before any OS action', async () => {
  const f = await fixture();
  await expect(openPluginPath(f.privateRoot, { path: f.file }, f.options)).resolves.toEqual({ opened: true });
  expect(mocks.open).toHaveBeenCalledExactlyOnceWith(await realpath(f.file));
  const outside = join(f.root, 'outside.csv');
  await writeFile(outside, 'secret');
  const link = join(f.privateRoot, 'escape.csv');
  await symlink(outside, link);
  for (const path of [outside, link, 'relative.csv'])
    await expect(openPluginPath(f.privateRoot, { path }, f.options)).rejects.toMatchObject({
      code: 'broker_path_denied',
    });
  expect(mocks.open).toHaveBeenCalledTimes(1);
  expect(mocks.pick).not.toHaveBeenCalled();
});
it('uses a native application chooser, handles cancel and checks the owner again before launching', async () => {
  const f = await fixture();
  mocks.pick.mockResolvedValueOnce({ canceled: true, filePaths: [] });
  await expect(openPluginPath(f.privateRoot, { path: f.file, operation: 'open_with' }, f.options)).resolves.toEqual({
    opened: false,
  });
  expect(mocks.execute).not.toHaveBeenCalled();
  const application = join(f.root, 'App with spaces.app');
  await mkdir(application);
  mocks.pick.mockImplementationOnce(async () => {
    f.options.assertActive.mockImplementation(() => {
      throw new Error('stopped');
    });
    return { canceled: false, filePaths: [application] };
  });
  await expect(openPluginPath(f.privateRoot, { path: f.file, operation: 'open_with' }, f.options)).rejects.toThrow(
    'stopped',
  );
  expect(mocks.execute).not.toHaveBeenCalled();
});

it.runIf(process.platform === 'darwin')('passes the selected application and a filename with spaces as literal arguments', async () => {
  const f = await fixture();
  const application = join(f.root, 'Text Editor.app'); await mkdir(application);
  mocks.pick.mockResolvedValue({ canceled: false, filePaths: [application] });
  mocks.execute.mockImplementation((_command, _args, callback) => callback(null, '', ''));
  await expect(openPluginPath(f.privateRoot, { path: f.file, operation: 'open_with' }, f.options)).resolves.toEqual({ opened: true });
  expect(mocks.execute).toHaveBeenCalledWith('/usr/bin/open', ['-a', await realpath(application), '--', await realpath(f.file)], expect.any(Function));
  expect(mocks.open).not.toHaveBeenCalled();
});
