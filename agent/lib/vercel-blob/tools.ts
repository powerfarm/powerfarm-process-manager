import { del, get, head, list, put } from "@vercel/blob";
import { defineTool } from "eve/tools";
import { always } from "eve/tools/approval";
import { z } from "zod";
import {
  BLOB_HOST_SUFFIX,
  reservedNamespaceForPath,
  reservedNamespaceForUrl,
  reservedReadMessage,
  reservedWriteMessage,
  SHARED_FILES_PREFIX,
} from "#lib/vercel-blob/config.js";

/**
 * Shared definitions for the team's Vercel Blob asset tools.
 *
 * @remarks
 * eve resolves an agent's tools from its own `tools/` directory and subagents inherit nothing, so
 * every specialist that needs durable file storage calls these factories from one-line files.
 * Defining them once here means each agent gets the same descriptions, schemas, and reserved-path
 * guards: a guard that only some agents apply is not a guard.
 */

/**
 * Build the tool that uploads text or binary content to Blob storage.
 *
 * @remarks
 * Refuses paths in a reserved namespace so a generic upload can't overwrite a managed document.
 * Binary content is supplied base64-encoded with `isBase64: true`.
 *
 * @returns The `upload_asset` tool definition.
 */
export const uploadAssetTool = () =>
  defineTool({
    description:
      "Upload text or binary content to Vercel Blob storage and return its URL. Use when the " +
      "user wants to save or publish an asset, such as an exported draft or an image, to durable storage.",
    /**
     * Upload the content to Blob storage.
     *
     * @param input - Validated tool input.
     * @returns The asset's `url`, `downloadUrl`, stored `pathname`, and `contentType`, or
     * `success: false` with an `error` message.
     */
    async execute({
      pathname,
      content,
      contentType,
      isBase64,
      access,
      addRandomSuffix,
      allowOverwrite,
    }) {
      const reserved = reservedNamespaceForPath(pathname);
      if (reserved) {
        return {
          contentType: contentType ?? "unknown",
          downloadUrl: "",
          error: reservedWriteMessage(reserved),
          pathname,
          success: false,
          url: "",
        };
      }
      try {
        const body = isBase64 ? Buffer.from(content, "base64") : content;
        const blob = await put(pathname, body, {
          access: access ?? "public",
          addRandomSuffix: addRandomSuffix ?? false,
          allowOverwrite: allowOverwrite ?? false,
          contentType,
        });
        return {
          contentType: blob.contentType,
          downloadUrl: blob.downloadUrl,
          pathname: blob.pathname,
          success: true,
          url: blob.url,
        };
      } catch (error) {
        return {
          contentType: contentType ?? "unknown",
          downloadUrl: "",
          error: error instanceof Error ? error.message : "Upload failed",
          pathname,
          success: false,
          url: "",
        };
      }
    },
    inputSchema: z.object({
      access: z
        .enum(["public", "private"])
        .optional()
        .describe('Access level for the asset. Defaults to "public".'),
      addRandomSuffix: z
        .boolean()
        .optional()
        .describe(
          "Append a random suffix to avoid pathname collisions. Defaults to false."
        ),
      allowOverwrite: z
        .boolean()
        .optional()
        .describe(
          "Allow overwriting an existing blob at the same pathname. Defaults to false."
        ),
      content: z
        .string()
        .describe(
          "Raw text/JSON, or base64-encoded bytes when isBase64 is true."
        ),
      contentType: z
        .string()
        .optional()
        .describe(
          'MIME type, e.g. "text/markdown". Inferred from the extension when omitted.'
        ),
      isBase64: z
        .boolean()
        .optional()
        .describe(
          "Set true when content is base64-encoded binary data. Defaults to false."
        ),
      pathname: z
        .string()
        .min(1)
        .describe(
          'Path and filename including extension, e.g. "drafts/launch-post.md".'
        ),
    }),
    outputSchema: z.object({
      contentType: z.string(),
      downloadUrl: z.string(),
      error: z.string().optional(),
      pathname: z.string(),
      success: z.boolean(),
      url: z.string(),
    }),
  });

