import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { getDb, isProcessSchemaReady } from "@/lib/db/client";
import { processEvent } from "@/lib/db/schema";
import { createDrizzleProcessRepository } from "@/lib/processes/repository";
import {
  createProcessService,
  type ProcessCommandContext,
} from "@/lib/processes/service";

const runDatabaseTests = process.env.RUN_DATABASE_TESTS === "1";

function errorChainMessages(error: unknown): string[] {
  const messages: string[] = [];
  let current = error;

  while (current instanceof Error) {
    messages.push(current.message);
    current = current.cause;
  }

  return messages;
}

async function expectAppendOnlyViolation(operation: Promise<unknown>) {
  try {
    await operation;
    expect.fail("Expected the process_event append-only trigger to reject");
  } catch (error) {
    expect(errorChainMessages(error).join("\n")).toContain(
      "process_event is append-only"
    );
  }
}

function commandContext(
  ownerId: string,
  suffix: string,
  toolName = "create_process"
): ProcessCommandContext {
  return {
    callId: `call-${suffix}`,
    eveSessionId: `session-${suffix}`,
    ownerId,
    toolName,
    turnId: `turn-${suffix}`,
    turnSequence: 1,
  };
}

describe.runIf(runDatabaseTests)("Drizzle process repository", () => {
  it("sees the migrated process schema", async () => {
    await expect(isProcessSchemaReady()).resolves.toBe(true);
  });

  it("creates unique human numbers and preserves owner isolation", async () => {
    const ownerId = `integration-owner-${crypto.randomUUID()}`;
    const service = createProcessService(createDrizzleProcessRepository());
    const first = await service.createProcess({
      context: commandContext(ownerId, "first"),
      reason: "Create the first integration process.",
      title: "First integration process",
    });
    const second = await service.createProcess({
      context: commandContext(ownerId, "second"),
      reason: "Create the second integration process.",
      title: "Second integration process",
    });

    expect(second.process.number).toBeGreaterThan(first.process.number);
    await expect(
      service.readProcess({
        ownerId: "another-owner",
        processId: first.process.id,
      })
    ).resolves.toBeNull();
  });

  it("commits graph, projection, version, and event atomically across replay and conflict", async () => {
    const ownerId = `integration-owner-${crypto.randomUUID()}`;
    const service = createProcessService(createDrizzleProcessRepository());
    const created = await service.createProcess({
      context: commandContext(ownerId, "atomic"),
      reason: "Create the atomic integration process.",
      title: "Atomic integration process",
    });
    const mutationContext = commandContext(
      ownerId,
      "mutation",
      "mutate_process_graph"
    );
    const command = {
      context: mutationContext,
      expectedVersion: 1,
      operations: [
        {
          kind: "brief",
          label: "Integration brief",
          metadata: { audience: "Operators" },
          nodeId: `node-${crypto.randomUUID()}`,
          op: "add_node" as const,
        },
      ],
      processId: created.process.id,
      reason: "Add the integration brief.",
    };

    const committed = await service.mutateGraph(command);
    const replay = await service.mutateGraph(command);
    const snapshot = await service.readProcess({
      ownerId,
      processId: created.process.id,
    });
    const history = await service.readHistory({
      limit: 50,
      ownerId,
      processId: created.process.id,
    });

    expect(replay).toEqual(committed);
    expect(snapshot?.process.version).toBe(2);
    expect(snapshot?.projection.sourceProcessVersion).toBe(2);
    expect(history?.items).toHaveLength(2);
    await expect(
      service.updateTags({
        add: ["stale"],
        context: commandContext(ownerId, "stale", "update_process_tags"),
        expectedVersion: 1,
        processId: created.process.id,
        reason: "This stale mutation must fail.",
        remove: [],
      })
    ).rejects.toMatchObject({ code: "version_conflict", currentVersion: 2 });
  });

  it("scopes semantic node and edge ids to their process", async () => {
    const ownerId = `integration-owner-${crypto.randomUUID()}`;
    const service = createProcessService(createDrizzleProcessRepository());
    const first = await service.createProcess({
      context: commandContext(ownerId, "local-ids-first"),
      reason: "Create the first local-id process.",
      title: "First local-id process",
    });
    const second = await service.createProcess({
      context: commandContext(ownerId, "local-ids-second"),
      reason: "Create the second local-id process.",
      title: "Second local-id process",
    });

    for (const [suffix, created] of [
      ["first", first],
      ["second", second],
    ] as const) {
      await service.mutateGraph({
        context: commandContext(
          ownerId,
          `local-ids-mutation-${suffix}`,
          "mutate_process_graph"
        ),
        expectedVersion: 1,
        operations: [
          {
            kind: "brief",
            label: "Planning brief",
            metadata: {},
            nodeId: "source-planning-sheet",
            op: "add_node",
          },
          {
            edgeId: "contains-planning-source",
            metadata: {},
            op: "link_nodes",
            relation: "contains",
            sourceNodeId: created.affectedNodeIds[0] ?? "",
            targetNodeId: "source-planning-sheet",
          },
        ],
        processId: created.process.id,
        reason: "Add the same semantic graph ids to this process.",
      });
    }

    const firstSnapshot = await service.readProcess({
      ownerId,
      processId: first.process.id,
    });
    const secondSnapshot = await service.readProcess({
      ownerId,
      processId: second.process.id,
    });

    expect(firstSnapshot?.nodes).toContainEqual(
      expect.objectContaining({ id: "source-planning-sheet" })
    );
    expect(secondSnapshot?.nodes).toContainEqual(
      expect.objectContaining({ id: "source-planning-sheet" })
    );
    expect(firstSnapshot?.edges).toContainEqual(
      expect.objectContaining({ id: "contains-planning-source" })
    );
    expect(secondSnapshot?.edges).toContainEqual(
      expect.objectContaining({ id: "contains-planning-source" })
    );
  });

  it("rejects update and delete against an existing process event", async () => {
    const ownerId = `integration-owner-${crypto.randomUUID()}`;
    const service = createProcessService(createDrizzleProcessRepository());
    const created = await service.createProcess({
      context: commandContext(ownerId, "append-only"),
      reason: "Create the append-only integration process.",
      title: "Append-only integration process",
    });
    const database = getDb();
    const eventFilter = and(
      eq(processEvent.ownerId, ownerId),
      eq(processEvent.processId, created.process.id)
    );

    await expectAppendOnlyViolation(
      database
        .update(processEvent)
        .set({ reason: "Mutated" })
        .where(eventFilter)
    );
    await expectAppendOnlyViolation(
      database.delete(processEvent).where(eventFilter)
    );
  });
});
