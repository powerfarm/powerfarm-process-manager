import { describe, expect, it } from "vitest";
import type { ProcessEvent, ProcessSummary } from "@/lib/processes/contracts";
import type {
  CreateRepositoryProcessInput,
  ProcessListPage,
  ProcessMutationDraft,
  ProcessMutationResult,
  ProcessRepository,
  ProcessSnapshot,
  RepositoryMutationInput,
} from "@/lib/processes/repository";
import {
  createProcessService,
  type ProcessCommandContext,
} from "@/lib/processes/service";

const ownerOne = "owner-1";

function context(
  overrides: Partial<ProcessCommandContext> = {}
): ProcessCommandContext {
  return {
    callId: "call-1",
    eveSessionId: "session-1",
    ownerId: ownerOne,
    toolName: "create_process",
    turnId: "turn-1",
    turnSequence: 1,
    ...overrides,
  };
}

class InMemoryProcessRepository implements ProcessRepository {
  readonly events: ProcessEvent[] = [];
  readonly snapshots = new Map<string, ProcessSnapshot>();
  private readonly mutationResults = new Map<string, ProcessMutationResult>();
  private readonly creationResults = new Map<string, ProcessMutationResult>();
  private nextNumber = 1;

  async createProcess(
    input: CreateRepositoryProcessInput,
    initialize: (process: ProcessSummary) => ProcessMutationDraft
  ): Promise<ProcessMutationResult> {
    const creationKey = `${input.context.ownerId}:${input.context.eveSessionId}:${input.context.turnId}`;
    const existingCreation = this.creationResults.get(creationKey);
    if (existingCreation) {
      return existingCreation;
    }

    const process: ProcessSummary = {
      archivedAt: null,
      createdAt: input.now,
      graphSchemaVersion: 1,
      id: input.processId,
      number: this.nextNumber,
      ownerId: input.context.ownerId,
      projectionSchema: { columns: [], version: 1 },
      status: "in_progress",
      tags: [],
      title: input.title,
      updatedAt: input.now,
      version: 1,
    };
    this.nextNumber += 1;

    const draft = initialize(process);
    this.commitDraft(draft);
    this.creationResults.set(creationKey, draft.result);
    this.mutationResults.set(input.mutationKey, draft.result);
    return draft.result;
  }

  async findProcesses(input: {
    readonly limit: number;
    readonly ownerId: string;
    readonly query?: string;
  }): Promise<ProcessListPage> {
    const query = input.query?.toLowerCase();
    const items = [...this.snapshots.values()]
      .map((snapshot) => snapshot.process)
      .filter(
        (process) =>
          process.ownerId === input.ownerId &&
          (!query ||
            process.title.toLowerCase().includes(query) ||
            process.number.toString() === query.replace(/^proc-0*/, ""))
      )
      .slice(0, input.limit);
    return { items, nextCursor: null };
  }

  async inspectGraph(input: {
    readonly ownerId: string;
    readonly processId: string;
  }) {
    const snapshot = await this.readSnapshot(input);
    return snapshot
      ? { edges: snapshot.edges, nextCursor: null, nodes: snapshot.nodes }
      : null;
  }

  async mutateProcess(
    input: RepositoryMutationInput,
    mutate: (snapshot: ProcessSnapshot) => ProcessMutationDraft
  ): Promise<ProcessMutationResult> {
    const replay = this.mutationResults.get(input.mutationKey);
    if (replay) {
      return replay;
    }
    const snapshot = await this.readSnapshot(input);
    if (!snapshot) {
      throw Object.assign(new Error("Process not found"), {
        code: "process_not_found",
      });
    }
    if (snapshot.process.version !== input.expectedVersion) {
      throw Object.assign(new Error("Version conflict"), {
        code: "version_conflict",
        currentVersion: snapshot.process.version,
        projection: snapshot.projection,
      });
    }

    const draft = mutate(structuredClone(snapshot));
    this.commitDraft(draft);
    this.mutationResults.set(input.mutationKey, draft.result);
    return draft.result;
  }

  async readEvents(input: {
    readonly limit: number;
    readonly ownerId: string;
    readonly processId: string;
  }) {
    const visible = await this.readSnapshot(input);
    if (!visible) {
      return null;
    }
    return {
      items: this.events
        .filter((event) => event.processId === input.processId)
        .toSorted((left, right) => right.sequence - left.sequence)
        .slice(0, input.limit),
      nextCursor: null,
    };
  }

  async readSnapshot(input: {
    readonly ownerId: string;
    readonly processId: string;
  }): Promise<ProcessSnapshot | null> {
    const snapshot = this.snapshots.get(input.processId);
    if (!snapshot || snapshot.process.ownerId !== input.ownerId) {
      return null;
    }
    return structuredClone(snapshot);
  }

  private commitDraft(draft: ProcessMutationDraft) {
    this.snapshots.set(
      draft.snapshot.process.id,
      structuredClone(draft.snapshot)
    );
    this.events.push(structuredClone(draft.event));
  }
}

