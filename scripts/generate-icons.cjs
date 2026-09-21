const { execFileSync } = require("node:child_process");
const {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} = require("node:fs");
const { tmpdir } = require("node:os");
const { join, resolve } = require("node:path");
const { app, BrowserWindow } = require("electron");

const projectDirectory = resolve(__dirname, "..");
const resourcesDirectory = join(projectDirectory, "resources");
const appDirectory = join(resourcesDirectory, "app");
const theme = JSON.parse(
  readFileSync(join(appDirectory, "theme.json"), "utf8"),
);

app.commandLine.appendSwitch("force-device-scale-factor", "1");

function selfContainedIconSvg(appearance = "light") {
  const logoSvgPath = join(
    appDirectory,
    appearance === "dark" ? "app-dark.svg" : "app-light.svg",
  );
  const logoSvg = readFileSync(logoSvgPath, "utf8");
  const logoDataUrl = `data:image/svg+xml;base64,${Buffer.from(logoSvg).toString("base64")}`;
  const background = theme.appIcon.background?.[appearance] || "#F4F6F1";
  const logoSize = Math.round(1024 * (theme.appIcon.legacyLogoScale || 0.655));
  const logoOffset = Math.round((1024 - logoSize) / 2);
  return `<svg width="1024" height="1024" viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg"><rect x="100" y="100" width="824" height="824" rx="200" fill="${background}"/><image href="${logoDataUrl}" x="${logoOffset}" y="${logoOffset}" width="${logoSize}" height="${logoSize}"/></svg>`;
}

function iconComposerBackgroundSvg(appearance) {
  const background = theme.appIcon?.background?.[appearance] || "#F4F6F1";
  const gradient = theme.appIcon?.backgroundGradient?.[appearance] || [
    background,
    background,
  ];
  return `<svg width="1024" height="1024" viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="background" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${gradient[0]}"/><stop offset="1" stop-color="${gradient[1]}"/></linearGradient></defs><rect width="1024" height="1024" fill="url(#background)"/></svg>`;
}

function iconComposerLogoSvg(appearance) {
  const logoSvg = readFileSync(
    join(
      appDirectory,
      appearance === "dark" ? "app-dark.svg" : "app-light.svg",
    ),
    "utf8",
  );
  const logoDataUrl = `data:image/svg+xml;base64,${Buffer.from(logoSvg).toString("base64")}`;
  const logoSize = Math.round(1024 * (theme.appIcon?.logoScale || 0.625));
  const logoOffset = Math.round((1024 - logoSize) / 2);
  return `<svg width="1024" height="1024" viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg"><image href="${logoDataUrl}" x="${logoOffset}" y="${logoOffset}" width="${logoSize}" height="${logoSize}"/></svg>`;
}

function writeIconComposerPackage(
  backgroundLightImage,
  backgroundDarkImage,
  logoLightImage,
  logoDarkImage,
  logoDirectory,
) {
  const iconDirectory = join(logoDirectory, "app-icon.icon");
  const assetsDirectory = join(iconDirectory, "Assets");
  rmSync(iconDirectory, { recursive: true, force: true });
  mkdirSync(assetsDirectory, { recursive: true });
  writeFileSync(
    join(assetsDirectory, "Background-Light-1024.png"),
    backgroundLightImage.toPNG(),
  );
  writeFileSync(
    join(assetsDirectory, "Background-Dark-1024.png"),
    backgroundDarkImage.toPNG(),
  );
  writeFileSync(
    join(assetsDirectory, "Bloub-Light-1024.png"),
    logoLightImage.toPNG(),
  );
  writeFileSync(
    join(assetsDirectory, "Bloub-Dark-1024.png"),
    logoDarkImage.toPNG(),
  );
  writeFileSync(
    join(iconDirectory, "icon.json"),
    `${JSON.stringify(
      {
        fill: {
          "automatic-gradient": "extended-srgb:0.49804,0.49804,0.49804,1.00000",
        },
        groups: [
          {
            layers: [
              {
                fill: "none",
                glass: true,
                hidden: false,
                "image-name-specializations": [
                  { value: "Bloub-Light-1024.png" },
                  { appearance: "dark", value: "Bloub-Dark-1024.png" },
                ],
                name: "Bloub",
              },
            ],
            shadow: { kind: "neutral", opacity: 0.42 },
            translucency: { enabled: true, value: 0.18 },
          },
          {
            layers: [
              {
                fill: "none",
                glass: false,
                hidden: false,
                "image-name-specializations": [
                  { value: "Background-Light-1024.png" },
                  { appearance: "dark", value: "Background-Dark-1024.png" },
                ],
                name: "Background",
              },
            ],
            shadow: { kind: "neutral", opacity: 0 },
            translucency: { enabled: false, value: 0.5 },
          },
        ],
        "supported-platforms": { squares: ["macOS"] },
      },
      null,
      2,
    )}\n`,
  );
}

