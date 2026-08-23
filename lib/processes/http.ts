import type { Viewer } from "@/lib/chat/types";
import type { EventCursor, GraphCursor } from "@/lib/processes/contracts";
import { decodeEventCursor, decodeGraphCursor } from "@/lib/processes/cursor";
import { ProcessError, processErrorHttpStatus } from "@/lib/processes/errors";
import { createDrizzleProcessRepository } from "@/lib/processes/repository";
import {
  createProcessService,
  type ProcessService,
} from "@/lib/processes/service";
import { getServerViewer } from "@/lib/session";
import { getSetupStatus } from "@/lib/setup";

const MAX_PAGE_SIZE = 50;

export type ProcessReadService = Pick<
  ProcessService,
  "findProcesses" | "inspectGraph" | "readHistory" | "readProcess"
>;

interface ProcessOwnerDependencies {
  readonly getSetupStatus: typeof getSetupStatus;
  readonly getViewer: typeof getServerViewer;
}

interface ProcessReadHandlerDependencies {
  readonly getOwner: () => Promise<Viewer | null>;
  readonly service: ProcessReadService;
}

interface GraphQuery {
  readonly cursor?: GraphCursor;
  readonly kind?: string;
  readonly limit: number;
  readonly nodeId?: string;
  readonly relation?: string;
}

interface EventQuery {
  readonly cursor?: EventCursor;
  readonly limit: number;
}

interface ListQuery {
  readonly cursor?: GraphCursor;
  readonly limit: number;
  readonly query?: string;
}

class ProcessRequestError extends Error {
  readonly code: "authentication_required" | "invalid_process_query";
  readonly status: 400 | 401;

  constructor(
    code: ProcessRequestError["code"],
    message: string,
    status: ProcessRequestError["status"]
  ) {
    super(message);
    this.name = "ProcessRequestError";
    this.code = code;
    this.status = status;
  }
}

const DEFAULT_OWNER_DEPENDENCIES: ProcessOwnerDependencies = {
  getSetupStatus,
  getViewer: getServerViewer,
};

export async function requireProcessOwner(
  dependencies: ProcessOwnerDependencies = DEFAULT_OWNER_DEPENDENCIES
): Promise<Viewer> {
  const setupStatus = await dependencies.getSetupStatus();
  const viewer = await dependencies.getViewer(setupStatus);
  if (!viewer) {
    throw new ProcessRequestError(
      "authentication_required",
      "Authentication is required.",
      401
    );
  }
  if (!setupStatus.processStoreReady) {
    throw new ProcessError(
      "process_store_unavailable",
      "Process memory is temporarily unavailable."
    );
  }
  return viewer;
}

function boundedLimit(searchParams: URLSearchParams): number {
  const raw = searchParams.get("limit");
  if (raw === null) {
    return MAX_PAGE_SIZE;
  }
  if (!/^\d+$/.test(raw)) {
    throw new ProcessRequestError(
      "invalid_process_query",
      "Invalid process query.",
      400
    );
  }
  return Math.max(1, Math.min(Number.parseInt(raw, 10), MAX_PAGE_SIZE));
}

function optionalBoundedText(
  searchParams: URLSearchParams,
  name: string,
  maxLength: number
): string | undefined {
  const value = searchParams.get(name)?.trim();
  if (!value) {
    return undefined;
  }
  if (value.length > maxLength) {
    throw new ProcessRequestError(
      "invalid_process_query",
      "Invalid process query.",
      400
    );
  }
  return value;
}

function graphCursor(searchParams: URLSearchParams): GraphCursor | undefined {
  const cursor = searchParams.get("cursor");
  if (!cursor) {
    return undefined;
  }
  try {
    return decodeGraphCursor(cursor);
  } catch {
    throw new ProcessRequestError(
      "invalid_process_query",
      "Invalid process cursor.",
      400
    );
  }
}

export function parseGraphQuery(url: URL): GraphQuery {
  return {
    cursor: graphCursor(url.searchParams),
    kind: optionalBoundedText(url.searchParams, "kind", 64),
    limit: boundedLimit(url.searchParams),
    nodeId: optionalBoundedText(url.searchParams, "nodeId", 128),
    relation: optionalBoundedText(url.searchParams, "relation", 64),
  };
}

export function parseEventQuery(url: URL): EventQuery {
  const cursor = url.searchParams.get("cursor");
  let decoded: EventCursor | undefined;
  if (cursor) {
    try {
      decoded = decodeEventCursor(cursor);
    } catch {
      throw new ProcessRequestError(
        "invalid_process_query",
        "Invalid process cursor.",
        400
      );
    }
  }
  return { cursor: decoded, limit: boundedLimit(url.searchParams) };
}

function parseListQuery(url: URL): ListQuery {
  return {
    cursor: graphCursor(url.searchParams),
    limit: boundedLimit(url.searchParams),
    query: optionalBoundedText(url.searchParams, "q", 240),
  };
}

export function processErrorResponse(error: unknown): Response {
  if (error instanceof ProcessRequestError) {
    return Response.json(
      { error: { code: error.code, message: error.message } },
      { status: error.status }
    );
  }
  if (error instanceof ProcessError) {
    return Response.json(
      { error: { code: error.code, message: error.message } },
      { status: processErrorHttpStatus(error.code) }
    );
  }
  return Response.json(
    {
      error: {
        code: "process_store_unavailable",
        message: "Process memory is temporarily unavailable.",
      },
    },
    { status: 503 }
  );
}

function notFoundResponse(): Response {
  return Response.json(
    { error: { code: "process_not_found", message: "Process not found." } },
    { status: 404 }
  );
}

export function buildProcessReadHandlers({
  getOwner,
  service,
}: ProcessReadHandlerDependencies) {
  async function owner(): Promise<Viewer> {
    const current = await getOwner();
    if (!current) {
      throw new ProcessRequestError(
        "authentication_required",
        "Authentication is required.",
        401
      );
    }
    return current;
  }

  return {
    async detail(_request: Request, processId: string): Promise<Response> {
      try {
        const current = await owner();
        const snapshot = await service.readProcess({
          ownerId: current.id,
          processId,
        });
        return snapshot
          ? Response.json({
              process: snapshot.process,
              projection: snapshot.projection,
            })
          : notFoundResponse();
      } catch (error) {
        return processErrorResponse(error);
      }
    },

    async events(request: Request, processId: string): Promise<Response> {
      try {
        const current = await owner();
        const page = await service.readHistory({
          ...parseEventQuery(new URL(request.url)),
          ownerId: current.id,
          processId,
        });
        return page ? Response.json(page) : notFoundResponse();
      } catch (error) {
        return processErrorResponse(error);
      }
    },

    async graph(request: Request, processId: string): Promise<Response> {
      try {
        const current = await owner();
        const page = await service.inspectGraph({
          ...parseGraphQuery(new URL(request.url)),
          ownerId: current.id,
          processId,
        });
        return page ? Response.json(page) : notFoundResponse();
      } catch (error) {
        return processErrorResponse(error);
      }
    },

    async list(request: Request): Promise<Response> {
      try {
        const current = await owner();
        const page = await service.findProcesses({
          ...parseListQuery(new URL(request.url)),
          ownerId: current.id,
        });
        return Response.json(page);
      } catch (error) {
        return processErrorResponse(error);
      }
    },
  };
}

const processReadService = createProcessService(
  createDrizzleProcessRepository()
);

export const processReadHandlers = buildProcessReadHandlers({
  getOwner: () => requireProcessOwner(),
  service: processReadService,
});
