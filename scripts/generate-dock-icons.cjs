const { execFileSync } = require('node:child_process');
const { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join, resolve } = require('node:path');
const { app, BrowserWindow } = require('electron');
const { renderImage } = require('./icon-rendering.cjs');

// Freeze the two appearances using Apple's renderer and the same source as the
// bundle icon. The system option never uses these static runtime alternatives.
async function generateDockIcons(window, directory) {
  if (process.platform !== 'darwin') return;
  const developerDirectory = execFileSync('xcode-select', ['-p'], { encoding: 'utf8' }).trim();
  const renderer = resolve(developerDirectory, '../Applications/Icon Composer.app/Contents/Executables/ictool');
  const temporary = mkdtempSync(join(tmpdir(), 'seed-dock-icons-'));
  const output = join(directory, 'dock-icons');
  mkdirSync(output, { recursive: true });
  try {
    for (const generation of [26, 27]) {
      const generationDirectory = join(output, String(generation));
      mkdirSync(generationDirectory, { recursive: true });
      for (const [appearance, rendition] of [['light', 'Default'], ['dark', 'Dark']]) {
        const rendered = join(temporary, `${generation}-${appearance}.png`);
        // Do not let the build machine's Xcode choose a different native style.
        execFileSync(renderer, [join(directory, 'app-icon.icon'), '--export-image', '--output-file', rendered,
          '--platform', 'macOS', '--rendition', rendition, '--width', '1024', '--height', '1024', '--scale', '1',
          '--design-generation', String(generation)],
        { stdio: 'pipe' });
        // Dock renders a runtime bitmap slightly smaller than the adaptive bundle
        // icon with the same 824px artwork. Use less inset to match its footprint.
        const artworkSize = 840;
        const offset = (1024 - artworkSize) / 2;
        const source = readFileSync(rendered).toString('base64');
        const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024"><image href="data:image/png;base64,${source}" x="${offset}" y="${offset}" width="${artworkSize}" height="${artworkSize}"/></svg>`;
        const image = await renderImage(window, `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`);
        writeFileSync(join(generationDirectory, `${appearance}.png`), image.toPNG());
        writeFileSync(join(generationDirectory, `${appearance}-preview.png`), image.resize({ width: 256, height: 256, quality: 'best' }).toPNG());
      }
    }
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
}

module.exports = { generateDockIcons };

if (process.argv[1] && resolve(process.argv[1]) === __filename) {
  app.whenReady().then(async () => {
    const window = new BrowserWindow({ show: false, webPreferences: { sandbox: true } });
    try { await generateDockIcons(window, resolve(__dirname, '../resources/app')); }
    finally { window.destroy(); }
  }).then(() => app.quit()).catch((error) => { console.error(error); app.exit(1); });
}
