import { spawnSync } from 'node:child_process'
import { cp, mkdtemp, readdir, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const projectRoot = resolve(import.meta.dirname, '..')
const destination = resolve(projectRoot, 'resources/python')
const temporary = await mkdtemp(join(tmpdir(), 'motusai-python-build-'))

try {
  const installed = spawnSync('uv', ['python', 'install', '3.12.13', '--install-dir', temporary, '--no-bin'], {
    stdio: 'inherit',
    windowsHide: true,
  })
  if (installed.error) throw installed.error
  if (installed.status !== 0) throw new Error('Could not prepare the pinned Python runtime for this client build.')
  const directories = (await readdir(temporary, { withFileTypes: true })).filter((entry) => entry.isDirectory() && entry.name.startsWith('cpython-3.12.13-'))
  if (directories.length !== 1) throw new Error('The pinned Python runtime was not found after installation.')
  const source = join(temporary, directories[0].name)
  const executable = process.platform === 'win32' ? join(source, 'python.exe') : join(source, 'bin', 'python3.12')
  if (!(await stat(executable)).isFile()) throw new Error('The bundled Python executable is missing.')
  await rm(destination, { recursive: true, force: true })
  // uv's installed aliases may be absolute links into the temporary install directory.
  // Materialize them before that directory is removed or signing will see dangling links.
  await cp(source, destination, { recursive: true, dereference: true })
  const locatedUv = spawnSync(process.platform === 'win32' ? 'where' : 'which', ['uv'], { encoding: 'utf8', windowsHide: true })
  const uvPath = locatedUv.stdout?.trim().split(/\r?\n/)[0]
  if (locatedUv.status !== 0 || !uvPath) throw new Error('Could not locate uv for bundling.')
  await cp(uvPath, join(destination, process.platform === 'win32' ? 'uv.exe' : 'uv'), { dereference: true })
  process.stdout.write(`Prepared Python 3.12.13 for ${process.platform}/${process.arch}.\n`)
} finally {
  await rm(temporary, { recursive: true, force: true })
}
