import type { UserContent } from "ai";

/**
 * The composer's attachment policy, shared by the browser and the eve channel.
 *
 * @remarks
 * One module owns the limits so the client-side check and the server-side
 * {@link https://eve.dev/docs/channels/eve | upload policy} can never disagree: a file the composer
 * accepts is a file the channel accepts. The channel is the authority, and the browser copy exists
 * only to fail early with a message naming the file rather than after a rejected request.
 *
 * eve writes byte-backed file parts into the session sandbox under `/workspace/attachments` before
 * the first model step, so an attachment arrives as a real file the agent can open, convert, and
 * rewrite with `bash`. That is why attachments travel as inline bytes rather than as a link.
 */

/**
 * Largest attachment the composer sends, in bytes.
 *
 * @remarks
 * Attachments ride inside the turn's JSON body as base64 `data:` URLs, which inflates them by
 * about a third, and the platform caps a function request body at 4.5 MB. Three megabytes of
 * decoded payload leaves room for that expansion plus the message text.
 */
export const MAX_ATTACHMENT_BYTES = 3_000_000;

/** Largest combined payload one message may carry, in bytes. */
export const MAX_ATTACHMENT_TOTAL_BYTES = MAX_ATTACHMENT_BYTES;

/** Most attachments one message may carry. */
export const MAX_ATTACHMENTS_PER_MESSAGE = 5;

/**
 * Media types the composer and the channel accept.
 *
 * @remarks
 * A pattern ending in `/*` matches any subtype, which is how every text format (plain, markdown,
 * csv, html) is covered by one entry. The list is deliberately a list rather than `*`: an
 * attachment becomes a file in the agent's sandbox, so widening it is a decision about what the
 * team is asked to open.
 */
export const ALLOWED_ATTACHMENT_MEDIA_TYPES = [
  "application/json",
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "image/gif",
  "image/jpeg",
  "image/png",
  "image/webp",
  "text/*",
] as const;

/** File input `accept` value built from {@link ALLOWED_ATTACHMENT_MEDIA_TYPES}. */
export const ATTACHMENT_INPUT_ACCEPT = ALLOWED_ATTACHMENT_MEDIA_TYPES.join(",");

/** One file staged in the composer, already read as a `data:` URL. */
export interface ComposerAttachment {
  /** Base64 `data:` URL holding the file's bytes. */
  readonly dataUrl: string;
  /** Stable key for React lists and removal. */
  readonly id: string;
  /** Resolved media type, never empty. */
  readonly mediaType: string;
  /** Original filename, as the person sees it. */
  readonly name: string;
  /** Decoded size in bytes. */
  readonly size: number;
}

const WILDCARD_SUFFIX = "/*";

/**
 * Check a media type against the allow list.
 *
 * @param mediaType - The type reported by the browser or declared by the caller.
 * @returns `true` when an exact entry or a wildcard family matches.
 */
export function isAllowedAttachmentMediaType(mediaType: string): boolean {
  const normalized = mediaType.trim().toLowerCase();

  return ALLOWED_ATTACHMENT_MEDIA_TYPES.some((allowed) =>
    allowed.endsWith(WILDCARD_SUFFIX)
      ? normalized.startsWith(allowed.slice(0, -1))
      : normalized === allowed
  );
}

/**
 * Explain why a file cannot be attached.
 *
 * @param file - The candidate file and the payload already staged alongside it.
 * @returns A message to show the person, or `null` when the file is acceptable.
 */
export function getAttachmentRejection({
  mediaType,
  name,
  size,
  stagedBytes = 0,
  stagedCount = 0,
}: {
  readonly mediaType: string;
  readonly name: string;
  readonly size: number;
  readonly stagedBytes?: number;
  readonly stagedCount?: number;
}): string | null {
  if (stagedCount >= MAX_ATTACHMENTS_PER_MESSAGE) {
    return `You can attach up to ${MAX_ATTACHMENTS_PER_MESSAGE} files per message.`;
  }

  if (!isAllowedAttachmentMediaType(mediaType)) {
    return `${name} is a ${mediaType || "unknown"} file, which this room does not accept.`;
  }

  if (size > MAX_ATTACHMENT_BYTES) {
    return `${name} is ${formatAttachmentSize(size)}. The limit is ${formatAttachmentSize(MAX_ATTACHMENT_BYTES)} per file.`;
  }

  if (stagedBytes + size > MAX_ATTACHMENT_TOTAL_BYTES) {
    return `Attachments add up to more than ${formatAttachmentSize(MAX_ATTACHMENT_TOTAL_BYTES)}. Send ${name} in its own message.`;
  }

  return null;
}

/**
 * Render a byte count the way a person reads it.
 *
 * @param bytes - Size in bytes.
 * @returns A short label such as `240 KB`.
 */
export function formatAttachmentSize(bytes: number): string {
  if (bytes < 1000) {
    return `${bytes} B`;
  }

  if (bytes < 1_000_000) {
    return `${Math.round(bytes / 1000)} KB`;
  }

  return `${(bytes / 1_000_000).toFixed(1)} MB`;
}

/**
 * Decide whether a media type is worth showing as a thumbnail.
 *
 * @param mediaType - The attachment's media type.
 * @returns `true` for raster images the browser renders inline.
 */
export function isPreviewableImage(mediaType: string | undefined): boolean {
  return Boolean(mediaType?.startsWith("image/"));
}

/**
 * Build the turn payload for a message that carries attachments.
 *
 * @remarks
 * Returns the plain string when there is nothing attached, so an ordinary message keeps the
 * simplest wire shape. Otherwise it returns AI SDK `UserContent`: the text part first, then one
 * file part per attachment, which is what eve stages into the sandbox.
 *
 * @param text - The message the person typed.
 * @param attachments - Files staged in the composer.
 * @returns The value to hand to the eve session.
 */
export function toAttachmentUserContent(
  text: string,
  attachments: readonly ComposerAttachment[]
): string | UserContent {
  if (attachments.length === 0) {
    return text;
  }

  return [
    { text, type: "text" as const },
    ...attachments.map((attachment) => ({
      data: attachment.dataUrl,
      filename: attachment.name,
      mediaType: attachment.mediaType,
      type: "file" as const,
    })),
  ];
}
