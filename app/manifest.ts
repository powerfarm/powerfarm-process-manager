import type { MetadataRoute } from "next";

/**
 * The web app manifest that lets the Marketing Room be installed.
 *
 * @remarks
 * Enough for the two cases people actually ask for: Add to Home Screen on iOS and Add to Dock in
 * Safari on macOS, neither of which needs a service worker. Chrome's install prompt additionally
 * wants a raster icon of at least 192 pixels, which `/icon-512.png` supplies.
 *
 * `background_color` paints the launch screen before the app renders, so it matches the dark
 * surface rather than the brand purple: a splash in a color the app never shows reads as a flash.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    background_color: "#080d19",
    description:
      "One durable workspace for strategy, content, social, search, and email.",
    display: "standalone",
    icons: [
      { purpose: "any", sizes: "any", src: "/icon.svg", type: "image/svg+xml" },
      {
        purpose: "any",
        sizes: "512x512",
        src: "/icon-512.png",
        type: "image/png",
      },
      {
        purpose: "maskable",
        sizes: "512x512",
        src: "/icon-512.png",
        type: "image/png",
      },
    ],
    id: "/",
    name: "Marketing Room",
    scope: "/",
    short_name: "Marketing",
    start_url: "/",
    theme_color: "#080d19",
  };
}
