import { lstat, readdir, realpath, rm } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { pluginIdSchema } from '../shared/validation'

export class PluginDataCleaner {
  constructor(
    private readonly userData: string,
    private readonly installedIds: () => Promise<string[]>,
    private readonly storedIds: () => string[],
    private readonly removeStored: (id: string) => Promise<void>,
  ) {}

  private async dataRoot() {
    const root = join(this.userData, 'plugin-data')
    try {
      const metadata = await lstat(root)
      if (!metadata.isDirectory() || metadata.isSymbolicLink()
        || await realpath(root) !== join(await realpath(this.userData), 'plugin-data')) {
        throw new Error('插件数据目录不安全，已停止清理。')
      }
      return await realpath(root)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
      throw error
    }
  }

  async list() {
    // Use installation records, not the authorized/healthy subset shown in the UI.
    const installed = new Set(await this.installedIds())
    const ids = new Set(this.storedIds())
    const root = await this.dataRoot()
    if (root) for (const entry of await readdir(root, { withFileTypes: true })) {
      if (entry.isDirectory() && !entry.isSymbolicLink()) ids.add(entry.name)
    }
    return [...ids].filter((id) => pluginIdSchema.safeParse(id).success && !installed.has(id)).sort()
  }

  async reset(requested: string[]) {
    const ids = [...new Set(requested.map((id) => pluginIdSchema.parse(id)))]
    const eligible = new Set(await this.list())
    const root = await this.dataRoot()
    const result = { reset: [] as string[], skipped: [] as string[], failed: [] as Array<{ id: string; message: string }> }
    for (const id of ids) {
      if (!eligible.has(id) || (await this.installedIds()).includes(id)) {
        result.skipped.push(id)
        continue
      }
      try {
        if (root) {
          if (await this.dataRoot() !== root) throw new Error('插件数据目录已改变，未删除。')
          const path = resolve(root, id)
          try {
            const metadata = await lstat(path)
            if (!metadata.isDirectory() || metadata.isSymbolicLink() || await realpath(path) !== path) {
              throw new Error('插件数据路径不安全，未删除。')
            }
            await rm(path, { recursive: true, force: true })
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
          }
        }
        await this.removeStored(id)
        result.reset.push(id)
      } catch (error) {
        result.failed.push({ id, message: error instanceof Error ? error.message : String(error) })
      }
    }
    return result
  }
}
