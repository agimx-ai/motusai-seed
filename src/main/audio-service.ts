import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { BrowserWindow, ipcMain, session, systemPreferences } from 'electron';
import { parseAudioCaptureSource, type AudioCaptureSource } from '../shared/audio-capture';
import { SystemAudioCapture, type SystemAudioRecorderFactory } from './system-audio-capture';
import { AudioPcmMixer } from './audio-pcm-mixer';
import { AudioSegmentStore } from './audio-segment-store';
import { LatestAudioRecording } from './latest-audio-recording';

export type AudioState = 'idle' | 'starting' | 'recording' | 'paused' | 'stopping' | 'failed';
export type AudioStatus = {
  session_id?: string;
  state: AudioState;
  duration_ms: number;
  source: AudioCaptureSource;
  error?: string;
  task_id?: string;
};
type PendingEvent = {
  resolve(value: Record<string, unknown>): void;
  reject(error: Error): void;
  timer: NodeJS.Timeout;
};
type CapturedSegment = { audio_session_id: string; segment_id: string; start_ms: number; end_ms: number };
type CompletedAudio = {
  pcm: Buffer;
  durationMs: number;
  expiresAt: number;
  captureSessionId: string;
  packageId: string;
};

const maxPcmBytes = 10 * 1024 * 1024;
const completedAudioTtlMs = 5 * 60 * 1000;
const failureResetMs = 3000;
const pcmBytesPerMs = (16_000 * 2) / 1_000;
const segmentOverlapBytes = 16_000 * 2;

function codedError(message: string, code: string) {
  const error = new Error(message) as Error & { code?: string };
  error.code = code;
  return error;
}

/** Captures audio only. All sources share the same durable PCM segment pipeline. */
export class AudioService {
  private window: BrowserWindow | null = null;
  private ready: Promise<void> | null = null;
  private readyResolve: (() => void) | null = null;
  private sessionId = '';
  private ownerPackageId = '';
  private stoppingTaskId: string | undefined;
  private source: AudioCaptureSource = 'microphone';
  private captureGeneration = 0;
  private systemCapture: SystemAudioCapture | null = null;
  private readonly mixer = new AudioPcmMixer();
  private state: AudioState = 'idle';
  private failureResetTimer: ReturnType<typeof setTimeout> | null = null;
  private error = '';
  private startedAt = 0;
  private pausedAt = 0;
  private pausedTotalMs = 0;
  private pcmChunks: Buffer[] = [];
  private pcmBytes = 0;
  private segmentOffsetBytes = 0;
  private pcmBaseOffsetBytes = 0;
  private readonly completedAudio = new Map<string, CompletedAudio>();
  private readonly pendingEvents = new Map<string, PendingEvent>();
  private segmentTask: Promise<CapturedSegment> | null = null;
  private readonly durableStore: AudioSegmentStore | null;
  private localRecording: LatestAudioRecording | null = null;
  private recordingSaveTask: Promise<void> = Promise.resolve();

  constructor(
    private readonly stateChanged: (status: AudioStatus) => void = () => undefined,
    pluginDataRoot?: string,
    private readonly systemRecorderFactory?: SystemAudioRecorderFactory,
    private readonly recordingsRoot?: string,
  ) {
    this.durableStore = pluginDataRoot ? new AudioSegmentStore(pluginDataRoot) : null;
    ipcMain.on('seed-audio:ready', this.handleReady);
    ipcMain.on('seed-audio:event', this.handleCaptureEvent);
    ipcMain.on('seed-audio:chunk', this.handleChunk);
  }

  private trustedSender(event: Electron.IpcMainEvent) {
    if (!this.window || event.sender !== this.window.webContents)
      throw codedError('拒绝未知音频采集窗口。', 'audio_sender_rejected');
  }

  private handleReady = (event: Electron.IpcMainEvent) => {
    this.trustedSender(event);
    this.readyResolve?.();
    this.readyResolve = null;
  };

  private handleCaptureEvent = (event: Electron.IpcMainEvent, value: Record<string, unknown>) => {
    this.trustedSender(event);
    const sessionId = String(value.session_id || '');
    if (!sessionId || sessionId !== this.sessionId) return;
    const type = String(value.type || '');
    const pending = this.pendingEvents.get(type);
    if (pending) {
      this.pendingEvents.delete(type);
      clearTimeout(pending.timer);
      if (type === 'error')
        pending.reject(codedError(String(value.message || '音频采集失败。'), 'audio_capture_failed'));
      else pending.resolve(value);
    }
    if (type === 'error') this.fail(String(value.message || '音频采集失败。'));
  };

