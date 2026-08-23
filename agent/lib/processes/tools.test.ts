import type { ToolContext } from "eve/tools";
import { describe, expect, it } from "vitest";
import {
  buildProcessTools,
  type ProcessBinding,
} from "#lib/processes/tools.js";
import type {
  ProcessProjection,
  ProcessSummary,
} from "@/lib/processes/contracts";
import { ProcessError } from "@/lib/processes/errors";
import type {
  ProcessEventPage,
  ProcessGraphPage,
  ProcessListPage,
  ProcessMutationResult,
  ProcessSnapshot,
} from "@/lib/processes/repository";
import type {
  ProcessCommandContext,
  ProcessService,
} from "@/lib/processes/service";

async function finalResult<T>(
  value: AsyncIterable<T> | Promise<T> | T
): Promise<T> {
  const resolved = await value;
  if (
    typeof resolved === "object" &&
    resolved !== null &&
    Symbol.asyncIterator in resolved
  ) {
    let final: T | undefined;
    for await (const item of resolved as AsyncIterable<T>) {
      final = item;
    }
    if (final === undefined) {
      throw new Error("Tool stream completed without a final result");
    }
    return final;
  }
  return resolved as T;
}

function summary(ownerId = "owner-1", id = "process-1"): ProcessSummary {
  return {
    archivedAt: null,
    createdAt: "2026-08-23T08:00:00.000Z",
    graphSchemaVersion: 1,
    id,
    number: 123,
    ownerId,
    projectionSchema: { columns: [], version: 1 },
    status: "in_progress",
    tags: ["launch"],
    title: "Launch test",
    updatedAt: "2026-08-23T08:00:00.000Z",
    version: 1,
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
    projectionVersion: 1,
    sourceProcessVersion: process.version,
    status: process.status,
    summary: null,
    tags: process.tags,
    title: process.title,
  };
}

function mutationResult(process: ProcessSummary): ProcessMutationResult {
  return {
    active: true,
    affectedEdgeIds: [],
    affectedNodeIds: ["root-1"],
    eventId: "event-1",
    mutationKey: "session-1:turn-1:call-1",
    operationSummary: "Created and activated the process.",
    process,
    projection: projection(process),
    version: process.version,
  };
}

class FakeProcessService implements ProcessService {
  private readonly unavailable = new Set<string>();
  readonly processes = new Map<string, ProcessSnapshot>();

  get storeUnavailable(): boolean {
    return this.unavailable.has("process-store");
  }

  set storeUnavailable(value: boolean) {
    if (value) {
      this.unavailable.add("process-store");
    } else {
      this.unavailable.delete("process-store");
    }
  }

  changeState(): Promise<ProcessMutationResult> {
    return Promise.reject(new Error("Not used by read-tool tests"));
  }

  createProcess(input: {
    readonly context: ProcessCommandContext;
    readonly title: string;
  }): Promise<ProcessMutationResult> {
    this.requireStore();
    const process = {
      ...summary(input.context.ownerId),
      title: input.title,
    };
    this.processes.set(process.id, {
      edges: [],
      nodes: [],
      process,
      projection: projection(process),
    });
    return Promise.resolve(mutationResult(process));
  }

  findProcesses(input: { readonly ownerId: string }): Promise<ProcessListPage> {
    this.requireStore();
    return Promise.resolve({
      items: [...this.processes.values()]
        .map((snapshot) => snapshot.process)
        .filter((process) => process.ownerId === input.ownerId),
      nextCursor: null,
    });
  }

  async inspectGraph(input: {
    readonly ownerId: string;
    readonly processId: string;
  }): Promise<ProcessGraphPage | null> {
    const snapshot = await this.readProcess(input);
    return snapshot
      ? { edges: snapshot.edges, nextCursor: null, nodes: snapshot.nodes }
      : null;
  }

  mutateGraph(): Promise<ProcessMutationResult> {
    return Promise.reject(new Error("Not used by read-tool tests"));
  }

  readHistory(): Promise<ProcessEventPage | null> {
    this.requireStore();
    return Promise.resolve({ items: [], nextCursor: null });
  }

  readProcess(input: {
    readonly ownerId: string;
    readonly processId: string;
  }): Promise<ProcessSnapshot | null> {
    this.requireStore();
    const snapshot = this.processes.get(input.processId);
    return Promise.resolve(
      snapshot?.process.ownerId === input.ownerId ? snapshot : null
    );
  }

  rebuildProjection(): Promise<ProcessProjection | null> {
    return Promise.reject(new Error("Not used by read-tool tests"));
  }

