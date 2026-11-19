import type { AudioStreamChunk, AudioStreamDelivery, AudioStreamFormat } from '@motus-ai/seed-sdk';

type Source = AudioStreamChunk['source'];

export class AudioStream {
  private sequence = 0;
  private readonly offsets = { microphone: 0, system: 0 };
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
    const sequence = this.sequence++;
    const sample_offset = this.offsets[source];
    this.offsets[source] += frames;
    const pending = this.pending;
    this.pending = undefined;
    pending?.resolve({
      done: false, chunks: [{ source, sequence, sample_offset, frames, format, data_base64: pcm.toString('base64') }],
    });
  }

  async next(readId?: string): Promise<AudioStreamDelivery> {
    if (this.failure) throw this.failure;
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
    const pending = this.pending;
    this.pending = undefined;
    if (error) pending?.reject(error);
    else pending?.resolve({ done: true, chunks: [] });
  }
}
