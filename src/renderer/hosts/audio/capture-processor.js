/* AudioWorklet: 20ms PCM16 messages, silent output, and partial-frame flush. */
class SeedPcmCapture extends AudioWorkletProcessor {
  constructor() {
    super()
    this.pcm = new Int16Array(320)
    this.offset = 0
    this.port.onmessage = (event) => {
      if (event.data.type !== 'flush') return
      if (this.offset) this.send(this.offset)
      this.port.postMessage({ type: 'flushed' })
    }
  }

  send(length) {
    const buffer = length === this.pcm.length ? this.pcm.buffer : this.pcm.buffer.slice(0, length * 2)
    this.port.postMessage({ type: 'pcm', pcm: buffer }, [buffer])
    this.pcm = new Int16Array(320)
    this.offset = 0
  }

  process(inputs, outputs) {
    for (const output of outputs) for (const channel of output) channel.fill(0)
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