  private handleChunk = (event: Electron.IpcMainEvent, sessionId: string, pcm: ArrayBuffer) => {
    this.trustedSender(event);
    if (sessionId !== this.sessionId || !pcm?.byteLength) return;
    this.acceptPcm('microphone', Buffer.from(pcm));
  };

  private acceptPcm(source: 'microphone' | 'system', pcm: Buffer) {
    if (!['recording', 'stopping'].includes(this.state) || (this.source !== 'mixed' && this.source !== source)) return;
    try {
      this.localRecording?.append(source, pcm);
      this.appendPcm(this.source === 'mixed' ? this.mixer.push(source, pcm) : pcm);
    } catch (error) {
      this.fail(error instanceof Error ? error.message : String(error));
    }
  }

  private appendPcm(pcm: Buffer) {
    if (!pcm.length) return;
    if (this.pcmBytes + pcm.byteLength > maxPcmBytes) {
      this.fail('录音过长，请缩短后重试。');
      return;
    }
    this.pcmChunks.push(pcm);
    this.pcmBytes += pcm.byteLength;
    this.localRecording?.append('output', pcm);
  }

  private finishLocalRecording() {
    const recording = this.localRecording;
    this.localRecording = null;
    if (recording) {
      const save = recording
        .finish()
        .then((directory) => {
          console.info('[audio] Saved local recording:', directory);
        })
        .catch((error) => {
          console.warn('[audio] Could not save local recording:', error);
        });
      this.recordingSaveTask = Promise.all([this.recordingSaveTask, save]).then(() => undefined);
    }
    return this.recordingSaveTask;
  }

