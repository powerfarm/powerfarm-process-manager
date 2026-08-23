import { describe, expect, it } from "vitest";
import type {
  ProcessProjection,
  ProcessSummary,
} from "@/lib/processes/contracts";
import type { ProcessSnapshot } from "@/lib/processes/repository";
import {
  buildProcessContextInstructions,
  type ProcessContextBinding,
  type ProcessContextReader,
} from "../../instructions/process-context.js";

function processSummary(): ProcessSummary {
  return {
    archivedAt: null,
    createdAt: "2026-08-23T08:00:00.000Z",
    graphSchemaVersion: 1,
    id: "process-1",
    number: 123,
    ownerId: "owner-1",
    projectionSchema: { columns: [], version: 1 },
    status: "blocked",
    tags: ["launch", "priority"],
    title: "Launch test",
    updatedAt: "2026-08-23T08:01:00.000Z",
    version: 4,
  };
}

function processProjection(process: ProcessSummary): ProcessProjection {
  return {
    blockers: ["raw blocker must not be injected"],
    columns: [
      {
        emphasis: "strong",
        key: "next",
        label: "Next action",
        position: 0,
        value: "Approve the launch",
        valueType: "text",
      },
    ],
    generatedAt: process.updatedAt,
    metrics: { liveEdges: 7, liveMetadataFields: 9, liveNodes: 6 },
    nextAction: "raw next action must not be injected",
    pendingItems: ["raw pending item must not be injected"],
    processId: process.id,
    processNumber: process.number,
    projectionVersion: 3,
    sourceProcessVersion: process.version,
    status: process.status,
    summary: "raw summary must not be injected",
    tags: process.tags,
    title: process.title,
  };
}

function context(ownerId = "owner-1") {
  return {
    channel: { kind: "web" },
    messages: [],
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
    },
  };
}

function binding(processId: string | null): ProcessContextBinding {
  return {
    get: () => ({ processId, projectionVersion: processId ? 3 : null }),
  };
}

function reader(snapshot: ProcessSnapshot | null): ProcessContextReader {
  return {
    readProcess: () => Promise.resolve(snapshot),
  };
}

async function resolveTurn(
  source: ReturnType<typeof buildProcessContextInstructions>,
  ownerId = "owner-1"
) {
  const handler = source.events["turn.started"];
  if (!handler) {
    throw new Error("turn.started resolver is missing");
  }
  return await handler({}, context(ownerId) as never);
}

describe("active process dynamic instructions", () => {
  it("emits nothing when no process is active", async () => {
    const source = buildProcessContextInstructions({
      binding: binding(null),
      reader: reader(null),
    });

    expect(await resolveTurn(source)).toBeNull();
  });

  it("emits only the bounded human projection, never graph rows or history", async () => {
    const process = processSummary();
    const source = buildProcessContextInstructions({
      binding: binding(process.id),
      reader: reader({
        edges: [
          {
            createdAt: process.createdAt,
            id: "secret-edge",
            metadata: { raw_secret: "must-not-appear" },
            processId: process.id,
            relation: "depends_on",
            sourceNodeId: "node-1",
            targetNodeId: "node-2",
            tombstonedAt: null,
            updatedAt: process.updatedAt,
          },
        ],
        nodes: [
          {
            createdAt: process.createdAt,
            id: "secret-node",
            kind: "note",
            label: "raw graph row",
            metadata: { raw_secret: "must-not-appear" },
            processId: process.id,
            tombstonedAt: null,
            updatedAt: process.updatedAt,
          },
        ],
        process,
        projection: processProjection(process),
      }),
    });

    const result = await resolveTurn(source);

    expect(result).toMatchObject({ role: "user" });
    expect(result?.content).toContain('"id":"process-1"');
    expect(result?.content).toContain('"title":"Launch test"');
    expect(result?.content).toContain('"status":"blocked"');
    expect(result?.content).toContain('"version":4');
    expect(result?.content).toContain('"label":"Next action"');
    expect(result?.content).not.toContain("secret-node");
    expect(result?.content).not.toContain("secret-edge");
    expect(result?.content).not.toContain("raw_secret");
    expect(result?.content).not.toContain("raw blocker");
    expect(result?.content).not.toContain("raw pending");
  });

  it("emits a safe note when the session binding is stale", async () => {
    const source = buildProcessContextInstructions({
      binding: binding("missing-process"),
      reader: reader(null),
    });

    const result = await resolveTurn(source);

    expect(result).toMatchObject({ role: "user" });
    expect(result?.content).toContain("missing-process");
    expect(result?.content).toContain("no longer readable");
  });

  it("uses only a user-role turn.started resolver", async () => {
    const process = processSummary();
    const source = buildProcessContextInstructions({
      binding: binding(process.id),
      reader: reader({
        edges: [],
        nodes: [],
        process,
        projection: processProjection(process),
      }),
    });

    expect(source.events["session.started"]).toBeUndefined();
    expect(await resolveTurn(source)).toMatchObject({ role: "user" });
  });
});
