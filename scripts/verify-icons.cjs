const { readFileSync } = require("node:fs");
const { join, resolve } = require("node:path");
const { app, BrowserWindow } = require("electron");
const { renderImage } = require("./icon-rendering.cjs");

// An optional directory lets the same gate inspect extracted release assets.
const directory = resolve(process.argv[2] || join(__dirname, "../resources/app"));
const files = [
  ["app-icon.png", true],
  ["app-icon.icon/Assets/Bloub-Light-1024.png", true],
  ["app-icon.icon/Assets/Bloub-Dark-1024.png", true],
  ["app-icon.icon/Assets/Background-Light-1024.png", false],
  ["app-icon.icon/Assets/Background-Dark-1024.png", false],
];
const watchdog = setTimeout(() => {
  console.error("Desktop icon verification timed out.");
  app.exit(1);
}, 30_000);

app.whenReady().then(async () => {
  const window = new BrowserWindow({ show: false, webPreferences: { sandbox: true } });
  try {
    for (const [file, requiresLogo] of files) {
      const bytes = readFileSync(join(directory, file));
      await renderImage(window, `data:image/png;base64,${bytes.toString("base64")}`, requiresLogo);
      console.log(`Verified ${file}`);
    }
  } finally {
    window.destroy();
  }
}).then(() => {
  clearTimeout(watchdog);
  app.quit();
}).catch((error) => {
  clearTimeout(watchdog);
  console.error(error);
  app.exit(1);
});