/**
 * Build the tool that lists assets in Blob storage.
 *
 * @remarks
 * Objects in a reserved namespace are filtered out of the results, so managed documents don't show
 * up as browsable files.
 *
 * @returns The `list_assets` tool definition.
 */
export const listAssetsTool = () =>
  defineTool({
    description:
      "List assets in Vercel Blob storage, optionally filtered by a path prefix. Returns each " +
      "asset's URL, size, and upload date. Use to browse stored content or locate an asset.",
    /**
     * List matching assets.
     *
     * @param input - Validated tool input.
     * @returns The matching `assets`, their `count`, a `hasMore` flag, and a pagination
     * `cursor`, or an empty list with an `error` message on failure.
     */
    async execute({ prefix, limit }) {
      try {
        const { blobs, hasMore, cursor } = await list({
          limit,
          prefix,
        });
        const visible = blobs.filter(
          (blob) => !reservedNamespaceForPath(blob.pathname)
        );
        return {
          assets: visible.map((blob) => ({
            downloadUrl: blob.downloadUrl,
            pathname: blob.pathname,
            size: blob.size,
            uploadedAt: blob.uploadedAt.toISOString(),
            url: blob.url,
          })),
          count: visible.length,
          cursor,
          hasMore,
        };
      } catch (error) {
        return {
          assets: [],
          count: 0,
          error:
            error instanceof Error ? error.message : "Failed to list assets",
          hasMore: false,
        };
      }
    },
    inputSchema: z.object({
      limit: z
        .number()
        .int()
        .min(1)
        .max(1000)
        .optional()
        .describe("Maximum number of assets to return. Defaults to 1000."),
      prefix: z
        .string()
        .optional()
        .describe(
          'Filter by path prefix/folder, e.g. "drafts/". Omit to list everything.'
        ),
    }),
    outputSchema: z.object({
      assets: z.array(
        z.object({
          downloadUrl: z.string(),
          pathname: z.string(),
          size: z.number(),
          uploadedAt: z.string(),
          url: z.string(),
        })
      ),
      count: z.number(),
      cursor: z.string().optional(),
      error: z.string().optional(),
      hasMore: z.boolean(),
    }),
  });

/**
 * Build the tool that reads an asset's metadata without downloading it.
 *
 * @returns The `get_asset_info` tool definition.
 */
export const getAssetInfoTool = () =>
  defineTool({
    description:
      "Get metadata (size, content type, upload date) for a Vercel Blob asset without " +
      "downloading it. Use to check whether an asset exists or inspect it before downloading.",
    /**
     * Look up the asset's metadata.
     *
     * @param input - Validated tool input.
     * @returns `exists: true` with the asset's metadata, or `exists: false` with an `error`.
     */
    async execute({ url }) {
      const reserved = reservedNamespaceForUrl(url);
      if (reserved) {
        return {
          error: reservedReadMessage(reserved),
          exists: false,
          url,
        };
      }
      try {
        const metadata = await head(url);
        return {
          contentType: metadata.contentType,
          downloadUrl: metadata.downloadUrl,
          exists: true,
          pathname: metadata.pathname,
          size: metadata.size,
          uploadedAt: metadata.uploadedAt.toISOString(),
          url: metadata.url,
        };
      } catch (error) {
        return {
          error: error instanceof Error ? error.message : "Asset not found",
          exists: false,
          url,
        };
      }
    },
    inputSchema: z.object({
      url: z.url().describe("The full Blob URL of the asset to inspect."),
    }),
    outputSchema: z.object({
      contentType: z.string().optional(),
      downloadUrl: z.string().optional(),
      error: z.string().optional(),
      exists: z.boolean(),
      pathname: z.string().optional(),
      size: z.number().optional(),
      uploadedAt: z.string().optional(),
      url: z.string(),
    }),
  });

/**
 * Build the tool that downloads an asset's contents.
 *
 * @remarks
 * The `url` is model-supplied, so it is checked against {@link BLOB_HOST_SUFFIX} before the fetch:
 * without that check this tool is an SSRF primitive. Text content is returned raw; binary content
 * comes back base64-encoded with `isBase64: true`.
 *
 * @returns The `download_asset` tool definition.
 */
