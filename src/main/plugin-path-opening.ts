import { execFile, spawn } from 'node:child_process';
import { realpath, stat } from 'node:fs/promises';
import { isAbsolute, relative, sep } from 'node:path';
import { promisify } from 'node:util';
import { dialog, shell, type BrowserWindow } from 'electron';
import { z } from 'zod';

const execute = promisify(execFile);
const inputSchema = z
  .object({ path: z.string().min(1).max(4096), operation: z.enum(['open', 'open_with']).default('open') })
  .strict();

/** OS file actions are confined to the invoking plugin's private files. */
export async function openPluginPath(
  rootPath: string,
  input: Record<string, unknown>,
  options: {
    window: BrowserWindow | null;
    title: string;
    applicationLabel: string;
    assertActive(): void;
  },
) {
  const { path, operation } = inputSchema.parse(input);
  const resolvePath = async () => {
    if (!isAbsolute(path) || path.includes('\0'))
      throw Object.assign(new Error('An absolute private path is required.'), { code: 'broker_path_denied' });
    const root = await realpath(rootPath),
      target = await realpath(path),
      boundary = relative(root, target);
    if (boundary === '..' || boundary.startsWith('..' + sep) || isAbsolute(boundary))
      throw Object.assign(new Error('Path is outside the plugin data directory.'), { code: 'broker_path_denied' });
    options.assertActive();
    return target;
  };
  let target = await resolvePath();
  if (operation === 'open') {
    const error = await shell.openPath(target);
    if (error) throw Object.assign(new Error('Unable to open the file.'), { code: 'broker_open_path_failed' });
    options.assertActive();
    return { opened: true };
  }
  if (!(await stat(target)).isFile()) throw new Error('Open With requires a file.');
  const picker = {
    title: options.title,
    properties: ['openFile' as const],
    ...(process.platform === 'darwin'
      ? { defaultPath: '/Applications', filters: [{ name: options.applicationLabel, extensions: ['app'] }] }
      : process.platform === 'win32'
        ? { filters: [{ name: options.applicationLabel, extensions: ['exe'] }] }
        : {}),
  };
  const result = options.window
    ? await dialog.showOpenDialog(options.window, picker)
    : await dialog.showOpenDialog(picker);
  options.assertActive();
  if (result.canceled || result.filePaths.length !== 1) return { opened: false };
  const application = await realpath(result.filePaths[0]);
  if (!isAbsolute(application)) throw new Error('An application must be selected.');
  target = await resolvePath();
  try {
    if (process.platform === 'darwin') await execute('/usr/bin/open', ['-a', application, '--', target]);
    else
      await new Promise<void>((resolve, reject) => {
        const child = spawn(application, [target], { detached: true, stdio: 'ignore', shell: false });
        child.once('error', reject);
        child.once('spawn', () => {
          child.unref();
          resolve();
        });
      });
  } catch {
    throw Object.assign(new Error('Unable to open the file with the selected application.'), {
      code: 'broker_open_path_failed',
    });
  }
  options.assertActive();
  return { opened: true };
}
