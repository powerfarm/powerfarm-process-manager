/**
 * Blob namespace layout and the reserved-path guards that protect it.
 *
 * @remarks
 * Everything the team stores lives in one Blob store, so the path layout is a shared concern
 * rather than a per-feature one. This module owns that layout: the reserved prefixes, what each is
 * for, and which tool is allowed to write it. The general-purpose asset tools consult
 * {@link reservedNamespaceForPath} and {@link reservedNamespaceForUrl} before acting, so a model
 * can't reach a managed document through a generic file operation and overwrite the team's
 * positioning or another user's preferences.
 *
 * Feature modules import their prefix from here rather than declaring their own. The dependency
 * points toward storage on purpose: adding a namespace should be a single edit in this file, and
 * the guards can only be complete if one module sees every prefix.
 */

/**
 * Host suffix that every Vercel Blob URL ends with.
 *
 * @remarks
 * Tools that fetch a model-supplied URL check it against this suffix. Without that check, a tool
 * taking a URL is an SSRF primitive: the model could point it at an internal address or a
 * third-party host and read the response back.
 */
export const BLOB_HOST_SUFFIX = ".blob.vercel-storage.com";

/**
 * A Blob path prefix that the generic asset tools must not touch.
 *
 * @remarks
 * `writeTool` and `readTool` name the tools that own the namespace, so a guard can tell the model
 * where to go instead of only refusing. `readTool` is optional because not every namespace has a
 * meaningful read tool to redirect to.
 */
interface ReservedNamespace {
  /** Human-readable description of what the namespace holds. */
  readonly label: string;
  /** Tool that reads this namespace, when one exists. */
  readonly readTool?: string;
  /** Tool that owns writes to this namespace. */
  readonly writeTool: string;
}

/** Blob path prefix holding the team's shared brand context document. */
export const BRAND_CONTEXT_PREFIX = "brand-context/";

/** Blob path prefix holding per-user preference files. */
export const USER_PREFERENCES_PREFIX = "user-preferences/";

/** Blob path prefix holding handoff artifacts passed between agents. */
export const ARTIFACTS_PREFIX = "artifacts/";

/**
 * Blob path prefix holding files the lead hands back to the person it is talking to.
 *
 * @remarks
 * Deliberately not a reserved namespace. A shared file is an ordinary asset: the person opens it
 * from the link in the conversation, and a specialist briefed on it reaches it with
 * `download_asset`. Reserving the prefix would close both paths to keep out a write nobody makes.
 */
export const SHARED_FILES_PREFIX = "shared/";

/**
 * Every reserved prefix, keyed by the prefix itself.
 *
 * @remarks
 * Add a namespace here and every asset tool starts guarding it, with no change at the call sites.
 */
const RESERVED_NAMESPACES: Readonly<Record<string, ReservedNamespace>> = {
  [BRAND_CONTEXT_PREFIX]: {
    label: "the team's brand context",
    readTool: "get_brand_context",
    writeTool: "save_brand_context",
  },
  [USER_PREFERENCES_PREFIX]: {
    label: "user preferences",
    readTool: "get_user_preferences",
    writeTool: "save_user_preferences",
  },
  [ARTIFACTS_PREFIX]: {
    label: "handoff artifacts",
    readTool: "read_artifact",
    writeTool: "save_artifact",
  },
};

/** Leading slashes stripped from a pathname or URL path before the reserved-prefix check. */
const LEADING_SLASHES = /^\/+/;

/**
 * Find the reserved namespace a Blob pathname falls under, if any.
 *
 * @remarks
 * Leading slashes are stripped first because `@vercel/blob`'s `put` normalizes a pathname by
 * dropping them, so a caller-supplied `/brand-context/brand.md` would land inside the reserved
 * namespace unless the guard sees the normalized form.
 *
 * @param pathname - A Blob object pathname, e.g. `drafts/post.md`.
 * @returns The matching namespace, or `null` when the path is a normal asset.
 */
export const reservedNamespaceForPath = (
  pathname: string
): ReservedNamespace | null => {
  const normalized = pathname.replace(LEADING_SLASHES, "");
  for (const [prefix, namespace] of Object.entries(RESERVED_NAMESPACES)) {
    if (normalized.startsWith(prefix)) {
      return namespace;
    }
  }
  return null;
};

/**
 * Find the reserved namespace a Blob URL points at, if any.
 *
 * @remarks
 * A public Blob URL embeds the object pathname as its URL path. Unparseable input is treated as
 * not reserved; the caller's own URL validation handles malformed URLs.
 *
 * @param url - A full Blob URL.
 * @returns The matching namespace, or `null` when the URL addresses a normal asset.
 */
export const reservedNamespaceForUrl = (
  url: string
): ReservedNamespace | null => {
  try {
    return reservedNamespaceForPath(new URL(url).pathname);
  } catch {
    return null;
  }
};

/**
 * Build the refusal message for a write blocked by a reserved namespace.
 *
 * @param namespace - The namespace the path or URL fell under.
 * @returns A message naming the owning tool, for the model to act on.
 */
export const reservedWriteMessage = (namespace: ReservedNamespace): string =>
  `That path is reserved for ${namespace.label}: use ${namespace.writeTool} instead.`;

/**
 * Build the refusal message for a read blocked by a reserved namespace.
 *
 * @param namespace - The namespace the path or URL fell under.
 * @returns A message naming the owning read tool when there is one.
 */
export const reservedReadMessage = (namespace: ReservedNamespace): string =>
  namespace.readTool
    ? `That path holds ${namespace.label}: use ${namespace.readTool} instead.`
    : `That path is reserved for ${namespace.label}.`;
