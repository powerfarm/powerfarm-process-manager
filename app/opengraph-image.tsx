import { ImageResponse } from "next/og";

export const size = {
  height: 630,
  width: 1200,
};

export const contentType = "image/png";

export default function OpenGraphImage() {
  return new ImageResponse(
    <div
      style={{
        alignItems: "center",
        background: "#f2f5fb",
        color: "#1c2333",
        display: "flex",
        height: "100%",
        justifyContent: "center",
        padding: "70px",
        width: "100%",
      }}
    >
      <div
        style={{
          alignItems: "flex-start",
          border: "1px solid #d5dae7",
          borderRadius: 34,
          display: "flex",
          flexDirection: "column",
          height: "100%",
          justifyContent: "space-between",
          padding: "54px 62px",
          width: "100%",
        }}
      >
        <div style={{ alignItems: "center", display: "flex", gap: 18 }}>
          <div
            style={{
              alignItems: "center",
              background: "#5546d8",
              borderRadius: 16,
              color: "white",
              display: "flex",
              fontSize: 24,
              fontWeight: 700,
              height: 62,
              justifyContent: "center",
              width: 62,
            }}
          >
            M/5
          </div>
          <div
            style={{
              color: "#5546d8",
              fontSize: 22,
              fontWeight: 700,
              letterSpacing: 4,
            }}
          >
            MARKETING ROOM
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column" }}>
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              fontSize: 74,
              fontWeight: 600,
              letterSpacing: -4,
              lineHeight: 1.02,
            }}
          >
            Put the whole campaign
            <br />
            on one desk.
          </div>
          <div style={{ color: "#667085", fontSize: 24, marginTop: 28 }}>
            Strategy · Content · Social · Search · Email
          </div>
        </div>
      </div>
    </div>,
    size
  );
}
