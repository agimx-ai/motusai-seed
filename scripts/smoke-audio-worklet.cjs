const { app, BrowserWindow, ipcMain } = require('electron')
const { mkdtemp, rm } = require('node:fs/promises')
const { tmpdir } = require('node:os')
const { join, resolve } = require('node:path')

// Synthetic Chromium audio only; no access to the user's real microphone.
app.commandLine.appendSwitch('use-fake-device-for-media-stream')
app.commandLine.appendSwitch('use-fake-ui-for-media-stream')
let directory
let window
let exitCode = 0

async function run() {
  directory = await mkdtemp(join(tmpdir(), 'seed-audio-worklet-smoke-'))
  app.setPath('userData', directory)
  await app.whenReady()
  let chunks = 0
  let bytes = 0
  let peak = 0
  let stopSent = false
  const sessionId = 'synthetic-audio-worklet-smoke'
  const result = new Promise((resolveResult, reject) => {
    const timer = setTimeout(() => reject(new Error('AudioWorklet production capture timed out.')), 15_000)
    ipcMain.on('seed-audio:ready', () => window.webContents.send('seed-audio:command', { type: 'start', session_id: sessionId }))
    ipcMain.on('seed-audio:chunk', (_event, id, pcm) => {
      if (id !== sessionId) return reject(new Error('Unexpected capture session.'))
      chunks++
      bytes += pcm.byteLength
      const buffer = Buffer.from(pcm)
      for (let offset = 0; offset < buffer.length; offset += 2) peak = Math.max(peak, Math.abs(buffer.readInt16LE(offset)))
      if ((chunks >= 100 && peak > 0 || chunks >= 250) && !stopSent) {
        stopSent = true
        window.webContents.send('seed-audio:command', { type: 'stop', session_id: sessionId })
      }
    })
    ipcMain.on('seed-audio:event', (_event, event) => {
      if (event.type === 'error') { clearTimeout(timer); reject(new Error(event.message)) }
      if (event.type === 'started' && (event.sample_rate !== 16_000 || event.channels !== 1)) reject(new Error('Unexpected PCM format.'))
      if (event.type === 'stopped') {
        clearTimeout(timer)
        if (!chunks || !bytes || !peak) return reject(new Error('Synthetic capture produced no signal.'))
        resolveResult({ chunks, bytes, peak, format: 'PCM16 mono 16kHz', productionWorklet: true })
      }
    })
  })
  window = new BrowserWindow({ show: false, webPreferences: {
    preload: resolve(__dirname, '../dist/electron/preload/audio-capture.js'),
    partition: 'synthetic-audio-worklet-smoke', sandbox: true,
    nodeIntegration: false, contextIsolation: true, webSecurity: true, backgroundThrottling: false,
  } })
  window.webContents.session.setPermissionCheckHandler((contents, permission) => contents === window.webContents && permission === 'media')
  window.webContents.session.setPermissionRequestHandler((contents, permission, callback) => callback(contents === window.webContents && permission === 'media'))
  await window.loadFile(resolve(__dirname, '../dist/renderer/src/renderer/hosts/audio/index.html'))
  console.log(JSON.stringify(await result))
}

run().catch((error) => { console.error(error); exitCode = 1 }).finally(async () => {
  window?.destroy()
  if (directory) await rm(directory, { recursive: true, force: true })
  app.exit(exitCode)
})
