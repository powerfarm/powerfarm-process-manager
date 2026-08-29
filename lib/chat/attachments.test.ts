import type { MessageStreamEvent } from "eve/client";
import { describe, expect, it } from "vitest";
import {
  formatAttachmentSize,
  getAttachmentRejection,
  isAllowedAttachmentMediaType,
  isPreviewableImage,
  MAX_ATTACHMENT_BYTES,
  MAX_ATTACHMENTS_PER_MESSAGE,
  toAttachmentUserContent,
} from "@/lib/chat/attachments";
import { withoutInlineAttachmentBytes } from "@/lib/chat/events";

const attachment = {
  dataUrl: "data:text/csv;base64,YSxiCjEsMgo=",
  id: "spend.csv:12:1",
  mediaType: "text/csv",
  name: "spend.csv",
  size: 12,
};

describe("isAllowedAttachmentMediaType", () => {
  it.each([
    { allowed: true, mediaType: "image/png" },
    { allowed: true, mediaType: "application/pdf" },
    { allowed: true, mediaType: "text/csv" },
    { allowed: true, mediaType: "text/markdown" },
    { allowed: true, mediaType: "TEXT/PLAIN" },
    { allowed: false, mediaType: "image/svg+xml" },
    { allowed: false, mediaType: "application/zip" },
    { allowed: false, mediaType: "" },
  ])("resolves $mediaType to $allowed", ({ allowed, mediaType }) => {
    expect(isAllowedAttachmentMediaType(mediaType)).toBe(allowed);
  });
});

describe("getAttachmentRejection", () => {
  it("accepts a file inside every limit", () => {
    expect(
      getAttachmentRejection({
        mediaType: "text/csv",
        name: "spend.csv",
        size: 2048,
      })
    ).toBeNull();
  });

  it("refuses a media type outside the allow list", () => {
    expect(
      getAttachmentRejection({
        mediaType: "application/zip",
        name: "assets.zip",
        size: 2048,
      })
    ).toContain("assets.zip");
  });

  it("refuses a file over the per-file cap", () => {
    expect(
      getAttachmentRejection({
        mediaType: "application/pdf",
        name: "deck.pdf",
        size: MAX_ATTACHMENT_BYTES + 1,
      })
    ).toContain("limit");
  });

  it("refuses a file that pushes the message over the total cap", () => {
    expect(
      getAttachmentRejection({
        mediaType: "application/pdf",
        name: "deck.pdf",
        size: 1000,
        stagedBytes: MAX_ATTACHMENT_BYTES,
        stagedCount: 1,
      })
    ).toContain("own message");
  });

  it("refuses more files than one message may carry", () => {
    expect(
      getAttachmentRejection({
        mediaType: "text/csv",
        name: "spend.csv",
        size: 10,
        stagedCount: MAX_ATTACHMENTS_PER_MESSAGE,
      })
    ).toContain(String(MAX_ATTACHMENTS_PER_MESSAGE));
  });
});

describe("toAttachmentUserContent", () => {
  it("keeps a plain string when nothing is attached", () => {
    expect(toAttachmentUserContent("Draft the launch post", [])).toBe(
      "Draft the launch post"
    );
  });

  it("puts the text first and one file part per attachment", () => {
    expect(toAttachmentUserContent("Read this", [attachment])).toEqual([
      { text: "Read this", type: "text" },
      {
        data: attachment.dataUrl,
        filename: "spend.csv",
        mediaType: "text/csv",
        type: "file",
      },
    ]);
  });
});

describe("formatAttachmentSize", () => {
  it.each([
    { bytes: 512, label: "512 B" },
    { bytes: 2048, label: "2 KB" },
    { bytes: 2_400_000, label: "2.4 MB" },
  ])("renders $bytes as $label", ({ bytes, label }) => {
    expect(formatAttachmentSize(bytes)).toBe(label);
  });
});

describe("isPreviewableImage", () => {
  it.each([
    { mediaType: "image/png", previewable: true },
    { mediaType: "text/csv", previewable: false },
    { mediaType: undefined, previewable: false },
  ])("resolves $mediaType to $previewable", ({ mediaType, previewable }) => {
    expect(isPreviewableImage(mediaType)).toBe(previewable);
  });
});

function receivedEvent(url: string): MessageStreamEvent {
  return {
    data: {
      message: "Read this\n[file: spend.csv (text/csv)]",
      parts: [
        { text: "Read this", type: "text" },
        { filename: "spend.csv", mediaType: "text/csv", type: "file", url },
      ],
      sequence: 1,
      turnId: "turn_1",
    },
    meta: { at: "2026-08-29T00:00:00.000Z", id: "evt_1" },
    type: "message.received",
  } as MessageStreamEvent;
}

describe("withoutInlineAttachmentBytes", () => {
  it("drops a data url and keeps the decoded size", () => {
    const event = withoutInlineAttachmentBytes(
      receivedEvent(attachment.dataUrl)
    );

    expect(event.type).toBe("message.received");
    expect(event).toMatchObject({
      data: {
        parts: [
          { text: "Read this", type: "text" },
          {
            filename: "spend.csv",
            mediaType: "text/csv",
            size: 8,
            type: "file",
          },
        ],
      },
    });
  });

  it("leaves a hosted url alone", () => {
    const original = receivedEvent(
      "https://example.blob.vercel-storage.com/shared/spend.csv"
    );

    expect(withoutInlineAttachmentBytes(original)).toBe(original);
  });

  it("passes through events with no parts", () => {
    const original = {
      data: { sequence: 1, turnId: "turn_1" },
      meta: { at: "2026-08-29T00:00:00.000Z", id: "evt_2" },
      type: "turn.started",
    } as MessageStreamEvent;

    expect(withoutInlineAttachmentBytes(original)).toBe(original);
  });
});
