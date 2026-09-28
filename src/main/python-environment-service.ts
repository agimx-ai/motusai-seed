import { spawn, type ChildProcess } from 'node:child_process'
import { createHash } from 'node:crypto'
import { access, mkdir, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises'
import { join, relative, resolve, sep } from 'node:path'
import type { SeedPluginRuntimeDefinition } from '../shared/contracts'

const pythonVersion = '3.12'
const maximumOutputBytes = 512 * 1024

function failure(code: string, message: string) {
  return Object.assign(new Error(message), { code })
}

function inside(root: string, target: string) {
  const path = relative(root, target)
  return path === '' || (path !== '..' && !path.startsWith(`..${sep}`))
}

function validSkillId(value: unknown) {
  const id = String(value || '')
  if (!/^[a-z][a-z0-9-]{1,63}$/.test(id)) throw failure('python_skill_invalid', 'Python Skill ID 无效。')
  return id
}

function interpreterIn(environment: string) {
  return process.platform === 'win32' ? join(environment, 'Scripts', 'python.exe') : join(environment, 'bin', 'python')
}

function terminate(child: ChildProcess) {
  if (child.exitCode !== null || !child.pid) return
  if (process.platform === 'win32') {
    spawn('taskkill.exe', ['/pid', String(child.pid), '/t', '/f'], { stdio: 'ignore', windowsHide: true })
  } else {
    try { process.kill(-child.pid, 'SIGTERM') } catch { child.kill('SIGTERM') }
    const pid = child.pid
    setTimeout(() => { try { process.kill(-pid, 'SIGKILL') } catch { /* Already exited. */ } }, 1_000).unref()
  }
}

async function command(executable: string, args: string[], cwd: string, timeoutMs: number, active?: (child: ChildProcess | null) => void) {
  const child = spawn(executable, args, {
    cwd,
    env: {
      PATH: process.env.PATH,
      HOME: process.env.HOME,
      USERPROFILE: process.env.USERPROFILE,
      SystemRoot: process.env.SystemRoot,
      TEMP: process.env.TEMP,
      TMP: process.env.TMP,
      PYTHONNOUSERSITE: '1',
      PIP_NO_INDEX: '1',
      PIP_CONFIG_FILE: process.platform === 'win32' ? 'NUL' : '/dev/null',
      PIP_DISABLE_PIP_VERSION_CHECK: '1',
      UV_PYTHON_DOWNLOADS: 'never',
      UV_OFFLINE: '1',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
    detached: process.platform !== 'win32',
  })
  active?.(child)
  let output = ''
  for (const stream of [child.stdout, child.stderr]) stream?.on('data', (chunk: Buffer) => {
    output = (output + chunk.toString('utf8')).slice(-maximumOutputBytes)
  })
  let timedOut = false
  const timer = setTimeout(() => { timedOut = true; terminate(child) }, timeoutMs)
  timer.unref()
  try {
    const exitCode = await new Promise<number | null>((done, reject) => {
      child.once('error', reject)
      child.once('close', done)
    })
    if (timedOut) throw failure('python_timeout', 'Python 操作超时。')
    return { exitCode, output }
  } finally {
    clearTimeout(timer)
    active?.(null)
  }
}

/** Host Python execution, not an OS sandbox. Dependencies are installed only from the signed plugin package. */
export class PythonEnvironmentService {
  private readonly preparing = new Map<string, Promise<string>>()
  private readonly active = new Map<string, ChildProcess>()

  constructor(
    private readonly plugins: () => SeedPluginRuntimeDefinition[],
    private readonly dataRoot: string,
    private readonly bundledRoot: string,
  ) {}

  private plugin(packageId: string) {
    const plugin = this.plugins().find((candidate) => candidate.package_id === packageId)
    if (!plugin?.permissions.includes('process.python')) throw failure('broker_permission_denied', '插件未声明 Python 进程权限。')
    return plugin
  }

  private async source(plugin: SeedPluginRuntimeDefinition, skillId: string) {
    const root = await realpath(plugin.root_path)
    const skillRoot = await realpath(join(root, 'skills', skillId))
    const [manifest, resolvedProject, resolvedLock, resolvedRequirements, resolvedWheels] = await Promise.all([
      realpath(join(skillRoot, 'SKILL.md')),
      realpath(join(skillRoot, 'pyproject.toml')),
      realpath(join(skillRoot, 'uv.lock')),
      realpath(join(skillRoot, 'requirements.txt')),
      realpath(join(skillRoot, 'wheels')),
    ])
    if (!inside(root, skillRoot) || [manifest, resolvedProject, resolvedLock, resolvedRequirements, resolvedWheels].some((path) => !inside(skillRoot, path))
      || !(await stat(manifest)).isFile()
      || !(await stat(resolvedProject)).isFile() || !(await stat(resolvedLock)).isFile()
      || !(await stat(resolvedRequirements)).isFile() || !(await stat(resolvedWheels)).isDirectory()) {
      throw failure('python_package_invalid', 'Skill 内的 Python 依赖目录无效。')
    }
    const files = await Promise.all([resolvedProject, resolvedLock, resolvedRequirements].map((path) => readFile(path)))
    if (files.some((body) => body.byteLength > 256 * 1024)) throw failure('python_package_invalid', 'Python 依赖文件过大。')
    const digest = createHash('sha256')
    for (const body of files) digest.update(body)
    return { root, skillRoot, requirements: resolvedRequirements, wheels: resolvedWheels, digest: digest.digest('hex') }
  }

  private async basePython() {
    const names = process.platform === 'win32' ? ['python.exe', 'python3.12.exe'] : ['python3.12', 'python3']
    for (const name of names) {
      try {
        const result = await command(name, ['-c', 'import sys; print("%d.%d" % sys.version_info[:2]); print(sys.executable)'], process.cwd(), 5_000)
        const [version, executable] = result.output.trim().split(/\r?\n/)
        if (result.exitCode === 0 && version === pythonVersion && executable) return await realpath(executable)
      } catch { /* The system installation is absent or incompatible. */ }
    }
    const bundled = process.platform === 'win32'
      ? join(this.bundledRoot, 'python.exe')
      : join(this.bundledRoot, 'bin', 'python3.12')
    try {
      await access(bundled)
      const result = await command(bundled, ['-c', 'import sys; print("%d.%d" % sys.version_info[:2])'], process.cwd(), 5_000)
      if (result.exitCode === 0 && result.output.trim() === pythonVersion) return await realpath(bundled)
    } catch { /* No bundled runtime in the development build. */ }
    throw failure('python_runtime_unavailable', '未找到 Python 3.12，且当前客户端未携带备用运行时。')
  }

  private async prepare(plugin: SeedPluginRuntimeDefinition, skillId: string) {
    const source = await this.source(plugin, skillId)
    const key = `${plugin.package_id}\0${plugin.version}\0${skillId}`
    const existing = this.preparing.get(key)
    if (existing) return existing
    const work = (async () => {
      const root = join(this.dataRoot, plugin.package_id, plugin.version, skillId)
      const ready = join(root, 'ready.json')
      const base = await this.basePython()
      const uv = join(this.bundledRoot, process.platform === 'win32' ? 'uv.exe' : 'uv')
      if (!await access(uv).then(() => true, () => false)) throw failure('python_runtime_unavailable', '客户端未携带 uv 依赖管理器。')
      const previous = await readFile(ready, 'utf8').then((text) => JSON.parse(text) as { digest?: string; base?: string }, () => null).catch(() => null)
      if (previous?.digest === source.digest && previous.base === base
        && await access(interpreterIn(root)).then(() => true, () => false)) return interpreterIn(root)
      await mkdir(join(this.dataRoot, plugin.package_id, plugin.version), { recursive: true, mode: 0o700 })
      await rm(root, { recursive: true, force: true })
      try {
        const created = await command(uv, ['venv', '--no-config', '--no-cache', '--offline', '--no-python-downloads', '--python', base, root], source.root, 120_000)
        if (created.exitCode !== 0) throw failure('python_environment_failed', `无法建立 Python 虚拟环境：${created.output}`)
        const python = interpreterIn(root)
        const installed = await command(uv, ['pip', 'sync', '--no-config', '--no-cache', '--offline', '--no-index', '--find-links', source.wheels, '--only-binary', ':all:', '--require-hashes', '--strict', '--python', python, source.requirements], source.root, 180_000)
        if (installed.exitCode !== 0) throw failure('python_dependency_failed', `插件离线依赖安装失败：${installed.output}`)
        await writeFile(join(root, 'ready.json'), JSON.stringify({ digest: source.digest, base }))
        return python
      } catch (error) {
        await rm(root, { recursive: true, force: true })
        throw error
      }
    })().finally(() => this.preparing.delete(key))
    this.preparing.set(key, work)
    return work
  }

  async invoke(packageId: string, input: Record<string, unknown>) {
    const plugin = this.plugin(packageId)
    const operation = String(input.operation || '')
    if (operation === 'prepare') {
      await this.prepare(plugin, validSkillId(input.skill_id))
      return { ready: true, version: pythonVersion }
    }
    const requestId = String(input.request_id || '')
    if (!requestId) throw failure('python_request_invalid', 'Python 请求缺少 request_id。')
    const key = `${packageId}\0${requestId}`
    if (operation === 'cancel') {
      const active = this.active.get(key)
      if (active) terminate(active)
      return { cancelled: Boolean(active) }
    }
    if (operation !== 'run') throw failure('python_operation_invalid', 'Python 操作无效。')
    if (this.active.has(key)) throw failure('python_request_conflict', 'Python 请求正在运行。')
    const script = String(input.script || '')
    const match = /^\.\/skills\/([a-z][a-z0-9-]{1,63})\/scripts\/([A-Za-z0-9._/-]+\.py)$/.exec(script)
    if (!match || script.split('/').includes('..')) throw failure('python_script_invalid', '只能运行 Skill 包内的 Python 脚本。')
    const skillId = match[1]!
    const source = await this.source(plugin, skillId)
    const target = await realpath(resolve(source.root, script))
    if (!inside(join(source.skillRoot, 'scripts'), target) || !(await stat(target)).isFile()) {
      throw failure('python_script_invalid', 'Python 脚本路径越过 Skill 目录。')
    }
    const args = input.args
    if (!Array.isArray(args) || args.length > 32 || args.some((value) => typeof value !== 'string' || value.length > 4096 || value.includes('\0'))) {
      throw failure('python_arguments_invalid', 'Python 脚本参数无效。')
    }
    const python = await this.prepare(plugin, skillId)
    const result = await command(python, [target, ...args as string[]], source.root, 120_000, (child) => {
      if (child) this.active.set(key, child)
      else this.active.delete(key)
    })
    return { output: result.output, exit_code: result.exitCode }
  }

  async stop() {
    const active = [...this.active.values()]
    const finished = active.map((child) => child.exitCode !== null ? Promise.resolve() : new Promise<void>((done) => child.once('close', () => done())))
    for (const child of active) terminate(child)
    await Promise.all(finished)
    await Promise.allSettled(this.preparing.values())
    this.active.clear()
  }

  async remove(packageId: string) {
    if (!/^[a-z][a-z0-9-]*(?:\.[a-z0-9-]+)+$/.test(packageId)) throw failure('python_package_invalid', '插件 ID 无效。')
    const active = [...this.active.entries()].filter(([key]) => key.startsWith(`${packageId}\0`)).map(([, child]) => child)
    const finished = active.map((child) => child.exitCode !== null ? Promise.resolve() : new Promise<void>((done) => child.once('close', () => done())))
    for (const child of active) terminate(child)
    await Promise.all(finished)
    await Promise.allSettled([...this.preparing.entries()].filter(([key]) => key.startsWith(`${packageId}\0`)).map(([, work]) => work))
    await rm(join(this.dataRoot, packageId), { recursive: true, force: true })
  }
}
