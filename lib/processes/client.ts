import { z } from "zod";
import {
  processEdgeSchema,
  processEventSchema,
  processNodeSchema,
  processProjectionSchema,
  processSummarySchema,
} from "@/lib/processes/contracts";

const processDetailSchema = z
  .object({
    process: processSummarySchema,
    projection: processProjectionSchema,
  })
  .strict();

const processGraphPageSchema = z
  .object({
    edges: z.array(processEdgeSchema),
    nextCursor: z.string().nullable(),
    nodes: z.array(processNodeSchema),
  })
  .strict();

const processEventPageSchema = z
  .object({
    items: z.array(processEventSchema),
    nextCursor: z.string().nullable(),
  })
  .strict();

export type ProcessDetail = z.infer<typeof processDetailSchema>;
export type ProcessGraphPageData = z.infer<typeof processGraphPageSchema>;
export type ProcessEventPageData = z.infer<typeof processEventPageSchema>;
export type ProcessFetch = typeof fetch;

export class ProcessClientError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "ProcessClientError";
    this.code = code;
    this.status = status;
  }
}

async function processJson<T>(
  fetcher: ProcessFetch,
  url: string,
  signal: AbortSignal,
  schema: z.ZodType<T>
): Promise<T | null> {
  const response = await fetcher(url, {
    cache: "no-store",
    credentials: "same-origin",
    signal,
  });
  if (response.status === 404) {
    return null;
  }
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as {
      readonly error?: { readonly code?: string; readonly message?: string };
    } | null;
    throw new ProcessClientError(
      response.status,
      body?.error?.code ?? "process_request_failed",
      body?.error?.message ?? "Process details could not be loaded."
    );
  }
  return schema.parse(await response.json());
}

function queryString(
  values: Readonly<Record<string, number | string | undefined>>
): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) {
    if (value !== undefined && value !== "") {
      params.set(key, String(value));
    }
  }
  const query = params.toString();
  return query ? `?${query}` : "";
}

export function createProcessClient(fetcher: ProcessFetch = fetch) {
  return {
    detail(processId: string, signal: AbortSignal) {
      return processJson(
        fetcher,
        `/api/processes/${encodeURIComponent(processId)}`,
        signal,
        processDetailSchema
      );
    },
    events(
      processId: string,
      options: { readonly cursor?: string; readonly limit?: number },
      signal: AbortSignal
    ) {
      return processJson(
        fetcher,
        `/api/processes/${encodeURIComponent(processId)}/events${queryString(options)}`,
        signal,
        processEventPageSchema
      );
    },
    graph(
      processId: string,
      options: {
        readonly cursor?: string;
        readonly kind?: string;
        readonly limit?: number;
        readonly nodeId?: string;
        readonly relation?: string;
      },
      signal: AbortSignal
    ) {
      return processJson(
        fetcher,
        `/api/processes/${encodeURIComponent(processId)}/graph${queryString(options)}`,
        signal,
        processGraphPageSchema
      );
    },
  };
}
