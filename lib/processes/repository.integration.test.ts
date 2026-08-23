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

    await expect(
      database
        .update(processEvent)
        .set({ reason: "Mutated" })
        .where(eventFilter)
    ).rejects.toThrow("process_event is append-only");
    await expect(
      database.delete(processEvent).where(eventFilter)
    ).rejects.toThrow("process_event is append-only");
  });
});
