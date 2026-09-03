import { ImageResponse } from "next/og";
import { appIconDataUri } from "@/lib/app-icon";

/**
 * The installable app icon, at the size install prompts and home screens ask for.
 *
 * @remarks
 * `app/icon.svg` covers the browser tab and `app/apple-icon.tsx` covers the iOS home screen, but a
 * browser checks a web app manifest against a raster icon of at least 192 pixels before offering to
 * install anything. Serving it from a route rather than a metadata file keeps the URL stable and
 * unhashed, which is what the manifest has to reference.
 */
const SIZE = 512;

export function GET() {
  return new ImageResponse(
    <img alt="" height={SIZE} src={appIconDataUri(SIZE)} width={SIZE} />,
    { height: SIZE, width: SIZE }
  );
}