  updateTags(): Promise<ProcessMutationResult> {
    return Promise.reject(new Error("Not used by read-tool tests"));
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

function binding(): ProcessBinding & {
  readonly value: {
    processId: string | null;
    projectionVersion: number | null;
  };
} {
  let value = {
    processId: null as string | null,
    projectionVersion: null as number | null,
  };
  return {
    get: () => value,
    update(update) {
      value = update(value);
    },
    get value() {
      return value;
    },
  };
}

function toolContext(ownerId = "owner-1"): ToolContext {
  return {
    abortSignal: new AbortController().signal,
    callId: "call-1",
    getSandbox: () =>
      Promise.reject(new Error("Sandbox is not used by process tools")),
    getSkill: () => {
      throw new Error("Skills are not used by process tools");
    },
    getToken: () =>
      Promise.reject(new Error("Connections are not used by process tools")),
    requireAuth: () => {
      throw new Error("Connections are not used by process tools");
    },
    session: {
      auth: {
        current: {
          attributes: {},
          authenticator: "test",
          principalId: ownerId,
          principalType: "user",
        },
        initiator: null,
      },
      id: "session-1",
      turn: { id: "turn-1", sequence: 0 },
    },
    toolName: "create_process",
  } as ToolContext;
}

describe("process read and binding tools", () => {
  it("derives process ownership from the current Eve principal", async () => {
    const service = new FakeProcessService();
    const state = binding();
    const tools = buildProcessTools({ binding: state, service });

    const result = await finalResult(
      tools.createProcess.execute(
        {
          initialOperations: [],
          reason: "We agreed to start.",
          tags: [],
          title: "Owned launch",
        },
        toolContext("verified-owner")
      )
    );

    expect(result.process?.ownerId).toBe("verified-owner");
  });

  it("creates and activates a process in the current session binding", async () => {
    const service = new FakeProcessService();
    const state = binding();
    const tools = buildProcessTools({ binding: state, service });

    const result = await finalResult(
      tools.createProcess.execute(
        {
          initialOperations: [],
          reason: "We agreed to start.",
          tags: [],
          title: "Launch test",
        },
        toolContext()
      )
    );

    expect(state.value).toEqual({
      processId: result.process?.id,
      projectionVersion: result.projection?.projectionVersion,
    });
  });

  it("verifies owner visibility before activating a process", async () => {
    const service = new FakeProcessService();
    const otherProcess = summary("owner-2");
    service.processes.set(otherProcess.id, {
      edges: [],
      nodes: [],
      process: otherProcess,
      projection: projection(otherProcess),
    });
    const state = binding();
    const tools = buildProcessTools({ binding: state, service });

    await expect(
      finalResult(
        tools.activateProcess.execute(
          { processId: otherProcess.id },
          toolContext("owner-1")
        )
      )
    ).rejects.toMatchObject({ code: "process_not_found" });
    expect(state.value.processId).toBeNull();
  });

  it("deactivates only the session binding without changing the process", async () => {
    const service = new FakeProcessService();
    const process = summary();
    service.processes.set(process.id, {
      edges: [],
      nodes: [],
      process,
      projection: projection(process),
    });
    const state = binding();
    state.update(() => ({ processId: process.id, projectionVersion: 1 }));
    const tools = buildProcessTools({ binding: state, service });

    const result = await finalResult(
      tools.deactivateProcess.execute({}, toolContext())
    );

    expect(result.active).toBe(false);
    expect(state.value.processId).toBeNull();
    expect(service.processes.get(process.id)?.process.status).toBe(
      "in_progress"
    );
  });

  it("defaults every read tool to the active process", async () => {
    const service = new FakeProcessService();
    const process = summary();
    service.processes.set(process.id, {
      edges: [],
      nodes: [],
      process,
      projection: projection(process),
    });
    const state = binding();
    state.update(() => ({ processId: process.id, projectionVersion: 1 }));
    const tools = buildProcessTools({ binding: state, service });

    const read = await finalResult(
      tools.readProcess.execute({}, toolContext())
    );
    const graph = await finalResult(
      tools.inspectProcessGraph.execute({ limit: 50 }, toolContext())
    );
    const history = await finalResult(
      tools.readProcessHistory.execute({ limit: 50 }, toolContext())
    );

    expect(read.process?.id).toBe(process.id);
    expect(graph.processId).toBe(process.id);
    expect(history.processId).toBe(process.id);
  });

  it("returns a safe unavailable-store error", async () => {
    const service = new FakeProcessService();
    service.storeUnavailable = true;
    const tools = buildProcessTools({ binding: binding(), service });

    await expect(
      finalResult(tools.findProcesses.execute({ limit: 20 }, toolContext()))
    ).rejects.toMatchObject({
      code: "process_store_unavailable",
      message: "Process memory is temporarily unavailable.",
    });
  });

  it("sends compact text to the model while retaining the structured result", async () => {
    const service = new FakeProcessService();
    const tools = buildProcessTools({ binding: binding(), service });
    const result = await finalResult(
      tools.createProcess.execute(
        {
          initialOperations: [],
          reason: "We agreed to start.",
          tags: [],
          title: "Launch test",
        },
        toolContext()
      )
    );

    expect(await tools.createProcess.toModelOutput?.(result)).toEqual({
      type: "text",
      value: "Process PROC-000123 is Em andamento at version 1.",
    });
    expect(result.projection?.metrics.liveNodes).toBe(1);
  });
});