  private waitForCaptureEvent(type: string, timeoutMs = 20_000) {
    const previous = this.pendingEvents.get(type);
    if (previous) {
      clearTimeout(previous.timer);
      previous.reject(codedError('音频操作已被新的请求替代。', 'audio_operation_replaced'));
    }
    return new Promise<Record<string, unknown>>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingEvents.delete(type);
        reject(codedError(`等待音频 ${type} 事件超时。`, 'audio_operation_timeout'));
      }, timeoutMs);
      this.pendingEvents.set(type, { resolve, reject, timer });
    });
  }

  private async ensureMicrophonePermission() {
    if (process.platform !== 'darwin') return;
    const status = systemPreferences.getMediaAccessStatus('microphone');
    if (status === 'granted') return;
    if (status === 'denied' || status === 'restricted') {
      throw codedError(
        '麦克风权限已被系统拒绝，请在系统设置中允许 MotusAI Seed 使用麦克风。',
        'microphone_permission_denied',
      );
    }
    if (!(await systemPreferences.askForMediaAccess('microphone')))
      throw codedError('用户未授予麦克风权限。', 'microphone_permission_denied');
  }

  private async ensureWindow() {
    if (this.window && !this.window.isDestroyed()) {
      await this.ready;
      return this.window;
    }
    const captureSession = session.fromPartition('seed-audio-capture');
    this.ready = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(codedError('音频采集窗口启动超时。', 'audio_window_timeout')), 15_000);
      this.readyResolve = () => {
        clearTimeout(timer);
        resolve();
      };
    });
    const window = new BrowserWindow({
      show: false,
      webPreferences: {
        preload: join(__dirname, '../preload/audio-capture.js'),
        partition: 'seed-audio-capture',
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        webSecurity: true,
        backgroundThrottling: false,
        devTools: false,
      },
    });
    this.window = window;
    const allowed = (contents: Electron.WebContents | null, permission: string) =>
      contents === window.webContents && permission === 'media' && this.source !== 'system';
    captureSession.setPermissionCheckHandler((contents, permission) => allowed(contents, permission));
    captureSession.setPermissionRequestHandler((contents, permission, callback) =>
      callback(allowed(contents, permission)),
    );
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    window.webContents.on('will-navigate', (event) => event.preventDefault());
    window.webContents.on('render-process-gone', (_event, details) => {
      if (this.window === window && this.source !== 'system' && this.state !== 'idle')
        this.fail(`音频采集进程已退出：${details.reason}`);
    });
    window.on('closed', () => {
      if (this.window === window) this.window = null;
      if (this.source !== 'system' && this.state !== 'idle') this.fail('音频采集窗口已关闭。');
    });
    if (process.env.VITE_DEV_SERVER_URL)
      await window.loadURL(`${process.env.VITE_DEV_SERVER_URL.replace(/\/$/, '')}/src/renderer/hosts/audio/index.html`);
    else await window.loadFile(join(__dirname, '../../renderer/src/renderer/hosts/audio/index.html'));
    await this.ready;
    return window;
  }

  private durationMs() {
    if (!this.startedAt) return 0;
    const currentPause = this.pausedAt ? Date.now() - this.pausedAt : 0;
    return Math.max(0, Date.now() - this.startedAt - this.pausedTotalMs - currentPause);
  }

  snapshot(): AudioStatus {
    return {
      session_id: this.sessionId || undefined,
      state: this.state,
      source: this.source,
      duration_ms: this.durationMs(),
      ...(this.error ? { error: this.error } : {}),
      ...(this.state === 'stopping' && this.stoppingTaskId ? { task_id: this.stoppingTaskId } : {}),
    };
  }

  private setState(state: AudioState) {
    this.state = state;
    this.stateChanged(this.snapshot());
  }

  private fail(message: string) {
    void this.finishLocalRecording();
    void this.systemCapture?.stop().catch(() => undefined);
    this.systemCapture = null;
    this.mixer.clear();
    if (this.failureResetTimer) clearTimeout(this.failureResetTimer);
    this.error = message;
    this.setState('failed');
    if (this.window && this.sessionId && !this.window.isDestroyed())
      this.window.webContents.send('seed-audio:command', { type: 'stop', session_id: this.sessionId });
    this.pcmChunks = [];
    this.pcmBytes = 0;
    this.segmentOffsetBytes = 0;
    this.pcmBaseOffsetBytes = 0;
    for (const pending of this.pendingEvents.values()) {
      clearTimeout(pending.timer);
      pending.reject(codedError(message, 'audio_capture_failed'));
    }
    this.pendingEvents.clear();
    if (this.durableStore && this.ownerPackageId && this.sessionId) {
      void this.durableStore.updateState(this.ownerPackageId, this.sessionId, 'interrupted').catch(() => undefined);
    }
    this.failureResetTimer = setTimeout(() => {
      this.failureResetTimer = null;
      if (this.state === 'failed') this.reset();
    }, failureResetMs);
  }

  private reset() {
    void this.finishLocalRecording();
    void this.systemCapture?.stop().catch(() => undefined);
    this.systemCapture = null;
    this.mixer.clear();
    this.captureGeneration += 1;
    for (const pending of this.pendingEvents.values()) {
      clearTimeout(pending.timer);
      pending.reject(codedError('音频采集已取消。', 'audio_capture_cancelled'));
    }
    this.pendingEvents.clear();
    if (this.failureResetTimer) clearTimeout(this.failureResetTimer);
    this.failureResetTimer = null;
    this.sessionId = '';
    this.ownerPackageId = '';
    this.stoppingTaskId = undefined;
    this.source = 'microphone';
    this.error = '';
    this.startedAt = 0;
    this.pausedAt = 0;
    this.pausedTotalMs = 0;
    this.pcmChunks = [];
    this.pcmBytes = 0;
    this.segmentOffsetBytes = 0;
    this.pcmBaseOffsetBytes = 0;
    this.setState('idle');
  }

  private async start(argumentsValue: Record<string, unknown>, packageId: string) {
    const source = parseAudioCaptureSource(argumentsValue.source);
    if (source !== 'microphone' && !['darwin', 'win32'].includes(process.platform)) {
      throw codedError('当前平台不支持系统音频采集。请选择麦克风。', 'audio_source_unsupported');
    }
    const sessionId = String(argumentsValue.session_id || '').trim() || randomUUID();
    if (sessionId.length > 128) throw codedError('录音会话 ID 无效。', 'audio_session_invalid');
    if (this.state === 'failed') this.reset();
    if (this.state !== 'idle') {
      if (
        this.ownerPackageId === packageId &&
        this.sessionId === sessionId &&
        this.source === source &&
        (this.state === 'recording' || this.state === 'paused')
      )
        return this.snapshot();
      throw codedError('另一段录音正在进行。', 'audio_session_busy');
    }
    this.sessionId = sessionId;
    this.ownerPackageId = packageId;
    this.source = source;
    const generation = ++this.captureGeneration;
    const assertStarting = () => {
      if (this.captureGeneration !== generation || this.state !== 'starting')
        throw codedError('音频采集已取消。', 'audio_capture_cancelled');
    };
    this.pcmChunks = [];
    this.pcmBytes = 0;
    this.segmentOffsetBytes = 0;
    this.pcmBaseOffsetBytes = 0;
    this.setState('starting');
    try {
      await this.durableStore?.create(packageId, sessionId, source);
      assertStarting();
      if (source !== 'system') await this.ensureMicrophonePermission();
      assertStarting();
      if (source !== 'system') {
        const window = await this.ensureWindow();
        assertStarting();
        const started = this.waitForCaptureEvent('started');
        window.webContents.send('seed-audio:command', { type: 'start', session_id: sessionId });
        await started;
        assertStarting();
      }
      if (source !== 'microphone') {
        const capture = new SystemAudioCapture(
          (pcm) => {
            if (this.captureGeneration === generation) this.acceptPcm('system', pcm);
          },
          (error) => {
            if (this.captureGeneration === generation) this.fail(error.message);
          },
          this.systemRecorderFactory,
        );
        this.systemCapture = capture;
        await capture.start();
      }
      assertStarting();
      if (this.recordingsRoot) {
        const setup = this.recordingSaveTask.then(async () => {
          assertStarting();
          const recording = await LatestAudioRecording.start(this.recordingsRoot!, source).catch((error) => {
            console.warn('[audio] Could not start local recording:', error);
            return null;
          });
          try {
            assertStarting();
          } catch (error) {
            await recording?.finish().catch(() => undefined);
            throw error;
          }
          return recording;
        });
        this.recordingSaveTask = setup.then(
          () => undefined,
          () => undefined,
        );
        this.localRecording = await setup;
      }
      this.startedAt = Date.now();
      this.setState('recording');
      return this.snapshot();
    } catch (error) {
      if (this.captureGeneration !== generation) throw error;
      await this.durableStore?.discard(packageId, sessionId).catch(() => undefined);
      const message = error instanceof Error ? error.message : String(error);
      this.fail(message);
      if (error && typeof error === 'object' && 'code' in error) throw error;
      throw codedError(message, 'audio_capture_failed');
    }
  }

  private async pause() {
    if (this.state !== 'recording') throw codedError('当前没有可暂停的录音。', 'audio_session_not_recording');
    if (this.source !== 'system' && this.window) {
      const paused = this.waitForCaptureEvent('paused');
      this.window.webContents.send('seed-audio:command', { type: 'pause', session_id: this.sessionId });
      await paused;
    }
    this.appendPcm(this.mixer.flush());
    this.mixer.clear();
    await this.segmentTask;
    this.pausedAt = Date.now();
    await this.durableStore?.updateState(this.ownerPackageId, this.sessionId, 'paused');
    this.setState('paused');
    return this.snapshot();
  }

  private async resume() {
    if (this.state !== 'paused') throw codedError('当前没有已暂停的录音。', 'audio_session_not_paused');
    this.mixer.clear();
    if (this.source !== 'system' && this.window) {
      const resumed = this.waitForCaptureEvent('resumed');
      this.window.webContents.send('seed-audio:command', { type: 'resume', session_id: this.sessionId });
      await resumed;
    }
    this.pausedTotalMs += Math.max(0, Date.now() - this.pausedAt);
    this.pausedAt = 0;
    await this.durableStore?.updateState(this.ownerPackageId, this.sessionId, 'recording');
    this.setState('recording');
    return this.snapshot();
  }

  private compactSegmentBuffer() {
    const discardBytes = Math.max(0, this.segmentOffsetBytes - segmentOverlapBytes);
    if (!discardBytes) return;
    const retained = Buffer.concat(this.pcmChunks, this.pcmBytes).subarray(discardBytes);
    this.pcmChunks = retained.byteLength ? [retained] : [];
    this.pcmBytes = retained.byteLength;
    this.segmentOffsetBytes -= discardBytes;
    this.pcmBaseOffsetBytes += discardBytes;
  }

  private captureSegment(): Promise<CapturedSegment> {
    if (!this.segmentTask) {
      const task = this.captureSegmentImpl();
      this.segmentTask = task;
      void task
        .finally(() => {
          if (this.segmentTask === task) this.segmentTask = null;
        })
        .catch(() => undefined);
    }
    return this.segmentTask;
  }

  private async captureSegmentImpl(): Promise<CapturedSegment> {
    const generation = this.captureGeneration;
    const sessionId = this.sessionId;
    const packageId = this.ownerPackageId;
    const endByte = this.pcmBytes;
    const globalEndByte = this.pcmBaseOffsetBytes + endByte;
    if (endByte <= this.segmentOffsetBytes) {
      const position = Math.round(globalEndByte / pcmBytesPerMs);
      return { audio_session_id: '', segment_id: '', start_ms: position, end_ms: position };
    }
    const startByte = this.segmentOffsetBytes > 0 ? Math.max(0, this.segmentOffsetBytes - segmentOverlapBytes) : 0;
    const globalStartByte = this.pcmBaseOffsetBytes + startByte;
    const buffered = Buffer.concat(this.pcmChunks, this.pcmBytes);
    const pcm = Buffer.from(buffered.subarray(startByte, endByte));
    const durable = await this.durableStore?.append(
      packageId,
      sessionId,
      pcm,
      Math.round(globalStartByte / pcmBytesPerMs),
      Math.round(globalEndByte / pcmBytesPerMs),
    );
    if (generation !== this.captureGeneration || this.state === 'failed')
      throw codedError('音频采集已取消。', 'audio_capture_cancelled');
    const audioSessionId = durable?.segment_id || randomUUID();
    this.completedAudio.set(audioSessionId, {
      pcm,
      durationMs: Math.round(pcm.byteLength / pcmBytesPerMs),
      expiresAt: Date.now() + completedAudioTtlMs,
      captureSessionId: this.sessionId,
      packageId: this.ownerPackageId,
    });
    this.segmentOffsetBytes = endByte;
    this.compactSegmentBuffer();
    return {
      audio_session_id: audioSessionId,
      segment_id: audioSessionId,
      start_ms: Math.round(globalStartByte / pcmBytesPerMs),
      end_ms: Math.round(globalEndByte / pcmBytesPerMs),
    };
  }

  private async segment() {
    if (!['recording', 'paused'].includes(this.state))
      throw codedError('当前没有可分段的录音。', 'audio_session_not_recording');
    return {
      session_id: this.sessionId,
      state: this.state,
      duration_ms: this.durationMs(),
      ...(await this.captureSegment()),
    };
  }

  private async stop(taskId?: string) {
    if (!['recording', 'paused'].includes(this.state))
      throw codedError('当前没有可停止的录音。', 'audio_session_not_recording');
    this.stoppingTaskId = taskId;
    this.setState('stopping');
    const durationMs = this.durationMs();
    await this.stopInputs();
    await this.segmentTask;
    this.appendPcm(this.mixer.flush());
    const sessionId = this.sessionId;
    if (!this.pcmBytes) {
      this.fail('没有采集到可转写的音频。');
      throw codedError('没有采集到可转写的音频。', 'audio_empty');
    }
    const segment = await this.captureSegment();
    await this.finishLocalRecording();
    await this.durableStore?.updateState(this.ownerPackageId, sessionId, 'stopped');
    this.reset();
    return { session_id: sessionId, state: 'captured', duration_ms: durationMs, ...segment };
  }

  private async cancel() {
    this.invalidateStart();
    const sessionId = this.sessionId;
    const packageId = this.ownerPackageId;
    if (this.state === 'failed') {
      this.reset();
      await this.durableStore?.discard(packageId, sessionId);
      return { session_id: sessionId, state: 'cancelled' };
    }
    await this.stopInputs();
    await this.segmentTask?.catch(() => undefined);
    await this.finishLocalRecording();
    for (const [id, audio] of this.completedAudio)
      if (audio.captureSessionId === sessionId) this.completedAudio.delete(id);
    if (packageId && sessionId) await this.durableStore?.discard(packageId, sessionId);
    this.reset();
    return { session_id: sessionId, state: 'cancelled' };
  }

  private async interrupt() {
    this.invalidateStart();
    const sessionId = this.sessionId;
    const packageId = this.ownerPackageId;
    if (!sessionId || !packageId) return { session_id: sessionId, state: 'interrupted' };
    await this.stopInputs();
    await this.segmentTask?.catch(() => undefined);
    this.appendPcm(this.mixer.flush());
    if (this.pcmBytes > this.segmentOffsetBytes) await this.captureSegment();
    await this.finishLocalRecording();
    await this.durableStore?.updateState(packageId, sessionId, 'interrupted').catch(() => undefined);
    this.reset();
    return { session_id: sessionId, state: 'interrupted' };
  }

  consume(sessionId: string, packageId = '') {
    const now = Date.now();
    for (const [id, audio] of this.completedAudio) if (audio.expiresAt <= now) this.completedAudio.delete(id);
    const audio = this.completedAudio.get(sessionId);
    if (!audio || audio.packageId !== packageId)
      throw codedError('录音数据不存在或已过期。', 'audio_session_unavailable');
    this.completedAudio.delete(sessionId);
    return { pcm: audio.pcm, durationMs: audio.durationMs, sampleRate: 16_000, channels: 1 as const };
  }

  private async stopInputs() {
    await this.systemCapture?.stop();
    this.systemCapture = null;
    if (this.source !== 'system' && this.window && !this.window.isDestroyed() && this.sessionId) {
      const stopped = this.waitForCaptureEvent('stopped', 1_000);
      this.window.webContents.send('seed-audio:command', { type: 'stop', session_id: this.sessionId });
      await stopped.catch(() => undefined);
    }
  }

  private invalidateStart() {
    if (this.state !== 'starting') return;
    this.captureGeneration += 1;
    const pending = this.pendingEvents.get('started');
    if (pending) {
      clearTimeout(pending.timer);
      pending.reject(codedError('音频采集已取消。', 'audio_capture_cancelled'));
      this.pendingEvents.delete('started');
    }
  }

  async invoke(argumentsValue: Record<string, unknown>, packageId = '', taskId?: string) {
    const operation = String(argumentsValue.operation || '');
    if (
      operation.startsWith('capture.') &&
      !['capture.start', 'capture.sessions', 'capture.read', 'capture.ack', 'capture.discard'].includes(operation)
    ) {
      if (this.ownerPackageId && this.ownerPackageId !== packageId)
        throw codedError('录音会话属于另一个插件。', 'audio_session_forbidden');
    }
    if (operation === 'capture.start') return await this.start(argumentsValue, packageId);
    if (operation === 'capture.pause') return await this.pause();
    if (operation === 'capture.resume') return await this.resume();
    if (operation === 'capture.segment') return await this.segment();
    if (operation === 'capture.stop') return await this.stop(taskId);
    if (operation === 'capture.cancel') return await this.cancel();
    if (operation === 'capture.interrupt') return await this.interrupt();
    if (operation === 'capture.status') return this.snapshot();
    if (operation === 'capture.sessions') {
      const activeSessionId = this.ownerPackageId === packageId ? this.sessionId : '';
      return { sessions: (await this.durableStore?.list(packageId, activeSessionId)) || [] };
    }
    if (operation === 'capture.read') {
      if (!this.durableStore) throw codedError('Durable audio storage is unavailable.', 'audio_storage_unavailable');
      const value = await this.durableStore.readSegment(
        packageId,
        String(argumentsValue.session_id || ''),
        String(argumentsValue.segment_id || ''),
      );
      return {
        pcm_base64: value.pcm.toString('base64'),
        duration_ms: value.segment.end_ms - value.segment.start_ms,
        sample_rate: value.sampleRate,
        channels: value.channels,
        segment_id: value.segment.segment_id,
      };
    }
    if (operation === 'capture.ack') {
      if (!this.durableStore) throw codedError('Durable audio storage is unavailable.', 'audio_storage_unavailable');
      return await this.durableStore.acknowledge(
        packageId,
        String(argumentsValue.session_id || ''),
        String(argumentsValue.segment_id || ''),
      );
    }
    if (operation === 'capture.discard') {
      if (!this.durableStore) throw codedError('Durable audio storage is unavailable.', 'audio_storage_unavailable');
      await this.durableStore.discard(packageId, String(argumentsValue.session_id || ''));
      return { discarded: true };
    }
    if (operation === 'capture.consume') {
      const audio = this.consume(String(argumentsValue.audio_session_id || ''), packageId);
      return {
        pcm_base64: audio.pcm.toString('base64'),
        duration_ms: audio.durationMs,
        sample_rate: audio.sampleRate,
        channels: audio.channels,
      };
    }
    throw codedError(`Audio 不支持操作：${operation || '(空)'}`, 'audio_operation_unsupported');
  }

  async cancelActive() {
    return await this.cancel();
  }

  async destroy() {
    await this.interrupt().catch(() => undefined);
    this.reset();
    await this.recordingSaveTask;
    this.completedAudio.clear();
    this.window?.destroy();
    this.window = null;
    ipcMain.removeListener('seed-audio:ready', this.handleReady);
    ipcMain.removeListener('seed-audio:event', this.handleCaptureEvent);
    ipcMain.removeListener('seed-audio:chunk', this.handleChunk);
  }
}