export const downloadAssetTool = () =>
  defineTool({
    description:
      "Download and return the contents of a Vercel Blob asset. Use when the user wants to " +
      "read or reuse a stored file. Text is returned raw; binary files come back base64-encoded.",
    /**
     * Fetch and return the asset contents.
     *
     * @param input - Validated tool input.
     * @returns The asset `content` (raw text or base64) with its `contentType`, or
     * `success: false` with an `error` message.
     */
    async execute({ url }) {
      const reserved = reservedNamespaceForUrl(url);
      if (reserved) {
        return {
          error: reservedReadMessage(reserved),
          success: false,
          url,
        };
      }
      try {
        if (!new URL(url).hostname.endsWith(BLOB_HOST_SUFFIX)) {
          return {
            error: `Refusing to download: only Vercel Blob URLs (*${BLOB_HOST_SUFFIX}) are allowed.`,
            success: false,
            url,
          };
        }

        const result = await get(url, { access: "public" });
        if (!result?.stream) {
          return {
            error: "Failed to download: no content returned for that URL.",
            success: false,
            url,
          };
        }

        const contentType =
          result.blob.contentType ?? "application/octet-stream";
        const isText =
          contentType.startsWith("text/") || contentType.includes("json");
        const response = new Response(result.stream);
        const content = isText
          ? await response.text()
          : Buffer.from(await response.arrayBuffer()).toString("base64");

        return { content, contentType, isBase64: !isText, success: true, url };
      } catch (error) {
        return {
          error: error instanceof Error ? error.message : "Download failed",
          success: false,
          url,
        };
      }
    },
    inputSchema: z.object({
      url: z
        .url()
        .describe("The full Vercel Blob URL of the asset to download."),
    }),
    outputSchema: z.object({
      content: z.string().optional(),
      contentType: z.string().optional(),
      error: z.string().optional(),
      isBase64: z.boolean().optional(),
      success: z.boolean(),
      url: z.string(),
    }),
  });

/**
 * Build the tool that permanently deletes an asset.
 *
 * @remarks
 * Deletion is irreversible, so this tool is gated on human approval on every call. Reserved
 * namespaces are refused: a managed document is only removable through the tool that owns it.
 *
 * @returns The `delete_asset` tool definition.
 */
export const deleteAssetTool = () =>
  defineTool({
    approval: always(),
    description:
      "Permanently delete an asset from Vercel Blob storage by its URL. Use only when the user " +
      "explicitly asks to remove a stored file. This is irreversible.",
    /**
     * Delete the asset.
     *
     * @param input - Validated tool input.
     * @returns `success`/`deleted` flags and the `url`, or `success: false` with an `error`.
     */
    async execute({ url }) {
      const reserved = reservedNamespaceForUrl(url);
      if (reserved) {
        return {
          deleted: false,
          error: reservedWriteMessage(reserved),
          success: false,
          url,
        };
      }
      try {
        await del(url);
        return { deleted: true, success: true, url };
      } catch (error) {
        return {
          deleted: false,
          error: error instanceof Error ? error.message : "Delete failed",
          success: false,
          url,
        };
      }
    },
    inputSchema: z.object({
      url: z.url().describe("The full Vercel Blob URL of the asset to delete."),
    }),
    outputSchema: z.object({
      deleted: z.boolean(),
      error: z.string().optional(),
      success: z.boolean(),
      url: z.string(),
    }),
  });

/**
 * Largest file the share tool will publish, in bytes.
 *
 * @remarks
 * A share is a link in a conversation rather than a data transfer, so the cap is generous but
 * finite: past it the agent should say what it produced and where, instead of moving a large
 * artifact through Blob on its own initiative.
 */
const MAX_SHARED_FILE_BYTES = 25_000_000;

/** Characters replaced when a sandbox filename becomes part of a Blob pathname. */
const UNSAFE_FILENAME_CHARS = /[^\w.-]+/g;

/**
 * Reduce a sandbox path to a safe Blob filename.
 *
 * @param path - The sandbox path the model supplied.
 * @param override - An explicit filename to use instead of the path's basename.
 * @returns A filename with no directory separators.
 */
