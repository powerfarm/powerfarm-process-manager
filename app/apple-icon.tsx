import { ImageResponse } from "next/og";
import { appIconDataUri } from "@/lib/app-icon";

export const size = {
  height: 180,
  width: 180,
};

export const contentType = "image/png";

/**
 * The home screen icon iOS uses when the room is added to a device.
 *
 * @remarks
 * Rendered edge to edge with no corner rounding, since the platform applies its own mask and
 * pre-rounding it would round the corners twice.
 */
export default function AppleIcon() {
  return new ImageResponse(
    <img
      alt=""
      height={size.height}
      src={appIconDataUri(size.width)}
      width={size.width}
    />,
    size
  );
}
