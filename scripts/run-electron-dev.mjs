import { watch } from 'node:fs'
import { createRequire } from 'node:module'
import { spawn } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { prepareElectronDev } from './prepare-electron-dev.mjs'

const require = createRequire(import.meta.url)
const electronBinary = require('electron')
const electronVersion = require('electron/package.json').version
const projectRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const compiledMainRoot = join(projectRoot, 'dist/electron')
const developmentElectronBinary = prepareElectronDev(projectRoot, electronBinary, electronVersion)

let electronProcess
let restartTimer
let restarting = false
let stopping = false

function startElectron() {
  electronProcess = spawn(developmentElectronBinary, ['.'], {
    cwd: projectRoot,
    env: process.env,
    stdio: 'inherit',
  })

  electronProcess.once('exit', (code, signal) => {
    electronProcess = undefined
    if (!stopping && !restarting) {
      compiledMainWatcher.close()
      process.exitCode = signal ? 1 : (code ?? 0)
    }
  })
}

function restartElectron() {
  clearTimeout(restartTimer)
  restartTimer = setTimeout(() => {
    const previousProcess = electronProcess
    if (!previousProcess) {
      startElectron()
      return
    }

    restarting = true
    previousProcess.once('exit', () => {
      restarting = false
      if (!stopping) startElectron()
    })
    previousProcess.kill('SIGTERM')
  }, 180)
}

const compiledMainWatcher = watch(compiledMainRoot, { recursive: true }, (_event, filename) => {
  if (filename?.endsWith('.js') || filename?.endsWith('.json')) restartElectron()
})

function stop() {
  if (stopping) return
  stopping = true
  clearTimeout(restartTimer)
  compiledMainWatcher.close()
  if (electronProcess) electronProcess.kill('SIGTERM')
}

process.on('SIGINT', stop)
process.on('SIGTERM', stop)
process.on('exit', stop)

startElectron()