const sharedFilename = (path: string, override?: string): string => {
  const candidate = (override ?? path).split("/").at(-1) ?? "";
  const safe = candidate.trim().replace(UNSAFE_FILENAME_CHARS, "_");

  return safe.length > 0 ? safe : "file";
};

/**
 * Build the tool that publishes a file from the agent's sandbox and returns its link.
 *
 * @remarks
 * This is the return path for files. Inbound attachments land in the session sandbox, the agent
 * works on them there with `bash` and the file tools, and the result is a file with no way back to
 * the conversation: a sandbox path is not a link, and the session's sandbox does not outlive it.
 * Reading the bytes here rather than taking them as tool input keeps a document of any size out of
 * the model's context, which is the difference between this and `upload_asset`.
 *
 * The upload lands under {@link SHARED_FILES_PREFIX} with a random suffix, so sharing the same
 * filename twice produces two links rather than overwriting the first.
 *
 * @returns The `share_file` tool definition.
 */
export const shareFileTool = () =>
  defineTool({
    description:
      "Publish a file from your sandbox and return a link to it. Use it whenever the person " +
      "should end up with the file itself: an export you generated, a converted or edited " +
      "version of something they attached, or an attachment a specialist needs. Write the file " +
      "in the sandbox first, then pass its path. Give the person the returned url as a markdown " +
      "link, and put that url in a specialist's brief when the work continues.",
    /**
     * Read the sandbox file and upload it.
     *
     * @param input - Validated tool input.
     * @param ctx - Runtime context supplying the live sandbox handle.
     * @returns The file's `url`, `downloadUrl`, stored `pathname`, `filename`, `contentType`, and
     * `size`, or `success: false` with an `error` message.
     */
    async execute({ path, filename, contentType }, ctx) {
      const name = sharedFilename(path, filename);
      try {
        const sandbox = await ctx.getSandbox();
        const bytes = await sandbox.readBinaryFile({ path });
        if (bytes === null) {
          return {
            downloadUrl: "",
            error: `No file at ${path} in the sandbox. Check the path with bash before sharing.`,
            filename: name,
            pathname: "",
            size: 0,
            success: false,
            url: "",
          };
        }
        if (bytes.byteLength > MAX_SHARED_FILE_BYTES) {
          return {
            downloadUrl: "",
            error: `${name} is ${bytes.byteLength} bytes, over the ${MAX_SHARED_FILE_BYTES} byte share limit. Tell the person what you produced instead of sharing it.`,
            filename: name,
            pathname: "",
            size: bytes.byteLength,
            success: false,
            url: "",
          };
        }
        const blob = await put(
          `${SHARED_FILES_PREFIX}${name}`,
          Buffer.from(bytes),
          {
            access: "public",
            addRandomSuffix: true,
            contentType,
          }
        );
        return {
          contentType: blob.contentType,
          downloadUrl: blob.downloadUrl,
          filename: name,
          pathname: blob.pathname,
          size: bytes.byteLength,
          success: true,
          url: blob.url,
        };
      } catch (error) {
        return {
          downloadUrl: "",
          error: error instanceof Error ? error.message : "Share failed",
          filename: name,
          pathname: "",
          size: 0,
          success: false,
          url: "",
        };
      }
    },
    inputSchema: z.object({
      contentType: z
        .string()
        .max(255)
        .optional()
        .describe(
          'MIME type, e.g. "text/csv". Inferred from the extension when omitted.'
        ),
      filename: z
        .string()
        .max(255)
        .optional()
        .describe(
          "Name the person should see, when it differs from the file's name in the sandbox."
        ),
      path: z
        .string()
        .min(1)
        .max(1024)
        .describe(
          'Sandbox path of the file to share, e.g. "/workspace/attachments/<hash>/brief.docx" or "exports/report.csv".'
        ),
    }),
    outputSchema: z.object({
      contentType: z.string().optional(),
      downloadUrl: z.string(),
      error: z.string().optional(),
      filename: z.string(),
      pathname: z.string(),
      size: z.number(),
      success: z.boolean(),
      url: z.string(),
    }),
  });
