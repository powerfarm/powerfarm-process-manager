import type { MessageStreamEvent } from "eve/client";
import { describe, expect, it } from "vitest";
import type {
  ProcessProjection,
  ProcessSummary,
  ProcessToolResult,
} from "@/lib/processes/contracts";
import { reduceProcessEvents } from "@/lib/processes/ui-projection";

function processSummary(
  version = 1,
  status: ProcessSummary["status"] = "in_progress"
): ProcessSummary {
  return {
    archivedAt: null,
    createdAt: "2026-08-23T08:00:00.000Z",
    graphSchemaVersion: 1,
    id: "process-1",
    number: 123,
    ownerId: "owner-1",
    projectionSchema: { columns: [], version: 1 },
    status,
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
    tags: process.tags,
    title: process.title,
  };
}

function result(
  version = 1,
  status: ProcessSummary["status"] = "in_progress"
): ProcessToolResult {
  const process = processSummary(version, status);
  return {
    active: true,
    affectedEdgeIds: [],
    affectedNodeIds: [],
    eventId: `event-${version}`,
    mutationKey: `mutation-${version}`,
    operationSummary: "Committed.",
    process,
    projection: projection(process),
    version,
  };
}

function requested(
  toolName: string,
  callId = "call-1",
  sequence = 1
): MessageStreamEvent {
  return {
    data: {
      actions: [{ callId, input: {}, kind: "tool-call", toolName }],
      sequence,
      stepIndex: 0,
      turnId: "turn-1",
    },
    meta: { at: "2026-08-23T08:00:00.000Z", id: `stream-${sequence}` },
    type: "actions.requested",
  };
}

function completed(
  toolName: string,
  output: ProcessToolResult,
  options: {
    readonly callId?: string;
    readonly sequence?: number;
    readonly status?: "completed" | "failed" | "rejected";
  } = {}
): MessageStreamEvent {
  const sequence = options.sequence ?? 2;
  return {
    data: {
      ...(options.status === "failed"
        ? { error: { code: "tool_failed", message: "Tool failed." } }
        : {}),
      result: {
        callId: options.callId ?? "call-1",
        ...(options.status === "failed" ? { isError: true } : {}),
        kind: "tool-result",
        output,
        toolName,
      },
      sequence,
      status: options.status ?? "completed",
      stepIndex: 0,
      turnId: "turn-1",
    },
    meta: { at: "2026-08-23T08:01:00.000Z", id: `stream-${sequence}` },
    type: "action.result",
  };
}

function cancelled(sequence = 3): MessageStreamEvent {
  return {
    data: { sequence, turnId: "turn-1" },
    meta: { at: "2026-08-23T08:02:00.000Z", id: `stream-${sequence}` },
    type: "turn.cancelled",
  };
}

describe("process UI event projection", () => {
  it("ignores non-process actions", () => {
    const events = [
      requested("save_brand_context"),
      completed("save_brand_context", result()),
    ];

    expect(reduceProcessEvents(events, true)).toEqual({
      activeProcess: null,
      isProcessing: false,
      projection: null,
    });
  });

  it.each(["create_process", "activate_process"])(
    "activates the pill from a successful %s result",
    (toolName) => {
      const state = reduceProcessEvents(
        [requested(toolName), completed(toolName, result())],
        false
      );

      expect(state.activeProcess?.id).toBe("process-1");
      expect(state.projection?.sourceProcessVersion).toBe(1);
    }
  );

  it("updates the projection and durable state from later results", () => {
    const state = reduceProcessEvents(
      [
        completed("create_process", result(1), { sequence: 1 }),
        completed("change_process_state", result(2, "blocked"), {
          callId: "call-2",
          sequence: 2,
        }),
      ],
      false
    );

    expect(state.activeProcess).toMatchObject({
      status: "blocked",
      version: 2,
    });
    expect(state.projection).toMatchObject({
      sourceProcessVersion: 2,
      status: "blocked",
    });
  });

  it("clears the pill only from a successful deactivate result", () => {
    const deactivated: ProcessToolResult = {
      active: false,
      affectedEdgeIds: [],
      affectedNodeIds: [],
      eventId: null,
      mutationKey: null,
      operationSummary: "Returned to brainstorm mode.",
      process: null,
      projection: null,
      version: null,
    };
    const active = completed("create_process", result(), { sequence: 1 });
    const failed = completed("deactivate_process", deactivated, {
      callId: "call-2",
      sequence: 2,
      status: "failed",
    });
    const successful = completed("deactivate_process", deactivated, {
      callId: "call-3",
      sequence: 3,
    });

    expect(
      reduceProcessEvents([active, failed], false).activeProcess
    ).not.toBeNull();
    expect(
      reduceProcessEvents([active, failed, successful], false).activeProcess
    ).toBeNull();
  });

  it("derives transient processing only from process-tool lifecycle events", () => {
    expect(
      reduceProcessEvents([requested("mutate_process_graph")], true)
        .isProcessing
    ).toBe(true);
    expect(
      reduceProcessEvents([requested("save_brand_context")], true).isProcessing
    ).toBe(false);
  });

  it("settles transient processing after failure or cancellation", () => {
    const started = requested("mutate_process_graph");
    const failed = completed("mutate_process_graph", result(), {
      status: "failed",
    });

    expect(reduceProcessEvents([started, failed], true).isProcessing).toBe(
      false
    );
    expect(reduceProcessEvents([started, cancelled()], true).isProcessing).toBe(
      false
    );
  });

  it("reconstructs the same pill from persisted display events", () => {
    const events = [
      requested("create_process"),
      completed("create_process", result()),
    ];
    const persisted = JSON.parse(
      JSON.stringify(events)
    ) as MessageStreamEvent[];

    expect(reduceProcessEvents(persisted, false)).toEqual(
      reduceProcessEvents(events, false)
    );
  });

  it("keeps the latest process version when older events arrive later", () => {
    const state = reduceProcessEvents(
      [
        completed("change_process_state", result(3, "completed"), {
          callId: "call-3",
          sequence: 1,
        }),
        completed("change_process_state", result(2, "blocked"), {
          callId: "call-2",
          sequence: 2,
        }),
      ],
      false
    );

    expect(state.activeProcess).toMatchObject({
      status: "completed",
      version: 3,
    });
  });
});
