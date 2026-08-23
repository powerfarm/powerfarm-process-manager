import { ImageResponse } from "next/og";

export const size = {
  height: 180,
  width: 180,
};

export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(
    <div
      style={{
        alignItems: "center",
        background: "#5546d8",
        color: "white",
        display: "flex",
        fontFamily: "Arial, sans-serif",
        fontSize: 42,
        fontWeight: 700,
        height: "100%",
        justifyContent: "center",
        width: "100%",
      }}
    >
      M/5
    </div>,
    size
  );
}
