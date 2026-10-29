import { join } from 'node:path';
import { app, nativeImage } from 'electron';
import type { SeedDockIconDesignGeneration, SeedDockIconPreference } from '../shared/contracts';

export function resolveDockIconDesignGeneration(
  systemVersion = process.platform === 'darwin' ? process.getSystemVersion?.() ?? '' : '',
): SeedDockIconDesignGeneration {
  return Number.parseInt(systemVersion, 10) >= 27 ? 27 : 26;
}

export class DockIconController {
  private preference: SeedDockIconPreference = 'system';

  constructor(
    private readonly platform: NodeJS.Platform = process.platform,
    private readonly generation = resolveDockIconDesignGeneration(),
  ) {}

  apply(preference: SeedDockIconPreference) {
    if (this.platform !== 'darwin' || !app.dock || preference === this.preference) return;
    const directory = app.isPackaged ? process.resourcesPath : join(app.getAppPath(), 'resources');
    const image = preference === 'system'
      ? nativeImage.createEmpty()
      : nativeImage.createFromPath(join(directory, 'app', 'dock-icons', String(this.generation), `${preference}.png`));
    if (preference !== 'system' && image.isEmpty()) throw new Error(`Dock icon could not be loaded: ${preference}`);
    // An empty NSImage resets applicationIconImage to the bundle's native icon.
    // In particular, the default system preference makes no call at startup.
    app.dock.setIcon(image);
    this.preference = preference;
  }
}