function createHarness() {
  const repository = new InMemoryProcessRepository();
  let id = 0;
  let timestamp = 0;
  const service = createProcessService(repository, {
    createId: () => {
      id += 1;
      return `generated-${id}`;
    },
    now: () => {
      timestamp += 1;
      return `2026-08-23T08:00:${timestamp.toString().padStart(2, "0")}.000Z`;
    },
  });
  return { repository, service };
}

async function createLaunchProcess(
  harness: ReturnType<typeof createHarness>,
  commandContext = context()
) {
  return harness.service.createProcess({
    context: commandContext,
    initialOperations: [],
    reason: "We agreed to start the launch process.",
    tags: ["launch"],
    title: "Launch test",
  });
}

describe("ProcessService", () => {
  it("returns one process for a replayed create in the same owner, session, and turn", async () => {
    const harness = createHarness();

    const first = await createLaunchProcess(harness);
    const replay = await createLaunchProcess(
      harness,
      context({ callId: "call-2" })
    );

    expect(replay.process.id).toBe(first.process.id);
    expect(harness.repository.snapshots.size).toBe(1);
    expect(harness.repository.events).toHaveLength(1);
  });

  it("allows two different turns to create two processes", async () => {
    const harness = createHarness();

    const first = await createLaunchProcess(harness);
    const second = await createLaunchProcess(
      harness,
      context({ callId: "call-2", turnId: "turn-2", turnSequence: 2 })
    );

    expect(second.process.id).not.toBe(first.process.id);
    expect(second.process.number).toBe(2);
  });

  it("keeps the server-created graph root when initial operations are supplied", async () => {
    const harness = createHarness();

    const created = await harness.service.createProcess({
      context: context(),
      initialOperations: [
        {
          kind: "brief",
          label: "Initial brief",
          metadata: {},
          nodeId: "brief-1",
          op: "add_node",
        },
      ],
      reason: "Start with an initial brief.",
      title: "Launch test",
    });
    const snapshot = await harness.service.readProcess({
      ownerId: ownerOne,
      processId: created.process.id,
    });

    expect(snapshot?.nodes.map((node) => node.kind).toSorted()).toEqual([
      "brief",
      "process_root",
    ]);
  });

  it("rejects a stale expected version without appending an event", async () => {
    const harness = createHarness();
    const created = await createLaunchProcess(harness);

    await expect(
      harness.service.mutateGraph({
        context: context({
          callId: "call-2",
          toolName: "mutate_process_graph",
        }),
        expectedVersion: 0,
        operations: [
          {
            kind: "brief",
            label: "Brief",
            metadata: {},
            nodeId: "brief-1",
            op: "add_node",
          },
        ],
        processId: created.process.id,
        reason: "Add the brief.",
      })
    ).rejects.toMatchObject({ code: "version_conflict", currentVersion: 1 });
    expect(harness.repository.events).toHaveLength(1);
  });

  it("returns the committed result when a mutation key is replayed", async () => {
    const harness = createHarness();
    const created = await createLaunchProcess(harness);
    const command = {
      context: context({ callId: "call-2", toolName: "mutate_process_graph" }),
      expectedVersion: 1,
      operations: [
        {
          kind: "brief",
          label: "Brief",
          metadata: {},
          nodeId: "brief-1",
          op: "add_node" as const,
        },
      ],
      processId: created.process.id,
      reason: "Add the brief.",
    };

    const first = await harness.service.mutateGraph(command);
    const replay = await harness.service.mutateGraph(command);

    expect(replay).toEqual(first);
    expect(harness.repository.events).toHaveLength(2);
  });

  it("applies a typed graph batch atomically and increments the process once", async () => {
    const harness = createHarness();
    const created = await createLaunchProcess(harness);

    const result = await harness.service.mutateGraph({
      context: context({ callId: "call-2", toolName: "mutate_process_graph" }),
      expectedVersion: 1,
      operations: [
        {
          kind: "brief",
          label: "Brief",
          metadata: { audience: "Operators" },
          nodeId: "brief-1",
          op: "add_node",
        },
        {
          edgeId: "edge-1",
          metadata: {},
          op: "link_nodes",
          relation: "details",
          sourceNodeId: "brief-1",
          targetNodeId: created.affectedNodeIds[0] ?? "",
        },
      ],
      processId: created.process.id,
      reason: "Add the launch brief.",
    });

    expect(result.version).toBe(2);
    expect(result.affectedNodeIds).toContain("brief-1");
    expect(result.affectedEdgeIds).toEqual(["edge-1"]);
    expect(harness.repository.events).toHaveLength(2);
  });

  it("tombstones a node and its incident live edges without erasing them", async () => {
    const harness = createHarness();
    const created = await createLaunchProcess(harness);
    const rootId = created.affectedNodeIds[0] ?? "";
    await harness.service.mutateGraph({
      context: context({ callId: "call-2", toolName: "mutate_process_graph" }),
      expectedVersion: 1,
      operations: [
        {
          kind: "brief",
          label: "Brief",
          metadata: {},
          nodeId: "brief-1",
          op: "add_node",
        },
        {
          edgeId: "edge-1",
          metadata: {},
          op: "link_nodes",
          relation: "details",
          sourceNodeId: rootId,
          targetNodeId: "brief-1",
        },
      ],
      processId: created.process.id,
      reason: "Add the brief.",
    });

    await harness.service.mutateGraph({
      context: context({ callId: "call-3", toolName: "mutate_process_graph" }),
      expectedVersion: 2,
      operations: [{ nodeId: "brief-1", op: "tombstone_node" }],
      processId: created.process.id,
      reason: "Retire the brief.",
    });
    const snapshot = await harness.service.readProcess({
      ownerId: ownerOne,
      processId: created.process.id,
    });

    expect(
      snapshot?.nodes.find((node) => node.id === "brief-1")?.tombstonedAt
    ).not.toBeNull();
    expect(
      snapshot?.edges.find((edge) => edge.id === "edge-1")?.tombstonedAt
    ).not.toBeNull();
  });

  it("rejects an edge whose endpoint does not exist in the process", async () => {
    const harness = createHarness();
    const created = await createLaunchProcess(harness);

    await expect(
      harness.service.mutateGraph({
        context: context({
          callId: "call-2",
          toolName: "mutate_process_graph",
        }),
        expectedVersion: 1,
        operations: [
          {
            edgeId: "edge-1",
            metadata: {},
            op: "link_nodes",
            relation: "details",
            sourceNodeId: created.affectedNodeIds[0] ?? "",
            targetNodeId: "another-process-node",
          },
        ],
        processId: created.process.id,
        reason: "Invalid link.",
      })
    ).rejects.toMatchObject({ code: "invalid_graph_operation" });
    expect(harness.repository.events).toHaveLength(1);
  });

  it("changes durable state only through an allowed transition", async () => {
    const harness = createHarness();
    const created = await createLaunchProcess(harness);

    const blocked = await harness.service.changeState({
      context: context({ callId: "call-2", toolName: "change_process_state" }),
      expectedVersion: 1,
      processId: created.process.id,
      reason: "We agreed legal review blocks progress.",
      status: "blocked",
    });

    expect(blocked.process.status).toBe("blocked");
    expect(blocked.version).toBe(2);
  });

  it("enforces the approved status transition table", async () => {
    const harness = createHarness();
    const created = await createLaunchProcess(harness);
    const archived = await harness.service.changeState({
      context: context({ callId: "call-2", toolName: "change_process_state" }),
      expectedVersion: 1,
      processId: created.process.id,
      reason: "Archive it.",
      status: "archived",
    });

    await expect(
      harness.service.changeState({
        context: context({
          callId: "call-3",
          toolName: "change_process_state",
        }),
        expectedVersion: archived.version,
        processId: created.process.id,
        reason: "This transition is not allowed.",
        status: "completed",
      })
    ).rejects.toMatchObject({ code: "invalid_graph_operation" });
  });

  it("adds and removes tags without replacing unrelated tags", async () => {
    const harness = createHarness();
    const created = await createLaunchProcess(harness);

    const result = await harness.service.updateTags({
      add: ["priority"],
      context: context({ callId: "call-2", toolName: "update_process_tags" }),
      expectedVersion: 1,
      processId: created.process.id,
      reason: "Update the agreed tags.",
      remove: ["launch"],
    });

    expect(result.process.tags).toEqual(["priority"]);
  });

  it("rebuilds the persisted projection from authoritative graph rows", async () => {
    const harness = createHarness();
    const created = await createLaunchProcess(harness);
    await harness.service.mutateGraph({
      context: context({ callId: "call-2", toolName: "mutate_process_graph" }),
      expectedVersion: 1,
      operations: [
        {
          column: {
            emphasis: "strong",
            key: "state",
            label: "State",
            position: 0,
            selector: { field: "status", selector: "process_field" },
            valueType: "status",
          },
          op: "define_projection_column",
        },
      ],
      processId: created.process.id,
      reason: "Show state in the human projection.",
    });

    const rebuilt = await harness.service.rebuildProjection({
      ownerId: ownerOne,
      processId: created.process.id,
    });
    const persisted = await harness.service.readProcess({
      ownerId: ownerOne,
      processId: created.process.id,
    });

    expect(rebuilt).toEqual(persisted?.projection);
  });

  it("never returns another owner's process", async () => {
    const harness = createHarness();
    const created = await createLaunchProcess(harness);

    const snapshot = await harness.service.readProcess({
      ownerId: "owner-2",
      processId: created.process.id,
    });
    const found = await harness.service.findProcesses({
      limit: 20,
      ownerId: "owner-2",
      query: "Launch",
    });

    expect(snapshot).toBeNull();
    expect(found.items).toEqual([]);
  });
});
