type AudioContextConstructor = new () => AudioContext
type AudioCaptureCommand =
  | { type: 'start'; session_id: string }
  | { type: 'pause'; session_id: string }
  | { type: 'resume'; session_id: string }
  | { type: 'stop'; session_id: string }

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
let stream: MediaStream | null = null
let context: AudioContext | null = null
let source: MediaStreamAudioSourceNode | null = null
let processor: ScriptProcessorNode | null = null
function audioContextConstructor() {
  const audioWindow = window as typeof window & { webkitAudioContext?: AudioContextConstructor }
  return window.AudioContext || audioWindow.webkitAudioContext
}

function resamplePcm16(samples: Float32Array, sourceSampleRate: number) {
  if (!samples.length || !sourceSampleRate) return new ArrayBuffer(0)
  const ratio = sourceSampleRate / 16_000
  const sampleCount = Math.max(1, Math.floor(samples.length / ratio))
  const buffer = new ArrayBuffer(sampleCount * 2)
  const view = new DataView(buffer)
  for (let index = 0; index < sampleCount; index += 1) {
    const start = Math.floor(index * ratio)
    const end = Math.max(start + 1, Math.min(samples.length, Math.floor((index + 1) * ratio)))
    let sum = 0
    for (let sourceIndex = start; sourceIndex < end; sourceIndex += 1) sum += samples[sourceIndex]
    const sample = Math.max(-1, Math.min(1, sum / (end - start)))
    view.setInt16(index * 2, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true)
  }
  return buffer
}

async function cleanup() {
  processor?.disconnect()
  source?.disconnect()
  processor = null
  source = null
  stream?.getTracks().forEach((track) => track.stop())
  stream = null
  const current = context
  context = null
  if (current && current.state !== 'closed') await current.close().catch(() => undefined)
}

async function start(command: Extract<AudioCaptureCommand, { type: 'start' }>) {
  await cleanup()
  const AudioCtx = audioContextConstructor()
  if (!AudioCtx || !navigator.mediaDevices?.getUserMedia) throw new Error('当前系统不支持麦克风采集。')
  sessionId = command.session_id
  stream = await navigator.mediaDevices.getUserMedia({
    audio: { autoGainControl: true, echoCancellation: true, noiseSuppression: true, channelCount: 1 },
  })
  context = new AudioCtx()
  await context.resume()
  source = context.createMediaStreamSource(stream)
  processor = context.createScriptProcessor(4096, 1, 1)
  processor.onaudioprocess = (event) => {
    if (!sessionId || context?.state !== 'running') return
    const samples = event.inputBuffer.getChannelData(0)
    const pcm = resamplePcm16(samples, context.sampleRate)
    if (pcm.byteLength) window.seedAudioCapture.chunk(sessionId, pcm)
  }
  source.connect(processor)
  processor.connect(context.destination)
  window.seedAudioCapture.emit({ type: 'started', session_id: sessionId, sample_rate: 16_000, channels: 1, format: 'pcm16' })
}

window.seedAudioCapture.subscribe((command) => {
  void (async () => {
    if (command.type !== 'start' && command.session_id !== sessionId) return
    if (command.type === 'start') return await start(command)
    if (command.type === 'pause') {
      await context?.suspend()
      window.seedAudioCapture.emit({ type: 'paused', session_id: sessionId })
      return
    }
    if (command.type === 'resume') {
      await context?.resume()
      window.seedAudioCapture.emit({ type: 'resumed', session_id: sessionId })
      return
    }
    await cleanup()
    const stoppedSessionId = sessionId
    sessionId = ''
    window.seedAudioCapture.emit({ type: 'stopped', session_id: stoppedSessionId })
  })().catch((error) => {
    window.seedAudioCapture.emit({
      type: 'error',
      session_id: command.session_id,
      message: error instanceof Error ? error.message : String(error),
    })
  })
})

window.seedAudioCapture.ready()

export {}
