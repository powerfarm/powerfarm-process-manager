/**
 * The installable app icon: the Powerfarm symbol in cream on black.
 *
 * @remarks
 * Three surfaces need the same mark at different sizes and in different formats: `app/icon.svg`
 * for the browser tab, `app/apple-icon.tsx` for the iOS home screen, and `app/icon-512.png` for
 * install prompts and the manifest. Composing the whole square here means the two generated PNGs
 * are one `img` each, with the centering solved once rather than per size.
 */

/** Field the mark sits on. */
export const APP_ICON_BACKGROUND = "#000000";

/** The mark itself. */
export const APP_ICON_FOREGROUND = "#F8DFC1";

const MARK_WIDTH = 258;
const MARK_HEIGHT = 261;

/**
 * Share of the icon's height the mark occupies.
 *
 * @remarks
 * Sized for the tightest crop it has to survive, the maskable safe zone, which keeps the middle
 * 80% and may cut anything outside it. Filling the square edge to edge would lose the points of
 * the mark on Android and in a macOS dock.
 */
const MARK_SCALE = 0.56;

const MARK_PATH =
  "M 184.00 36.00 L 165.00 36.00 L 161.00 49.00 L 174.00 49.00 L 181.00 52.00 L 236.00 105.00 L 238.00 110.00 L 218.00 136.00 L 131.00 237.00 L 126.00 236.00 L 117.00 226.00 L 107.00 236.00 L 107.00 238.00 L 128.00 260.00 L 179.00 205.00 L 257.00 112.00 L 257.00 104.00 L 190.00 39.00 Z M 127.00 35.00 L 77.00 35.00 L 70.00 37.00 L 0.00 106.00 L 0.00 112.00 L 3.00 118.00 L 84.00 211.00 L 86.00 209.00 L 90.00 194.00 L 20.00 113.00 L 20.00 109.00 L 35.00 92.00 L 75.00 53.00 L 83.00 49.00 L 114.00 50.00 Z M 166.00 0.00 L 111.00 75.00 L 66.00 132.00 L 125.00 132.00 L 96.00 215.00 L 80.00 255.00 L 181.00 114.00 L 188.00 102.00 L 188.00 100.00 L 132.00 100.00 Z";

/**
 * Build the complete icon as an SVG document.
 *
 * @param size - Side of the square, in pixels.
 * @param cornerRadius - Corner rounding. Leave at 0 for the Apple icon, which the platform masks
 * itself, so pre-rounding it would round the corners twice.
 * @returns The SVG source.
 */
export function appIconSvg(size: number, cornerRadius = 0): string {
  const scale = (size * MARK_SCALE) / MARK_HEIGHT;
  const offsetX = (size - MARK_WIDTH * scale) / 2;
  const offsetY = (size - MARK_HEIGHT * scale) / 2;

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">`,
    `<rect width="${size}" height="${size}" rx="${cornerRadius}" fill="${APP_ICON_BACKGROUND}"/>`,
    `<g transform="translate(${offsetX.toFixed(2)} ${offsetY.toFixed(2)}) scale(${scale.toFixed(4)})">`,
    `<path d="${MARK_PATH}" fill="${APP_ICON_FOREGROUND}" fill-rule="evenodd"/>`,
    "</g>",
    "</svg>",
  ].join("");
}

/**
 * Build the icon as a data URI.
 *
 * @remarks
 * `ImageResponse` rasterizes an `img` reliably, which an inline `svg` element is not guaranteed to
 * be, so both generated sizes go through this.
 *
 * @param size - Side of the square, in pixels.
 * @returns A base64 `data:` URI holding the SVG.
 */
export function appIconDataUri(size: number): string {
  const encoded = Buffer.from(appIconSvg(size)).toString("base64");

  return `data:image/svg+xml;base64,${encoded}`;
}
