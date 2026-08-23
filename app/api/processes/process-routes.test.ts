import { describe, expect, it } from "vitest";
import type { SetupStatus, Viewer } from "@/lib/chat/types";
import type { ProcessSummary } from "@/lib/processes/contracts";
import { encodeEventCursor, encodeGraphCursor } from "@/lib/processes/cursor";
import { ProcessError } from "@/lib/processes/errors";
import {
  buildProcessReadHandlers,
  type ProcessReadService,
  requireProcessOwner,
} from "@/lib/processes/http";
import type {
  ProcessEventPage,
  ProcessGraphPage,
  ProcessListPage,
  ProcessSnapshot,
} from "@/lib/processes/repository";

const viewer: Viewer = {
  email: "operator@example.com",
  id: "owner-1",
  image: null,
  name: "Operator",
};

function setupStatus(
  authMode: SetupStatus["authMode"],
  processStoreReady = true
): SetupStatus {
  return {
    appReady: true,
    authMode,
    authReady: true,
    connectionsAvailable: true,
    databaseConfigured: true,
    databaseReady: authMode === "vercel",
    databaseSchemaReady: authMode === "vercel",
    missing: [],
    processStoreReady,
    rateLimitReady: true,
    storageMode: authMode === "vercel" ? "database" : "browser",
  };
}

function processSummary(ownerId = viewer.id): ProcessSummary {
  return {
    archivedAt: null,
    createdAt: "2026-08-23T08:00:00.000Z",
    graphSchemaVersion: 1,
    id: "process-1",
    number: 123,
    ownerId,
    projectionSchema: { columns: [], version: 1 },
    status: "in_progress",
    tags: [],
    title: "Launch",
    updatedAt: "2026-08-23T08:00:00.000Z",
    version: 1,
  };
}

class FakeReadService implements ProcessReadService {
  graphInput: Parameters<ProcessReadService["inspectGraph"]>[0] | null = null;
  historyInput: Parameters<ProcessReadService["readHistory"]>[0] | null = null;
  process = processSummary();
  storeUnavailable = false;

  findProcesses(): Promise<ProcessListPage> {
    this.requireStore();
    return Promise.resolve({ items: [this.process], nextCursor: null });
  }

  inspectGraph(
    input: Parameters<ProcessReadService["inspectGraph"]>[0]
  ): Promise<ProcessGraphPage | null> {
    this.requireStore();
    this.graphInput = input;
    return Promise.resolve(
      input.ownerId === this.process.ownerId
        ? { edges: [], nextCursor: null, nodes: [] }
        : null
    );
  }

  readHistory(
    input: Parameters<ProcessReadService["readHistory"]>[0]
  ): Promise<ProcessEventPage | null> {
    this.requireStore();
    this.historyInput = input;
    return Promise.resolve(
      input.ownerId === this.process.ownerId
        ? { items: [], nextCursor: null }
        : null
    );
  }

  readProcess(input: {
    readonly ownerId: string;
    readonly processId: string;
  }): Promise<ProcessSnapshot | null> {
    this.requireStore();
    return Promise.resolve(
      input.ownerId === this.process.ownerId &&
        input.processId === this.process.id
        ? {
            edges: [],
            nodes: [],
            process: this.process,
            projection: {
              blockers: [],
              columns: [],
              generatedAt: this.process.updatedAt,
              metrics: {
                liveEdges: 0,
                liveMetadataFields: 0,
                liveNodes: 0,
              },
              nextAction: null,
              pendingItems: [],
              processId: this.process.id,
              processNumber: this.process.number,
              projectionVersion: 1,
              sourceProcessVersion: this.process.version,
              status: this.process.status,
              summary: null,
              tags: [],
              title: this.process.title,
            },
          }
        : null
    );
  }

  private requireStore() {
    if (this.storeUnavailable) {
      throw new ProcessError(
        "process_store_unavailable",
        "Process memory is temporarily unavailable."
      );
    }
  }
}

function handlers(
  service = new FakeReadService(),
  activeViewer: Viewer | null = viewer
) {
  return {
    handlers: buildProcessReadHandlers({
      getOwner: () => Promise.resolve(activeViewer),
      service,
    }),
    service,
  };
}

describe("authenticated process read routes", () => {
  it("returns 401 for an unauthenticated request", async () => {
    const { handlers: routes } = handlers(new FakeReadService(), null);

    const response = await routes.list(
      new Request("https://example.test/api/processes")
    );

    expect(response.status).toBe(401);
  });

  it.each([
    ["password", "marketing-room-user"],
    ["vercel", "vercel-user-42"],
  ] as const)("resolves the existing %s viewer id", async (authMode, id) => {
    const status = setupStatus(authMode);

    const owner = await requireProcessOwner({
      getSetupStatus: () => Promise.resolve(status),
      getViewer: (received) => {
        expect(received).toBe(status);
        return Promise.resolve({ ...viewer, id });
      },
    });

    expect(owner.id).toBe(id);
  });

  it("returns 404 instead of revealing another owner's process", async () => {
    const service = new FakeReadService();
    service.process = processSummary("owner-2");
    const { handlers: routes } = handlers(service);

    const response = await routes.detail(
      new Request("https://example.test/api/processes/process-1"),
      "process-1"
    );

    expect(response.status).toBe(404);
  });

  it("returns a safe 503 when the process schema is unavailable", async () => {
    const service = new FakeReadService();
    service.storeUnavailable = true;
    const { handlers: routes } = handlers(service);

    const response = await routes.list(
      new Request("https://example.test/api/processes")
    );

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "process_store_unavailable",
        message: "Process memory is temporarily unavailable.",
      },
    });
  });

  it("caps graph and event limits at 50 and decodes opaque cursors", async () => {
    const { handlers: routes, service } = handlers();
    const graphCursor = encodeGraphCursor({
      id: "node-9",
      updatedAt: "2026-08-23T08:00:00.000Z",
    });
    const eventCursor = encodeEventCursor({ eventId: "event-9", sequence: 9 });

    await routes.graph(
      new Request(
        `https://example.test/api/processes/process-1/graph?limit=999&cursor=${graphCursor}`
      ),
      "process-1"
    );
    await routes.events(
      new Request(
        `https://example.test/api/processes/process-1/events?limit=999&cursor=${eventCursor}`
      ),
      "process-1"
    );

    expect(service.graphInput).toMatchObject({
      cursor: { id: "node-9", updatedAt: "2026-08-23T08:00:00.000Z" },
      limit: 50,
    });
    expect(service.historyInput).toMatchObject({
      cursor: { eventId: "event-9", sequence: 9 },
      limit: 50,
    });
  });

  it("returns 400 for malformed cursors", async () => {
    const { handlers: routes } = handlers();

    const response = await routes.graph(
      new Request(
        "https://example.test/api/processes/process-1/graph?cursor=not-a-cursor"
      ),
      "process-1"
    );

    expect(response.status).toBe(400);
  });

  it("exports GET handlers only", async () => {
    const modules = await Promise.all([
      import("./route.js"),
      import("./[id]/route.js"),
      import("./[id]/graph/route.js"),
      import("./[id]/events/route.js"),
    ]);

    for (const route of modules) {
      expect(route.GET).toBeTypeOf("function");
      expect(Object.keys(route)).not.toEqual(
        expect.arrayContaining(["POST", "PUT", "PATCH", "DELETE"])
      );
    }
  });
});
