import { spawn, type ChildProcess } from 'node:child_process'
import { lstat, realpath } from 'node:fs/promises'
import { isAbsolute, relative, sep } from 'node:path'
import type { SeedPluginRuntimeDefinition } from '../shared/contracts'
import type { FileBroker } from './brokers/files'

const maxArguments = 256
const maxArgumentLength = 65_536
const maxOutputBytes = 4 * 1024 * 1024
const visibleOutputBytes = 512 * 1024
const maximumTimeoutMs = 10 * 60 * 1_000

type ActiveProcess = { child: ChildProcess; finished: Promise<void>; cancelled: boolean }

function processKey(packageId: string, requestId: string) {
  return `${packageId}\0${requestId}`
}

function codedError(code: string, message: string) {
  return Object.assign(new Error(message), { code })
}

function terminateProcessTree(child: ChildProcess) {
  if (child.exitCode !== null || !child.pid) return
  if (process.platform === 'win32') {
    spawn('taskkill.exe', ['/pid', String(child.pid), '/t', '/f'], { stdio: 'ignore', windowsHide: true })
    return
  }
  try { process.kill(-child.pid, 'SIGTERM') } catch { child.kill('SIGTERM') }
  const pid = child.pid
  setTimeout(() => {
    try { process.kill(-pid, 'SIGKILL') } catch { /* Process already exited. */ }
  }, 1_000).unref()
}

function argumentsList(value: unknown) {
  if (!Array.isArray(value) || value.length > maxArguments) throw codedError('sidecar_arguments_invalid', 'Sidecar 参数列表无效。')
  return value.map((argument) => {
    if (typeof argument !== 'string' || argument.length > maxArgumentLength || argument.includes('\0')) {
      throw codedError('sidecar_arguments_invalid', 'Sidecar 参数必须是有界字符串。')
    }
    return argument
  })
}

function environment(value: unknown) {
  if (value === undefined) return {}
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length > 16) {
    throw codedError('sidecar_environment_invalid', 'Sidecar 环境变量无效。')
  }
  return Object.fromEntries(Object.entries(value).map(([key, raw]) => {
    if (!/^[A-Z][A-Z0-9_]{0,63}$/.test(key) || typeof raw !== 'string' || raw.length > 4_096 || raw.includes('\0')) {
      throw codedError('sidecar_environment_invalid', 'Sidecar 环境变量无效。')
    }
    return [key, raw]
  }))
}

function baseEnvironment() {
  const allowed = ['PATH', 'HOME', 'USERPROFILE', 'TMPDIR', 'TMP', 'TEMP', 'LANG', 'LC_ALL', 'SystemRoot', 'WINDIR', 'COMSPEC', 'PATHEXT']
  return Object.fromEntries(allowed.flatMap((key) => typeof process.env[key] === 'string' ? [[key, process.env[key]!]] : []))
}

export class SidecarProcessService {
  private readonly active = new Map<string, ActiveProcess>()
  private readonly pendingCancellations = new Set<string>()

  constructor(
    private readonly plugins: () => SeedPluginRuntimeDefinition[],
    private readonly files: FileBroker,
    private readonly report: (packageId: string, event: string, message: string, details?: Record<string, string | number | boolean | null>) => void = () => undefined,
  ) {}

