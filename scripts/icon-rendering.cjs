function validateIconPixels({ data, width, height }, requiresLogo = true) {
  if (width !== 1024 || height !== 1024 || data.length !== width * height * 4) {
    throw new Error("Desktop icon must contain 1024×1024 RGBA pixels.");
  }
  let visible = 0;
  let dark = 0;
  let light = 0;
  // The center of both light/dark Bloub icons contains opaque body and eyes.
  // Ignore the outer background so it cannot hide a missing logo or eyes.
  for (let y = 308; y < 716; y++) {
    for (let x = 308; x < 716; x++) {
      const offset = (y * width + x) * 4;
      if (data[offset + 3] < 240) continue;
      visible++;
      const brightness = (data[offset] + data[offset + 1] + data[offset + 2]) / 3;
      if (brightness < 64) dark++;
      if (brightness > 192) light++;
    }
  }
  if (visible < 100_000 || (requiresLogo && (dark < 500 || light < 500))) {
    throw new Error("Desktop icon is blank or missing its logo/eyes.");
  }
}

// Runs inside Chromium. Canvas encoding waits for decoding, not an offscreen
// compositor screenshot that can capture the background before the SVG image.
async function rasterizeImage(source, requiresLogo, validatePixels) {
  const image = new Image();
  image.src = source;
  await image.decode();
  if (image.naturalWidth !== 1024 || image.naturalHeight !== 1024) {
    throw new Error("Desktop icon source must be 1024×1024.");
  }
  const canvas = document.createElement("canvas");
  canvas.width = 1024;
  canvas.height = 1024;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Desktop icon canvas is unavailable.");
  context.drawImage(image, 0, 0, 1024, 1024);
  validatePixels(context.getImageData(0, 0, 1024, 1024), requiresLogo);
  return canvas.toDataURL("image/png");
}

async function renderImage(window, source, requiresLogo = true) {
  const { nativeImage } = require("electron");
  await window.loadURL("data:text/html;charset=utf-8,<!doctype html><html></html>");
  const png = await window.webContents.executeJavaScript(
    `(${rasterizeImage})(${JSON.stringify(source)}, ${requiresLogo}, ${validateIconPixels})`,
  );
  return nativeImage.createFromDataURL(png);
}

module.exports = { renderImage, rasterizeImage, validateIconPixels };
