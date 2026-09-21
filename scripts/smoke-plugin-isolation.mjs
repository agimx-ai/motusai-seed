import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { app, BrowserWindow, protocol } from 'electron'
import { SeedPluginSandboxSupervisor } from '../dist/electron/main/plugin-sandbox-host.js'

const temporary = await mkdtemp(join(tmpdir(), 'seed-plugin-isolation-'))
app.setPath('userData', temporary)
protocol.registerSchemesAsPrivileged([{
  scheme: 'seed-plugin',
  privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true },
}])

const watchdog = setTimeout(() => {
  process.stderr.write('Electron plugin isolation smoke timed out.\n')
  process.exit(2)
}, 30_000)

app.whenReady().then(async () => {
const reports = []
const supervisor = new SeedPluginSandboxSupervisor(async () => undefined,
  (packageId, event, message) => reports.push({ packageId, event, message }))
let failed = false
try {
  const plugins = []
  for (const name of ['one', 'two']) {
    const root = join(temporary, name)
    await mkdir(root)
    const entry = join(root, 'index.mjs')
    await writeFile(entry, 'export default { async apply() {} }\n')
    plugins.push({ package_id: `com.test.${name}`, version: '1.0.0', runtime_kind: 'sandboxed-web',
      root_path: root, entry_path: entry, sidecars: [], permissions: [], consumes: [], capabilities: [], publisher_type: 'official' })
  }
  await supervisor.configure(plugins)
  const windows = BrowserWindow.getAllWindows()
  if (windows.length !== 2) throw new Error(`Expected two isolated windows; got ${windows.length}. ${JSON.stringify(reports)}`)
  const processes = windows.map((window) => window.webContents.getOSProcessId())
  if (new Set(processes).size !== 2) throw new Error(`Plugins share a renderer process: ${processes.join(', ')}`)
  windows[0].webContents.forcefullyCrashRenderer()
  await new Promise((resolve) => setTimeout(resolve, 3_000))
  const recovered = BrowserWindow.getAllWindows()
  if (recovered.length !== 2) throw new Error(`Plugin restart failed; ${recovered.length} windows remain. ${JSON.stringify(reports)}`)
  if (!recovered.some((window) => window.webContents.getOSProcessId() === processes[1])) {
    throw new Error('Crashing one plugin restarted its healthy sibling.')
  }
  if (!reports.some((entry) => entry.event === 'plugin.process.gone')) throw new Error('Plugin crash was not reported.')
  process.stdout.write('Two plugin processes isolated; crash reported and only failed plugin restarted.\n')
} catch (error) {
  failed = true
  process.stderr.write(`${error instanceof Error ? error.stack || error.message : String(error)}\n`)
} finally {
  supervisor.destroy()
  try { await rm(temporary, { recursive: true, force: true }) }
  catch (error) { failed = true; process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`) }
  clearTimeout(watchdog)
  app.exit(failed ? 1 : 0)
}
})