  async invoke(packageId: string, input: Record<string, unknown>) {
    const operation = String(input.operation || '')
    const requestId = String(input.request_id || '')
    if (!requestId) throw codedError('sidecar_request_invalid', 'Sidecar 请求缺少 request_id。')
    const key = processKey(packageId, requestId)
    if (operation === 'cancel') {
      const active = this.active.get(key)
      if (!active) {
        this.pendingCancellations.add(key)
        setTimeout(() => this.pendingCancellations.delete(key), 30_000).unref()
        return { cancelled: true }
      }
      active.cancelled = true
      terminateProcessTree(active.child)
      await active.finished
      return { cancelled: true }
    }
    if (operation !== 'run') throw codedError('sidecar_operation_invalid', 'Sidecar 操作无效。')
    if (this.active.has(key)) throw codedError('sidecar_request_conflict', 'Sidecar request_id 正在运行。')

    const plugin = this.plugins().find((candidate) => candidate.package_id === packageId)
    if (!plugin?.permissions.includes('process.sidecar')) throw codedError('broker_permission_denied', '插件未声明 Sidecar 进程权限。')
    const sidecar = plugin.sidecars.find((candidate) => candidate.id === String(input.sidecar_id || ''))
    if (!sidecar) throw codedError('sidecar_not_declared', '插件未声明请求的 Sidecar。')
    const executable = await realpath(sidecar.path)
    const pluginRoot = await realpath(plugin.root_path)
    const boundary = relative(pluginRoot, executable)
    if (!boundary || boundary === '..' || boundary.startsWith(`..${sep}`) || isAbsolute(boundary)) {
      throw codedError('sidecar_path_denied', 'Sidecar 路径越过插件目录。')
    }
    const metadata = await lstat(executable)
    if (!metadata.isFile() || metadata.isSymbolicLink()) throw codedError('sidecar_path_denied', 'Sidecar 不是普通文件。')

    const access = input.access === 'write' ? 'write' : 'read'
    const cwdScope = input.cwd_scope === undefined ? 'grant' : String(input.cwd_scope)
    if (!['grant', 'package'].includes(cwdScope)) throw codedError('sidecar_cwd_scope_invalid', 'Sidecar 工作目录范围无效。')
    if (cwdScope === 'package' && (input.root_id !== undefined || input.cwd !== undefined || access === 'write')) {
      throw codedError('sidecar_cwd_scope_invalid', '插件包工作目录只接受 read 访问语义，且不能同时指定文件系统根目录。')
    }
    const cwd = cwdScope === 'package'
      ? pluginRoot
      : await this.files.resolveProcessDirectory(String(input.root_id || ''), input.cwd, access)
    const args = argumentsList(input.args)
    const timeoutMs = Math.min(maximumTimeoutMs, Math.max(1_000, Number(input.timeout_ms) || 120_000))
    if (this.pendingCancellations.delete(key)) throw codedError('sidecar_cancelled', 'Sidecar 操作已取消。')
    const child = spawn(executable, args, {
      cwd,
      env: { ...baseEnvironment(), ...environment(input.env) },
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: process.platform !== 'win32',
      windowsHide: true,
    })
    const chunks: Buffer[] = []
    const stderrChunks: Buffer[] = []
    let stderrBytes = 0
    let capturedBytes = 0
    let totalBytes = 0
    let timedOut = false
    const append = (chunk: Buffer) => {
      totalBytes += chunk.length
      if (capturedBytes >= maxOutputBytes) return
      const visible = chunk.subarray(0, maxOutputBytes - capturedBytes)
      chunks.push(Buffer.from(visible))
      capturedBytes += visible.length
    }
    child.stdout?.on('data', append)
    child.stderr?.on('data', (chunk: Buffer) => {
      append(chunk)
      if (stderrBytes < visibleOutputBytes) {
        const visible = chunk.subarray(0, visibleOutputBytes - stderrBytes)
        stderrChunks.push(Buffer.from(visible))
        stderrBytes += visible.length
      }
    })
    const completion = new Promise<number | null>((resolve, reject) => {
      child.once('error', reject)
      child.once('close', resolve)
    })
    const active = { child, finished: completion.then(() => undefined, () => undefined), cancelled: false }
    this.active.set(key, active)
    const timer = setTimeout(() => {
      timedOut = true
      terminateProcessTree(child)
    }, timeoutMs)
    timer.unref()
    try {
      const exitCode = await completion
      if (active.cancelled) throw codedError('sidecar_cancelled', 'Sidecar 操作已取消。')
      const output = Buffer.concat(chunks, capturedBytes)
      const visible = output.length > visibleOutputBytes ? output.subarray(output.length - visibleOutputBytes) : output
      if (exitCode !== 0 || timedOut) this.report(packageId, timedOut ? 'sidecar.timeout' : 'sidecar.exit.failed', visible.toString('utf8'), {
        sidecar_id: sidecar.id, request_id: requestId, exit_code: exitCode, truncated: totalBytes > visible.length,
      })
      else if (stderrBytes) this.report(packageId, 'sidecar.stderr', Buffer.concat(stderrChunks, stderrBytes).toString('utf8'), {
        sidecar_id: sidecar.id, request_id: requestId, truncated: stderrBytes >= visibleOutputBytes,
      })
      return {
        output: visible.toString('utf8'),
        exit_code: exitCode,
        timed_out: timedOut,
        truncated: totalBytes > visible.length,
      }
    } catch (error) {
      if (!active.cancelled) this.report(packageId, 'sidecar.run.failed', error instanceof Error ? error.stack || error.message : String(error), {
        sidecar_id: sidecar.id, request_id: requestId,
      })
      throw error
    } finally {
      clearTimeout(timer)
      if (this.active.get(key) === active) this.active.delete(key)
    }
  }

  async stop() {
    const active = [...this.active.values()]
    for (const process of active) terminateProcessTree(process.child)
    await Promise.all(active.map((process) => process.finished))
    this.active.clear()
    this.pendingCancellations.clear()
  }
}