function writeIconset(sourceImage, iconsetDirectory) {
  const sizes = [
    ["icon_16x16.png", 16],
    ["icon_16x16@2x.png", 32],
    ["icon_32x32.png", 32],
    ["icon_32x32@2x.png", 64],
    ["icon_128x128.png", 128],
    ["icon_128x128@2x.png", 256],
    ["icon_256x256.png", 256],
    ["icon_256x256@2x.png", 512],
    ["icon_512x512.png", 512],
    ["icon_512x512@2x.png", 1024],
  ];

  for (const [fileName, size] of sizes) {
    const image =
      size === 1024
        ? sourceImage
        : sourceImage.resize({ width: size, height: size, quality: "best" });
    writeFileSync(join(iconsetDirectory, fileName), image.toPNG());
  }
}

async function renderSvg(window, svg) {
  const html = `<!doctype html><style>html,body{margin:0;width:100%;height:100%;background:transparent}svg{display:block;width:100%;height:100%}svg *{animation-play-state:paused!important;animation-delay:0s!important}</style>${svg}`;
  await window.loadURL(
    `data:text/html;charset=utf-8,${encodeURIComponent(html)}`,
  );
  const capturedImage = await window.webContents.capturePage({
    x: 0,
    y: 0,
    width: 1024,
    height: 1024,
  });
  if (capturedImage.isEmpty()) throw new Error("Rendered image is empty.");
  return capturedImage.getSize().width === 1024 &&
    capturedImage.getSize().height === 1024
    ? capturedImage
    : capturedImage.resize({ width: 1024, height: 1024, quality: "best" });
}

async function generate() {
  const window = new BrowserWindow({
    width: 1024,
    height: 1024,
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: "#00000000",
    webPreferences: { offscreen: true, sandbox: true },
  });

  try {
    const image = await renderSvg(window, selfContainedIconSvg());
    const iconComposerBackgroundLightImage = await renderSvg(
      window,
      iconComposerBackgroundSvg("light"),
    );
    const iconComposerBackgroundDarkImage = await renderSvg(
      window,
      iconComposerBackgroundSvg("dark"),
    );
    const iconComposerLogoLightImage = await renderSvg(
      window,
      iconComposerLogoSvg("light"),
    );
    const iconComposerLogoDarkImage = await renderSvg(
      window,
      iconComposerLogoSvg("dark"),
    );
    const trayLightImage = await renderSvg(
      window,
      readFileSync(join(appDirectory, "app-light.svg"), "utf8"),
    );
    const trayDarkImage = await renderSvg(
      window,
      readFileSync(join(appDirectory, "app-dark.svg"), "utf8"),
    );

    writeFileSync(join(appDirectory, "app-icon.png"), image.toPNG());
    writeIconComposerPackage(
      iconComposerBackgroundLightImage,
      iconComposerBackgroundDarkImage,
      iconComposerLogoLightImage,
      iconComposerLogoDarkImage,
      appDirectory,
    );
    writeFileSync(
      join(appDirectory, "tray-light.png"),
      trayLightImage.resize({ width: 64, height: 64, quality: "best" }).toPNG(),
    );
    writeFileSync(
      join(appDirectory, "tray-dark.png"),
      trayDarkImage.resize({ width: 64, height: 64, quality: "best" }).toPNG(),
    );

    if (process.platform === "darwin") {
      const temporaryDirectory = mkdtempSync(
        join(tmpdir(), "motusai-seed-icon-"),
      );
      const iconsetDirectory = join(temporaryDirectory, "app-icon.iconset");
      mkdirSync(iconsetDirectory);
      try {
        writeIconset(image, iconsetDirectory);
        execFileSync(
          "/usr/bin/iconutil",
          [
            "-c",
            "icns",
            "-o",
            join(appDirectory, "app-icon.icns"),
            iconsetDirectory,
          ],
          { stdio: "inherit" },
        );
      } finally {
        rmSync(temporaryDirectory, { recursive: true, force: true });
      }
    }
    console.log("Generated desktop and tray icons.");
    if (process.platform !== "darwin") {
      console.warn(
        "Skipping ICNS generation because iconutil is only available on macOS.",
      );
    }
  } finally {
    window.destroy();
  }
}

app
  .whenReady()
  .then(generate)
  .then(() => app.quit())
  .catch((error) => {
    console.error(error);
    app.exit(1);
  });
