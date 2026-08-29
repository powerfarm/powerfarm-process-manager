import type { ComposerAttachment } from "@/lib/chat/attachments";

const PENDING_CHAT_STORAGE_MAX_AGE_MS = 10 * 60 * 1000;
const PENDING_CHAT_STORAGE_PREFIX = "eve-chat-pending:";
const PROVISIONAL_CHAT_ID_PREFIX = "new-";

interface StoredPendingChat {
  readonly createdAt: number;
  readonly pendingUserMessage: string;
  readonly version: 1;
}

export function createProvisionalChatId() {
  const randomId =
    globalThis.crypto?.randomUUID?.() ??
    `${Date.now()}-${Math.random().toString(36).slice(2)}`;

  return `${PROVISIONAL_CHAT_ID_PREFIX}${randomId}`;
}

export function isProvisionalChatId(chatId: string) {
  return chatId.startsWith(PROVISIONAL_CHAT_ID_PREFIX);
}

export function writePendingChatMessage(chatId: string, message: string) {
  const pendingUserMessage = message.trim();

  if (!pendingUserMessage || typeof window === "undefined") {
    return false;
  }

  try {
    window.sessionStorage.setItem(
      getPendingChatStorageKey(chatId),
      JSON.stringify({
        createdAt: Date.now(),
        pendingUserMessage,
        version: 1,
      } satisfies StoredPendingChat)
    );
    return true;
  } catch {
    return false;
  }
}

export function readPendingChatMessage(chatId: string) {
  if (typeof window === "undefined") {
    return null;
  }

  const key = getPendingChatStorageKey(chatId);
  const stored = window.sessionStorage.getItem(key);

  if (!stored) {
    return null;
  }

  try {
    const parsed = JSON.parse(stored) as Partial<StoredPendingChat>;
    const createdAt = Number(parsed.createdAt);
    const pendingUserMessage = parsed.pendingUserMessage?.trim();

    if (
      !(pendingUserMessage && Number.isFinite(createdAt)) ||
      Date.now() - createdAt > PENDING_CHAT_STORAGE_MAX_AGE_MS
    ) {
      window.sessionStorage.removeItem(key);
      return null;
    }

    return pendingUserMessage;
  } catch {
    window.sessionStorage.removeItem(key);
    return null;
  }
}

/**
 * Attachments staged on the home composer, waiting for their chat route to mount.
 *
 * @remarks
 * The pending message travels through `sessionStorage` because it has to survive a reload. Files
 * do not: they are megabytes of base64 that would fill the same quota the chat log needs, for a
 * gap measured in milliseconds of client-side navigation. Holding them in module memory keeps the
 * handoff free, and a reload during that gap sends the message on its own, which is the honest
 * outcome for files the browser no longer has.
 */
const pendingChatAttachments = new Map<string, readonly ComposerAttachment[]>();

/**
 * Hand attachments to the chat route about to mount.
 *
 * @param chatId - The provisional chat id the route will use.
 * @param attachments - Files staged alongside the pending message.
 */
export function writePendingChatAttachments(
  chatId: string,
  attachments: readonly ComposerAttachment[]
) {
  if (attachments.length === 0) {
    pendingChatAttachments.delete(chatId);
    return;
  }

  pendingChatAttachments.set(chatId, attachments);
}

/**
 * Read and forget the attachments staged for one chat.
 *
 * @param chatId - The chat the route is mounting.
 * @returns The staged files, or an empty list when the message carried none.
 */
export function takePendingChatAttachments(
  chatId: string
): readonly ComposerAttachment[] {
  const attachments = pendingChatAttachments.get(chatId) ?? [];
  pendingChatAttachments.delete(chatId);

  return attachments;
}

export function clearPendingChatMessage(chatId: string) {
  if (typeof window === "undefined") {
    return;
  }

  window.sessionStorage.removeItem(getPendingChatStorageKey(chatId));
}

function getPendingChatStorageKey(chatId: string) {
  return `${PENDING_CHAT_STORAGE_PREFIX}${chatId}`;
}
