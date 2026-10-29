import { beforeEach, describe, expect, it, vi } from 'vitest';

const electron = vi.hoisted(() => ({
  setIcon: vi.fn(),
  createFromPath: vi.fn(),
  createEmpty: vi.fn(),
}));
vi.mock('electron', () => ({
  app: { isPackaged: false, getAppPath: () => '/seed', dock: { setIcon: electron.setIcon } },
  nativeImage: { createFromPath: electron.createFromPath, createEmpty: electron.createEmpty },
}));
import { DockIconController, resolveDockIconDesignGeneration } from './dock-icon';

beforeEach(() => {
  vi.clearAllMocks();
  electron.createFromPath.mockReturnValue({ isEmpty: () => false });
  electron.createEmpty.mockReturnValue({ isEmpty: () => true });
});

describe('Dock icon appearance', () => {
  it.each([
    ['15.7', 26], ['26.7.1', 26], ['27.1', 27], ['', 26],
  ] as const)('uses the running macOS design generation for %s', (version, generation) => {
    expect(resolveDockIconDesignGeneration(version)).toBe(generation);
  });

  it('loads the newer design only for a system that uses it', () => {
    new DockIconController('darwin', 27).apply('light');
    expect(electron.createFromPath).toHaveBeenCalledExactlyOnceWith('/seed/resources/app/dock-icons/27/light.png');
  });
  it('leaves the native icon untouched when starting with the system preference', () => {
    new DockIconController('darwin').apply('system');
    expect(electron.setIcon).not.toHaveBeenCalled();
    expect(electron.createFromPath).not.toHaveBeenCalled();
  });

  it('loads native-rendered alternatives and restores the bundle icon for system', () => {
    const controller = new DockIconController('darwin');
    controller.apply('dark');
    controller.apply('dark');
    expect(electron.createFromPath).toHaveBeenCalledExactlyOnceWith('/seed/resources/app/dock-icons/26/dark.png');
    expect(electron.setIcon).toHaveBeenCalledTimes(1);
    controller.apply('light');
    expect(electron.createFromPath).toHaveBeenLastCalledWith('/seed/resources/app/dock-icons/26/light.png');
    controller.apply('system');
    expect(electron.setIcon).toHaveBeenLastCalledWith(electron.createEmpty.mock.results[0].value);
  });

  it('preserves the current icon if an alternative cannot be loaded', () => {
    electron.createFromPath.mockReturnValueOnce({ isEmpty: () => true });
    const controller = new DockIconController('darwin');
    expect(() => controller.apply('dark')).toThrow('Dock icon could not be loaded');
    expect(electron.setIcon).not.toHaveBeenCalled();
    controller.apply('dark');
    expect(electron.setIcon).toHaveBeenCalledTimes(1);
  });

  it.each(['win32', 'linux'] as const)('does not change icons on %s', (platform) => {
    new DockIconController(platform).apply('dark');
    expect(electron.setIcon).not.toHaveBeenCalled();
  });
});
