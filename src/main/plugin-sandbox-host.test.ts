import { describe, expect, it, vi } from 'vitest';
import type { SeedPluginRuntimeDefinition } from '../shared/contracts';

const state = vi.hoisted(() => ({
  windows: [] as Array<{
    preferences: { partition: string; additionalArguments: string[] };
    webContents: { emit(event: string, ...args: unknown[]): void; getOSProcessId(): number };
    isDestroyed(): boolean;
  }>,
  handled: new Set<string>(),
  configurations: [] as Array<{ plugins: Array<Record<string, unknown>> }>,
}));

vi.mock('electron', async () => {
  const { EventEmitter } = await import('node:events');
  const ipcMain = new EventEmitter() as EventEmitter & {
    handle(channel: string, handler: unknown): void;
    removeHandler(channel: string): void;
  };
  ipcMain.handle = () => undefined;
  ipcMain.removeHandler = () => undefined;
  class BrowserWindow extends EventEmitter {
    preferences: { partition: string; additionalArguments: string[] };
    destroyed = false;
    webContents = Object.assign(new EventEmitter(), {
      setWindowOpenHandler: () => undefined,
      send: (channel: string, message: unknown) => {
        if (channel.startsWith('seed-plugin-host:configure')) {
          state.configurations.push(message as { plugins: Array<Record<string, unknown>> });
          queueMicrotask(() =>
            ipcMain.emit(
              channel.replace(':configure', ':configured'),
              { sender: this.webContents },
              { ok: true, configuration_id: (message as { configuration_id: string }).configuration_id },
            ),
          );
        }
      },
      getOSProcessId: () => state.windows.indexOf(this) + 1,
    });
    constructor(options: { webPreferences: { partition: string; additionalArguments: string[] } }) {
      super();
      this.preferences = options.webPreferences;
      state.windows.push(this);
    }
    isDestroyed() {
      return this.destroyed;
    }
    destroy() {
      if (!this.destroyed) {
        this.destroyed = true;
        this.emit('closed');
      }
    }
    async loadURL() {
      const suffix = this.preferences.additionalArguments[0]!.split('=')[1] || '';
      queueMicrotask(() => ipcMain.emit(`seed-plugin-host:ready${suffix}`, { sender: this.webContents }));
    }
  }
  return {
    BrowserWindow,
    ipcMain,
    session: {
      fromPartition: (partition: string) => ({
        setPermissionRequestHandler: () => undefined,
        setPermissionCheckHandler: () => false,
        webRequest: { onHeadersReceived: () => undefined },
        protocol: {
          handle: (scheme: string) => {
            state.handled.add(`${partition}:${scheme}`);
          },
          isProtocolHandled: (scheme: string) => state.handled.has(`${partition}:${scheme}`),
          unhandle: (scheme: string) => {
            state.handled.delete(`${partition}:${scheme}`);
          },
        },
      }),
    },
  };
});

import { SeedPluginSandboxSupervisor, requiredPermissions } from './plugin-sandbox-host';

function plugin(name: string): SeedPluginRuntimeDefinition {
  return {
    api_version: 2,
    has_service: true,
    resources: ['main.js'],
    sdk_manifest: {
      id: `com.example.${name}`,
      name,
      version: '1.0.0',
      minAppVersion: '0.2.15',
      description: name,
      author: 'Example',
    },
    package_id: `com.example.${name}`,
    version: '1.0.0',
    runtime_kind: 'sandboxed-web',
    root_path: `/plugins/${name}`,
    entry_path: `/plugins/${name}/index.mjs`,
    sidecars: [],
    permissions: [],
    consumes: [],
    capabilities: [],
    publisher_type: 'official',
  };
}

describe('SeedPluginSandboxSupervisor', () => {
  it('loads code-registered services without sending a redundant capability registry', async () => {
    const supervisor = new SeedPluginSandboxSupervisor(
      async () => undefined,
      () => undefined,
    );
    try {
      await supervisor.configure([plugin('contract')]);
      const owner = state.configurations.at(-1)!.plugins[0]!;
      expect(owner).toMatchObject({ package_id: 'com.example.contract', api_version: 2 });
      expect(owner.sdk_manifest).toMatchObject({ id: 'com.example.contract' });
      expect(owner).not.toHaveProperty('capabilities');
    } finally {
      supervisor.destroy();
      state.windows.length = 0;
      state.handled.clear();
      state.configurations.length = 0;
    }
  });
  it('does not create an old service host for a view-only SDK plugin', async () => {
    state.windows.length = 0;
    const supervisor = new SeedPluginSandboxSupervisor(
      async () => undefined,
      () => undefined,
    );
    try {
      await supervisor.configure([{ ...plugin('view'), api_version: 2, has_service: false }]);
      expect(state.windows).toHaveLength(0);
      expect(() => supervisor.callService('com.example.view', 'missing', {})).toThrow('暂不可用');
    } finally {
      supervisor.destroy();
    }
  });

  it('does not leave orphaned hosts after a concurrent stop overtakes startup', async () => {
    state.windows.length = 0;
    const supervisor = new SeedPluginSandboxSupervisor(
      async () => undefined,
      () => undefined,
    );
    const loading = supervisor.configure([plugin('slow'), plugin('next')]);
    await supervisor.configure([]);
    await loading;
    expect(state.windows.every((window) => window.isDestroyed())).toBe(true);
    expect(() => supervisor.invoke('com.example.next', 'probe', 'echo', { request_id: 'old', arguments: {} })).toThrow(
      '暂不可用',
    );
    supervisor.destroy();
    state.windows.length = 0;
    state.handled.clear();
  });
  it('gives each plugin a distinct runtime partition and restarts only the crashed one', async () => {
    const events: string[] = [];
    const supervisor = new SeedPluginSandboxSupervisor(
      async () => undefined,
      (packageId, event) => events.push(`${packageId}:${event}`),
    );
    try {
      await supervisor.configure([plugin('one'), plugin('two')]);
      expect(state.windows).toHaveLength(2);
      expect(state.windows[0]!.preferences.partition).not.toBe(state.windows[1]!.preferences.partition);
      state.windows[0]!.webContents.emit('render-process-gone', {}, { reason: 'crashed', exitCode: 9 });
      await vi.waitFor(() => expect(state.windows).toHaveLength(3), { timeout: 2_000 });
      expect(state.windows[1]!.isDestroyed()).toBe(false);
      expect(events).toContain('com.example.one:plugin.process.gone');
    } finally {
      supervisor.destroy();
      state.windows.length = 0;
      state.handled.clear();
    }
  });
});

describe('sandbox Host service permissions', () => {
  it('requires screen capture for the generic screen service', () => {
    expect(requiredPermissions('seed.screen', { version: 1, operation: 'capture' })).toEqual(['system.screen-capture']);
    expect(requiredPermissions('seed.screen', { version: 1, operation: 'list_displays' })).toEqual([
      'system.screen-capture',
    ]);
  });
  it('requires write rather than read permission for binary output', () => {
    expect(requiredPermissions('seed.broker.files.invoke', { method: 'write_binary' })).toEqual([
      'resources.directory.write',
    ]);
    expect(requiredPermissions('seed.broker.files.invoke', { method: 'read_binary' })).toEqual([
      'resources.directory.read',
    ]);
    expect(requiredPermissions('seed.broker.files.invoke', { method: 'unknown' })).toBeNull();
  });
});
