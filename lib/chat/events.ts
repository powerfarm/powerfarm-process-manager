import type { MessageStreamEvent } from "eve/client";

export function isChatTurnSettledEvent(event: MessageStreamEvent) {
  return (
    event.type === "authorization.required" ||
    event.type === "session.completed" ||
    event.type === "session.failed" ||
    event.type === "session.waiting"
  );
}

const DATA_URL_PREFIX = "data:";
const BASE64_PADDING = /[=]+$/;

/**
 * Drop the inline bytes eve echoes back on a received attachment.
 *
 * @remarks
 * An attachment is sent as a base64 `data:` URL, and `message.received` repeats it on the file
 * part so a client can render what it just uploaded. Every event in a conversation is stored, in
 * the browser or in Neon, so keeping that copy would put a second megabyte-scale copy of each file
 * in chat history for the life of the chat. The bytes have already done their job by then: eve has
 * written the file into the agent's sandbox. What the conversation keeps is the part that stays
 * useful, the filename, media type, and size.
 *
 * @param event - One event arriving from the session stream.
 * @returns The same event when there is nothing to drop, otherwise a copy without the inline data.
 */
export function withoutInlineAttachmentBytes(
  event: MessageStreamEvent
): MessageStreamEvent {
  if (event.type !== "message.received" || !event.data.parts) {
    return event;
  }

  let changed = false;
  const parts = event.data.parts.map((part) => {
    if (part.type !== "file" || !part.url?.startsWith(DATA_URL_PREFIX)) {
      return part;
    }

    changed = true;
    const { url, ...rest } = part;

    return { ...rest, size: part.size ?? dataUrlByteLength(url) };
  });

  return changed ? { ...event, data: { ...event.data, parts } } : event;
}

/**
 * Measure what a base64 `data:` URL decodes to.
 *
 * @remarks
 * The size survives the bytes so an attachment still reads as a file in the conversation after a
 * reload, with its name and how big it was.
 *
 * @param url - A `data:` URL from a received file part.
 * @returns The decoded byte length, or `undefined` when the URL is not base64.
 */
function dataUrlByteLength(url: string): number | undefined {
  const separator = url.indexOf(",");

  if (separator === -1 || !url.slice(0, separator).endsWith(";base64")) {
    return undefined;
  }

  const encoded = url.slice(separator + 1);
  const padding = encoded.match(BASE64_PADDING)?.[0].length ?? 0;

  return Math.max(0, Math.floor((encoded.length * 3) / 4) - padding);
}
