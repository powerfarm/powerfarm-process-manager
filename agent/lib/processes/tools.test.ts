import type { ToolContext } from "eve/tools";
import { describe, expect, it, vi } from "vitest";
import type { z } from "zod";
import {
  buildProcessTools,
  type ProcessBinding,
} from "#lib/processes/tools.js";
import type {
  ProcessProjection,
  ProcessSummary,
} from "@/lib/processes/contracts";
import { ProcessError } from "@/lib/processes/errors";
import type { GovernedArtifactSnapshot } from "@/lib/processes/governed-artifacts";
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
    projectionVersion: process.version,
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
  private readonly mutationReplays = new Map<string, ProcessMutationResult>();
  readonly processes = new Map<string, ProcessSnapshot>();
  lastChangeStateInput: Parameters<ProcessService["changeState"]>[0] | null =
    null;
  lastMutateGraphInput: Parameters<ProcessService["mutateGraph"]>[0] | null =
    null;
  lastObserveArtifactInput:
    | Parameters<ProcessService["observeArtifact"]>[0]
    | null = null;
  lastUpdateTagsInput: Parameters<ProcessService["updateTags"]>[0] | null =
    null;

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

  changeState(
    input: Parameters<ProcessService["changeState"]>[0]
  ): Promise<ProcessMutationResult> {
    this.lastChangeStateInput = input;
    return this.commit(input, (process) => ({
      ...process,
      status: input.status,
    }));
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

  mutateGraph(
    input: Parameters<ProcessService["mutateGraph"]>[0]
  ): Promise<ProcessMutationResult> {
    this.lastMutateGraphInput = input;
    return this.commit(input, (process) => process);
  }

  observeArtifact(
    input: Parameters<ProcessService["observeArtifact"]>[0]
  ): Promise<ProcessMutationResult> {
    this.lastObserveArtifactInput = input;
    return this.commit(input, (process) => process);
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

  updateTags(
    input: Parameters<ProcessService["updateTags"]>[0]
  ): Promise<ProcessMutationResult> {
    this.lastUpdateTagsInput = input;
    return this.commit(input, (process) => ({
      ...process,
      tags: [
        ...new Set(
          process.tags
            .filter((tag) => !input.remove.includes(tag))
            .concat(input.add)
        ),
      ].toSorted(),
    }));
  }

  private commit(
    input: {
      readonly context: ProcessCommandContext;
      readonly expectedVersion: number;
      readonly processId: string;
    },
    update: (process: ProcessSummary) => ProcessSummary
  ): Promise<ProcessMutationResult> {
    this.requireStore();
    const replayKey = `${input.context.eveSessionId}:${input.context.turnId}:${input.context.callId}`;
    const replay = this.mutationReplays.get(replayKey);
    if (replay) {
      return Promise.resolve(replay);
    }
    const snapshot = this.processes.get(input.processId);
    if (!snapshot || snapshot.process.ownerId !== input.context.ownerId) {
      return Promise.reject(
        new ProcessError("process_not_found", "Process not found.")
      );
    }
    if (snapshot.process.version !== input.expectedVersion) {
      return Promise.reject(
        new ProcessError("version_conflict", "Process version changed.")
      );
    }
    const process = update({
      ...snapshot.process,
      updatedAt: "2026-08-23T08:01:00.000Z",
      version: snapshot.process.version + 1,
    });
    const result: ProcessMutationResult = {
      ...mutationResult(process),
      eventId: `event-${process.version}`,
      mutationKey: replayKey,
      operationSummary: "Committed process mutation.",
    };
    this.processes.set(process.id, {
      ...snapshot,
      process,
      projection: result.projection,
    });
    this.mutationReplays.set(replayKey, result);
    return Promise.resolve(result);
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

  it("gives the model the internal id required to activate a found process", async () => {
    const service = new FakeProcessService();
    const process = summary();
    service.processes.set(process.id, {
      edges: [],
      nodes: [],
      process,
      projection: projection(process),
    });
    const tools = buildProcessTools({ binding: binding(), service });

    const result = await finalResult(
      tools.findProcesses.execute({ limit: 20 }, toolContext())
    );

    expect(await tools.findProcesses.toModelOutput?.(result)).toEqual({
      type: "text",
      value:
        "PROC-000123 | processId=process-1 | Launch test (Em andamento, version 1)",
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

describe("process mutation tools", () => {
  function activeHarness() {
    const service = new FakeProcessService();
    const process = summary();
    service.processes.set(process.id, {
      edges: [],
      nodes: [],
      process,
      projection: projection(process),
    });
    const state = binding();
    state.update(() => ({
      processId: process.id,
      projectionVersion: process.version,
    }));
    return {
      process,
      service,
      state,
      tools: buildProcessTools({ binding: state, service }),
    };
  }

  it("forwards ctx.callId and the expected process version", async () => {
    const harness = activeHarness();

    await finalResult(
      harness.tools.mutateProcessGraph.execute(
        {
          expectedVersion: 1,
          operations: [
            {
              kind: "task",
              label: "Ship the panel",
              metadata: {},
              nodeId: "node-1",
              op: "add_node",
            },
          ],
          reason: "We agreed to add this task.",
        },
        toolContext()
      )
    );

    expect(harness.service.lastMutateGraphInput).toMatchObject({
      context: { callId: "call-1", ownerId: "owner-1" },
      expectedVersion: 1,
      processId: harness.process.id,
    });
  });

  it("rejects arbitrary patch paths and untyped operations at schema parsing", () => {
    const { tools } = activeHarness();
    const schema = tools.mutateProcessGraph.inputSchema as z.ZodType;

    expect(() =>
      schema.parse({
        expectedVersion: 1,
        operations: [{ op: "replace", path: "/ownerId", value: "other" }],
        ownerId: "other",
        reason: "Unauthorized patch.",
      })
    ).toThrow();
  });

  it("requires an explicit agreed durable state", () => {
    const { tools } = activeHarness();
    const schema = tools.changeProcessState.inputSchema as z.ZodType;

    expect(() =>
      schema.parse({ expectedVersion: 1, status: "processing" })
    ).toThrow();
    expect(() =>
      schema.parse({ expectedVersion: 1, status: "completed" })
    ).toThrow();
  });

  it("supports add and remove tag sets without replacing unrelated tags", async () => {
    const harness = activeHarness();

    const result = await finalResult(
      harness.tools.updateProcessTags.execute(
        {
          add: ["priority"],
          expectedVersion: 1,
          reason: "We agreed to change the tags.",
          remove: ["launch"],
        },
        toolContext()
      )
    );

    expect(result.process?.tags).toEqual(["priority"]);
    expect(harness.service.lastUpdateTagsInput).toMatchObject({
      add: ["priority"],
      remove: ["launch"],
    });
  });

  it("updates the session projection version after a committed mutation", async () => {
    const harness = activeHarness();

    await finalResult(
      harness.tools.changeProcessState.execute(
        {
          expectedVersion: 1,
          reason: "We agreed that work is blocked.",
          status: "blocked",
        },
        toolContext()
      )
    );

    expect(harness.state.value).toEqual({
      processId: harness.process.id,
      projectionVersion: 2,
    });
  });

  it("records only the GitHub observation returned by the server-side observer", async () => {
    const service = new FakeProcessService();
    const process = summary();
    service.processes.set(process.id, {
      edges: [],
      nodes: [],
      process,
      projection: projection(process),
    });
    const state = binding();
    state.update(() => ({
      processId: process.id,
      projectionVersion: process.version,
    }));
    const artifact: GovernedArtifactSnapshot = {
      blobSha: "b".repeat(40),
      checksState: "passing",
      checksSuccessful: 1,
      checksTotal: 1,
      contentSha256: "c".repeat(64),
      observedCommit: "a".repeat(40),
      path: "target/future-body-narrative.md",
      provider: "github",
      pullRequestNumber: null,
      pullRequestState: null,
      pullRequestUrl: null,
      repository: "powerfarm/planning",
      requestedRef: "main",
      reviewsApproved: 0,
      reviewsChangesRequested: 0,
      url: "https://github.com/powerfarm/planning/blob/main/target/future-body-narrative.md",
    };
    const observer = {
      observe: vi.fn(async () => artifact),
    };
    const tools = buildProcessTools({
      artifactObserver: observer,
      binding: state,
      service,
    });

    await finalResult(
      tools.observeProcessArtifact.execute(
        {
          expectedVersion: 1,
          nodeId: "source-target-body",
          path: artifact.path,
          reason: "Observe the governed planning source.",
          repository: artifact.repository,
          requestedRef: "main",
        },
        { ...toolContext(), toolName: "observe_process_artifact" }
      )
    );

    expect(observer.observe).toHaveBeenCalledWith({
      path: artifact.path,
      repository: artifact.repository,
      requestedRef: "main",
    });
    expect(service.lastObserveArtifactInput).toMatchObject({
      artifact: {
        contentSha256: "c".repeat(64),
        observedCommit: "a".repeat(40),
      },
      context: {
        ownerId: "owner-1",
        toolName: "observe_process_artifact",
      },
      nodeId: "source-target-body",
    });
  });

  it("returns the same structured result for an idempotent replay", async () => {
    const harness = activeHarness();
    const input = {
      expectedVersion: 1,
      reason: "We agreed that work is waiting.",
      status: "waiting" as const,
    };

    const first = await finalResult(
      harness.tools.changeProcessState.execute(input, toolContext())
    );
    const replay = await finalResult(
      harness.tools.changeProcessState.execute(input, toolContext())
    );

    expect(replay).toEqual(first);
    expect(replay.version).toBe(2);
  });
});
