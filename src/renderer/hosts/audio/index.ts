import type { AudioCaptureCommand } from '../../../shared/audio-capture'

declare global {
  interface Window {
    seedAudioCapture: {
      ready(): void
      emit(event: Record<string, unknown>): void
      chunk(sessionId: string, pcm: ArrayBuffer): void
      subscribe(listener: (command: AudioCaptureCommand) => void): () => void
    }
  }
}

let sessionId = ''
let generation = 0
let stream: MediaStream | null = null
let context: AudioContext | null = null
let source: MediaStreamAudioSourceNode | null = null
let processor: AudioWorkletNode | null = null
let finish: (() => Promise<void>) | null = null
let flushInput: (() => Promise<void>) | null = null
let cleanupTask: Promise<void> | null = null

function cleanup(): Promise<void> {
  if (cleanupTask) return cleanupTask
  const currentContext = context
  const currentProcessor = processor
  const currentSource = source
  const currentStream = stream
  const finishCapture = finish
  context = null
  processor = null
  source = null
  stream = null
  finish = null
  flushInput = null
  cleanupTask = (async () => {
    await finishCapture?.()
    if (currentProcessor) {
      currentProcessor.port.onmessage = null
      currentProcessor.port.close()
      currentProcessor.disconnect()
    }
    currentSource?.disconnect()
    currentStream?.getTracks().forEach((track) => { track.onended = null; track.stop() })
    if (currentContext && currentContext.state !== 'closed') await currentContext.close().catch(() => undefined)
  })().finally(() => { cleanupTask = null })
  return cleanupTask
}

async function start(command: Extract<AudioCaptureCommand, { type: 'start' }>, currentGeneration: number) {
  await cleanup()
  if (currentGeneration !== generation) return
  sessionId = command.session_id
  if (!window.AudioContext || !navigator.mediaDevices?.getUserMedia) throw new Error('当前系统不支持麦克风采集。')
  const captured = await navigator.mediaDevices.getUserMedia({
    audio: { autoGainControl: true, echoCancellation: true, noiseSuppression: true, channelCount: 1 },
  })
  if (currentGeneration !== generation) {
    captured.getTracks().forEach((track) => track.stop())
    return
  }
  stream = captured
  const tracks = captured.getAudioTracks()
  if (!tracks.length || tracks.some((track) => track.readyState !== 'live')) throw new Error('未获取到麦克风音频，请检查设备及权限。')
  const audioContext = new AudioContext({ sampleRate: 16_000 })
  context = audioContext
  if (audioContext.sampleRate !== 16_000) throw new Error('麦克风无法初始化为 16 kHz 音频。')
  await audioContext.audioWorklet.addModule(new URL('./capture-processor.js?no-inline', import.meta.url))
  if (currentGeneration !== generation) return
  const node = new AudioWorkletNode(audioContext, 'seed-pcm-capture', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1] })
  processor = node
  let accepting = true
  let flushed: (() => void) | null = null
  node.port.onmessage = (event: MessageEvent<{ type: string; pcm?: ArrayBuffer }>) => {
    if (event.data.type === 'flushed') { flushed?.(); return }
    if (accepting && sessionId === command.session_id && event.data.pcm?.byteLength) window.seedAudioCapture.chunk(command.session_id, event.data.pcm)
  }
  const flush = () => new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, 250)
      flushed = () => { clearTimeout(timer); resolve() }
      node.port.postMessage({ type: 'flush' })
    })
  flushInput = flush
  finish = async () => {
    await flush()
    accepting = false
  }
  node.onprocessorerror = () => {
    if (accepting && currentGeneration === generation) window.seedAudioCapture.emit({ type: 'error', session_id: command.session_id, message: '麦克风音频处理器已中断。' })
  }
  for (const track of tracks) track.onended = () => {
    if (currentGeneration === generation) window.seedAudioCapture.emit({ type: 'error', session_id: command.session_id, message: '麦克风已断开，请检查设备。' })
  }
  source = audioContext.createMediaStreamSource(captured)
  source.connect(node)
  node.connect(audioContext.destination)
  await audioContext.resume()
  if (currentGeneration !== generation) return
  window.seedAudioCapture.emit({ type: 'started', session_id: sessionId, sample_rate: 16_000, channels: 1, format: 'pcm16' })
}

async function handle(command: AudioCaptureCommand) {
  if (command.type !== 'start' && command.session_id !== sessionId) return
  const currentGeneration = command.type === 'start' || command.type === 'stop' ? ++generation : generation
  try {
    if (command.type === 'start') return await start(command, currentGeneration)
    if (command.type === 'pause' || command.type === 'resume') {
      if (command.type === 'pause') { await flushInput?.(); await context?.suspend() }
      else await context?.resume()
      if (currentGeneration === generation) window.seedAudioCapture.emit({ type: command.type === 'pause' ? 'paused' : 'resumed', session_id: sessionId })
      return
    }
    const stoppedId = sessionId
    await cleanup()
    if (currentGeneration !== generation) return
    sessionId = ''
    window.seedAudioCapture.emit({ type: 'stopped', session_id: stoppedId })
  } catch (error) {
    if (currentGeneration !== generation || sessionId !== command.session_id) return
    await cleanup()
    window.seedAudioCapture.emit({ type: 'error', session_id: command.session_id, message: error instanceof Error ? error.message : String(error) })
  }
}

window.seedAudioCapture.subscribe((command) => { void handle(command) })
window.seedAudioCapture.ready()
