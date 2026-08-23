import { describe, expect, it } from "vitest";
import type {
  ProcessProjection,
  ProcessSummary,
} from "@/lib/processes/contracts";
import type {
  ProcessEventPage,
  ProcessGraphPage,
} from "@/lib/processes/repository";
import {
  createProcessDetailMachine,
  type ProcessDetailFetcher,
} from "@/lib/processes/use-process-detail";

function processSummary(version: number): ProcessSummary {
  return {
    archivedAt: null,
    createdAt: "2026-08-23T08:00:00.000Z",
    graphSchemaVersion: 1,
    id: "process-1",
    number: 123,
    ownerId: "owner-1",
    projectionSchema: { columns: [], version: 1 },
    status: "in_progress",
    tags: [],
    title: "Launch",
    updatedAt: `2026-08-23T08:0${version}:00.000Z`,
    version,
  };
}

function projection(process: ProcessSummary): ProcessProjection {
  return {
    blockers: [],
    columns: [],
    generatedAt: process.updatedAt,
    metrics: { liveEdges: 0, liveMetadataFields: 0, liveNodes: 1 },
    nextAction: null,
    pendingItems: [],
    processId: process.id,
    processNumber: process.number,
    projectionVersion: process.version,
    sourceProcessVersion: process.version,
    status: process.status,
    summary: null,
    tags: [],
    title: process.title,
  };
}

function fetcher(
  overrides: Partial<ProcessDetailFetcher> = {}
): ProcessDetailFetcher {
  return {
    detail: (processId) => {
      const process = processSummary(2);
      return Promise.resolve({
        process: { ...process, id: processId },
        projection: projection(process),
      });
    },
    events: () =>
      Promise.resolve({
        items: [],
        nextCursor: null,
      } satisfies ProcessEventPage),
    graph: () =>
      Promise.resolve({
        edges: [],
        nextCursor: null,
        nodes: [],
      } satisfies ProcessGraphPage),
    ...overrides,
  };
}

describe("process detail fetch state machine", () => {
  it("fetches the latest summary before the selected section", async () => {
    const order: string[] = [];
    const machine = createProcessDetailMachine(
      fetcher({
        detail: async (processId, signal) => {
          order.push(`detail:${processId}:${signal.aborted}`);
          const process = processSummary(2);
          return { process, projection: projection(process) };
        },
        graph: async () => {
          order.push("graph");
          return { edges: [], nextCursor: null, nodes: [] };
        },
      })
    );

    await machine.load({
      processId: "process-1",
      section: "graph",
      streamProcess: processSummary(1),
      streamProjection: projection(processSummary(1)),
    });

    expect(order).toEqual(["detail:process-1:false", "graph"]);
  });

  it.each([
    ["summary", 0, 0],
    ["graph", 1, 0],
    ["log", 0, 1],
  ] as const)(
    "requests only the %s section payload",
    async (section, graphCalls, eventCalls) => {
      let graph = 0;
      let events = 0;
      const machine = createProcessDetailMachine(
        fetcher({
          events: () => {
            events += 1;
            return Promise.resolve({ items: [], nextCursor: null });
          },
          graph: () => {
            graph += 1;
            return Promise.resolve({ edges: [], nextCursor: null, nodes: [] });
          },
        })
      );

      await machine.load({ processId: "process-1", section });

      expect(graph).toBe(graphCalls);
      expect(events).toBe(eventCalls);
    }
  );

  it("aborts in-flight requests when the process id changes", async () => {
    const signals: AbortSignal[] = [];
    let release: (() => void) | undefined;
    const machine = createProcessDetailMachine(
      fetcher({
        detail: (processId, signal) => {
          signals.push(signal);
          if (processId === "process-2") {
            const process = { ...processSummary(2), id: processId };
            return Promise.resolve({
              process,
              projection: projection(process),
            });
          }
          return new Promise((resolve) => {
            release = () => {
              const process = processSummary(1);
              resolve({ process, projection: projection(process) });
            };
          });
        },
      })
    );

    const first = machine.load({ processId: "process-1", section: "summary" });
    await machine.load({ processId: "process-2", section: "summary" });
    release?.();
    await first;

    expect(signals[0]?.aborted).toBe(true);
    expect(machine.getState().process?.id).toBe("process-2");
  });

  it("preserves the stream projection until fresher server data arrives", async () => {
    const streamProcess = processSummary(3);
    const serverProcess = processSummary(2);
    const machine = createProcessDetailMachine(
      fetcher({
        detail: () =>
          Promise.resolve({
            process: serverProcess,
            projection: projection(serverProcess),
          }),
      })
    );

    const loading = machine.load({
      processId: streamProcess.id,
      section: "summary",
      streamProcess,
      streamProjection: projection(streamProcess),
    });

    expect(machine.getState().process?.version).toBe(3);
    await loading;
    expect(machine.getState().process?.version).toBe(3);
  });

  it("reports a stale process without clearing the stream binding", async () => {
    const streamProcess = processSummary(1);
    const machine = createProcessDetailMachine(
      fetcher({
        detail: () => Promise.resolve(null),
      })
    );

    await machine.load({
      processId: streamProcess.id,
      section: "summary",
      streamProcess,
      streamProjection: projection(streamProcess),
    });

    expect(machine.getState()).toMatchObject({
      isStale: true,
      process: { id: streamProcess.id },
    });
  });
});
