/* AudioWorklet: 20ms PCM messages (legacy PCM16 or native Float32 planar), silent output, and partial-frame flush. */
class SeedPcmCapture extends AudioWorkletProcessor {
  constructor(options) {
    super()
    this.nativeFormat = options?.processorOptions?.nativeFormat === true
    const rate = typeof sampleRate === 'number' && sampleRate > 0 ? sampleRate : 48_000
    const requestedBatch = Number(options?.processorOptions?.batchFrames)
    this.nativeBatchFrames = Number.isInteger(requestedBatch) && requestedBatch > 0
      ? requestedBatch
      : Math.max(128, Math.round(rate * 0.02))
    this.nativeChannels = 0
    this.nativePlanes = []
    this.nativeOffset = 0
    this.pcm = new Int16Array(320)
    this.offset = 0
    this.port.onmessage = (event) => {
      if (event.data.type !== 'flush') return
      if (this.nativeFormat) {
        if (this.nativeOffset) this.sendNative()
      } else if (this.offset) {
        this.send(this.offset)
      }
      this.port.postMessage({ type: 'flushed' })
    }
  }

  send(length) {
    const buffer = length === this.pcm.length ? this.pcm.buffer : this.pcm.buffer.slice(0, length * 2)
    this.port.postMessage({ type: 'pcm', pcm: buffer }, [buffer])
    this.pcm = new Int16Array(320)
    this.offset = 0
  }

  allocateNative(channels) {
    this.nativeChannels = channels
    this.nativePlanes = Array.from({ length: channels }, () => new Float32Array(this.nativeBatchFrames))
    this.nativeOffset = 0
  }

  sendNative() {
    const frames = this.nativeOffset
    const channels = this.nativeChannels
    if (!frames || !channels) return
    const planar = new Float32Array(frames * channels)
    for (let index = 0; index < channels; index++) {
      planar.set(this.nativePlanes[index].subarray(0, frames), index * frames)
    }
    this.nativeOffset = 0
    this.port.postMessage({ type: 'pcm', pcm: planar.buffer, channels }, [planar.buffer])
  }

  process(inputs, outputs) {
    for (const output of outputs) for (const channel of output) channel.fill(0)
    if (this.nativeFormat) {
      const channels = inputs[0]
      const frames = channels?.[0]?.length ?? 0
      if (frames) {
        if (this.nativeChannels !== channels.length) {
          if (this.nativeOffset) this.sendNative()
          this.allocateNative(channels.length)
        }
        let sourceOffset = 0
        while (sourceOffset < frames) {
          const take = Math.min(frames - sourceOffset, this.nativeBatchFrames - this.nativeOffset)
          for (let index = 0; index < channels.length; index++) {
            this.nativePlanes[index].set(channels[index].subarray(sourceOffset, sourceOffset + take), this.nativeOffset)
          }
          this.nativeOffset += take
          sourceOffset += take
          if (this.nativeOffset >= this.nativeBatchFrames) this.sendNative()
        }
      }
      return true
    }
    const samples = inputs[0]?.[0]
    if (!samples) return true
    for (const value of samples) {
      const sample = Math.max(-1, Math.min(1, value))
      this.pcm[this.offset++] = Math.round(sample < 0 ? sample * 32_768 : sample * 32_767)
      if (this.offset === this.pcm.length) this.send(this.offset)
    }
    return true
  }
}

registerProcessor('seed-pcm-capture', SeedPcmCapture)
