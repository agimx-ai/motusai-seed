import type { AudioStreamChunk, AudioStreamDelivery, AudioStreamFormat } from '@motus-ai/seed-sdk';

type Source = AudioStreamChunk['source'];
type QueuedChunk = {
  source: Source;
  sequence: number;
  sample_offset: number;
  frames: number;
  format: AudioStreamFormat;
  pcm: Buffer;
};

const maxBufferedBytes = 2 * 1024 * 1024;
const maxDeliveryBytes = 512 * 1024;
const maxDeliveryChunks = 16;

function encodeChunk({ pcm, ...chunk }: QueuedChunk): AudioStreamDelivery['chunks'][number] {
  return { ...chunk, data_base64: pcm.toString('base64') };
}

export class AudioStream {
  private sequence = 0;
  private readonly offsets = { microphone: 0, system: 0 };
  private readonly queue: QueuedChunk[] = [];
  private bufferedBytes = 0;
  private pending?: {
    readId?: string;
    resolve(result: AudioStreamDelivery): void;
    reject(error: Error): void;
  };
  private failure?: Error;
  private finished = false;
  expiry?: ReturnType<typeof setTimeout>;

  constructor(readonly packageId: string, readonly sessionId: string) {}

  append(source: Source, format: AudioStreamFormat, pcm: Buffer) {
    if (this.finished) return;
    const bytesPerFrame = format.channels * format.bits_per_sample / 8;
    const frames = pcm.length / bytesPerFrame;
    if (!Number.isSafeInteger(frames) || frames <= 0 || !Number.isSafeInteger(format.sample_rate) ||
      format.sample_rate < 1 || !Number.isSafeInteger(bytesPerFrame) || bytesPerFrame < 1)
      throw new Error('音频采集返回了无效的格式或数据。');
    const chunk: QueuedChunk = {
      source,
      sequence: this.sequence++,
      sample_offset: this.offsets[source],
      frames,
      format,
      pcm,
    };
    this.offsets[source] += frames;
    if (this.pending) {
      const pending = this.pending;
      this.pending = undefined;
      pending.resolve({ done: false, chunks: [encodeChunk(chunk)] });
      return;
    }
    this.queue.push(chunk);
    this.bufferedBytes += pcm.length;
    while (this.bufferedBytes > maxBufferedBytes && this.queue.length > 1) {
      const dropped = this.queue.shift()!;
      this.bufferedBytes -= dropped.pcm.length;
    }
  }

  private drain(): AudioStreamDelivery['chunks'] {
    const batch: AudioStreamDelivery['chunks'] = [];
    let bytes = 0;
    while (this.queue.length && batch.length < maxDeliveryChunks) {
      const next = this.queue[0]!;
      if (batch.length > 0 && bytes + next.pcm.length > maxDeliveryBytes) break;
      this.queue.shift();
      this.bufferedBytes -= next.pcm.length;
      bytes += next.pcm.length;
      batch.push(encodeChunk(next));
    }
    return batch;
  }

  async next(readId?: string): Promise<AudioStreamDelivery> {
    if (this.failure) throw this.failure;
    if (this.queue.length) return { done: false, chunks: this.drain() };
    if (this.finished) return { done: true, chunks: [] };
    if (this.pending) throw Object.assign(new Error('已有一个实时音频取帧请求在等待。'), { code: 'audio_stream_concurrent_read' });
    return await new Promise((resolve, reject) => { this.pending = { readId, resolve, reject }; });
  }

  cancelRead(readId: string) {
    if (this.pending?.readId !== readId) return;
    const pending = this.pending;
    this.pending = undefined;
    pending.resolve({ done: false, chunks: [] });
  }

  close(error?: Error) {
    if (this.finished) return;
    this.finished = true;
    this.failure = error;
    if (error) {
      this.queue.length = 0;
      this.bufferedBytes = 0;
    }
    const pending = this.pending;
    this.pending = undefined;
    if (error) pending?.reject(error);
    else pending?.resolve({ done: true, chunks: [] });
  }
}
