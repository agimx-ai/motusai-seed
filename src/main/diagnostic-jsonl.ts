import { constants, createWriteStream } from 'node:fs'
import { lstat, mkdir, open, readdir, realpath, type FileHandle } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, sep } from 'node:path'
import { createInterface } from 'node:readline'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'

type DiagnosticJsonl = { path: string; name: string; size: number }

async function optionalStat(path: string) {
  return lstat(path).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== 'ENOENT') throw error
    return null
  })
}

function inside(root: string, path: string) {
  const child = relative(root, path)
  return child !== '..' && !child.startsWith(`..${sep}`) && !isAbsolute(child)
}

function snapshotStream(handle: FileHandle, size: number, signal?: AbortSignal) {
  return Readable.from((async function* () {
    let position = 0
    while (position < size) {
      signal?.throwIfAborted()
      const buffer = Buffer.allocUnsafe(Math.min(64 * 1024, size - position))
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, position)
      if (!bytesRead) throw new Error('插件诊断文件在收集时发生变化，请重新上传。')
      position += bytesRead
      yield buffer.subarray(0, bytesRead)
    }
  })(), { objectMode: false })
}

/** Use record timestamps, not file mtime: sessions can start earlier and be appended later. */
async function activeInRange(handle: FileHandle, size: number, start: number, end: number, signal?: AbortSignal) {
  if (!size) return false
  const source = snapshotStream(handle, size, signal)
  const lines = createInterface({ input: source, crlfDelay: Infinity })
  try {
    for await (const line of lines) {
      signal?.throwIfAborted()
      let record: unknown
      try { record = JSON.parse(line) } catch { continue }
      if (!record || typeof record !== 'object' || Array.isArray(record)) continue
      const timestamp = (record as Record<string, unknown>).timestamp
      if (typeof timestamp !== 'string') continue
      const time = Date.parse(timestamp)
      if (time >= start && time <= end) return true
    }
    return false
  } finally {
    lines.close()
    source.destroy()
  }
}

/** Generic host-owned plugin JSONL collection; no plugin IDs, private layouts or Pi imports. */
export async function snapshotDiagnosticJsonl(
  source: string | undefined, destination: string, startAt: string, endAt: string,
  maxBytes: number, signal?: AbortSignal,
): Promise<DiagnosticJsonl[]> {
  if (!source) return []
  const start = Date.parse(startAt), end = Date.parse(endAt)
  if (!Number.isFinite(start) || !Number.isFinite(end) || start > end) throw new Error('诊断包时间范围无效。')
  const rootStat = await optionalStat(source)
  if (!rootStat) return []
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) throw new Error('插件诊断数据目录无效。')
  const root = await realpath(source)
  const files: DiagnosticJsonl[] = []
  let totalBytes = 0
  const walk = async (directory: string) => {
    signal?.throwIfAborted()
    // Check every directory and file; never traverse a symlink into user files elsewhere.
    const metadata = await optionalStat(directory)
    if (!metadata?.isDirectory() || metadata.isSymbolicLink()) return
    if (!inside(root, await realpath(directory))) return
    const entries = await readdir(directory, { withFileTypes: true })
    entries.sort((a, b) => a.name.localeCompare(b.name))
    for (const entry of entries) {
      signal?.throwIfAborted()
      if (entry.name.includes('\\')) continue
      const path = join(directory, entry.name)
      if (entry.isDirectory()) { await walk(path); continue }
      if (!entry.isFile() || !entry.name.endsWith('.jsonl')) continue
      const before = await optionalStat(path)
      if (!before?.isFile() || before.isSymbolicLink()) continue
      const handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW || 0))
      try {
        const initial = await handle.stat()
        if (!inside(root, await realpath(path)) || initial.dev !== before.dev || initial.ino !== before.ino) {
          throw new Error('插件诊断文件在收集时发生变化，请重新上传。')
        }
        if (!await activeInRange(handle, initial.size, start, end, signal)) continue
        totalBytes += initial.size
        if (totalBytes > maxBytes) throw new Error('诊断资料超过 512 MiB，无法收集完整会话文件。')
        const name = relative(source, path).split(sep).join('/')
        const target = join(destination, name)
        await mkdir(dirname(target), { recursive: true, mode: 0o700 })
        // Bound the snapshot to the observed size. Normal append-only writes may continue.
        await pipeline(
          snapshotStream(handle, initial.size, signal),
          createWriteStream(target, { flags: 'wx', mode: 0o600 }),
          { signal },
        )
        const after = await handle.stat()
        if (after.size < initial.size || (after.size === initial.size
          && (after.mtimeMs !== initial.mtimeMs || after.ctimeMs !== initial.ctimeMs))) {
          throw new Error('插件诊断文件在收集时发生变化，请重新上传。')
        }
        files.push({ path: target, name, size: initial.size })
      } finally { await handle.close() }
    }
  }
  await walk(source)
  return files
}
