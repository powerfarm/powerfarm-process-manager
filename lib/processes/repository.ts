import { and, desc, eq, ilike, inArray, isNull, or, sql } from "drizzle-orm";
import {
  type DatabaseTransaction,
  getDb,
  withDatabaseTransaction,
} from "@/lib/db/client";
import {
  type Process,
  type ProcessEdgeRow,
  type ProcessEventRow,
  type ProcessNodeRow,
  type ProcessProjectionRow,
  processEdge as processEdgeTable,
  processEvent as processEventTable,
  processNode as processNodeTable,
  processProjection as processProjectionTable,
  process as processTable,
} from "@/lib/db/schema";
import type {
  ProcessEdge,
  ProcessEvent,
  ProcessNode,
  ProcessProjection,
  ProcessSummary,
  ProcessToolResult,
} from "@/lib/processes/contracts";
import { processToolResultSchema } from "@/lib/processes/contracts";
import { ProcessError } from "@/lib/processes/errors";
import { projectProcess } from "@/lib/processes/projection";

export interface ProcessCommandContext {
  readonly callId: string;
  readonly eveSessionId: string;
  readonly ownerId: string;
  readonly toolName: string;
  readonly turnId: string;
  readonly turnSequence: number;
}

export interface ProcessSnapshot {
  readonly edges: readonly ProcessEdge[];
  readonly nodes: readonly ProcessNode[];
  readonly process: ProcessSummary;
  readonly projection: ProcessProjection;
}

export type ProcessMutationResult = Omit<
  ProcessToolResult,
  "eventId" | "mutationKey" | "process" | "projection" | "version"
> & {
  readonly eventId: string;
  readonly mutationKey: string;
  readonly process: ProcessSummary;
  readonly projection: ProcessProjection;
  readonly version: number;
};

export interface ProcessMutationDraft {
  readonly event: ProcessEvent;
  readonly result: ProcessMutationResult;
  readonly snapshot: ProcessSnapshot;
}

export interface CreateRepositoryProcessInput {
  readonly context: ProcessCommandContext;
  readonly mutationKey: string;
  readonly now: string;
  readonly processId: string;
  readonly title: string;
}

export interface RepositoryMutationInput {
  readonly context: ProcessCommandContext;
  readonly expectedVersion: number;
  readonly mutationKey: string;
  readonly now: string;
  readonly ownerId: string;
  readonly processId: string;
}

export interface ProcessListPage {
  readonly items: readonly ProcessSummary[];
  readonly nextCursor: string | null;
}

export interface ProcessGraphPage {
  readonly edges: readonly ProcessEdge[];
  readonly nextCursor: string | null;
  readonly nodes: readonly ProcessNode[];
}

export interface ProcessEventPage {
  readonly items: readonly ProcessEvent[];
  readonly nextCursor: string | null;
}

export interface ProcessRepository {
  readonly createProcess: (
    input: CreateRepositoryProcessInput,
    initialize: (process: ProcessSummary) => ProcessMutationDraft
  ) => Promise<ProcessMutationResult>;
  readonly findProcesses: (input: {
    readonly limit: number;
    readonly ownerId: string;
    readonly query?: string;
  }) => Promise<ProcessListPage>;
  readonly inspectGraph: (input: {
    readonly kind?: string;
    readonly limit?: number;
    readonly nodeId?: string;
    readonly ownerId: string;
    readonly processId: string;
    readonly relation?: string;
  }) => Promise<ProcessGraphPage | null>;
  readonly mutateProcess: (
    input: RepositoryMutationInput,
    mutate: (snapshot: ProcessSnapshot) => ProcessMutationDraft
  ) => Promise<ProcessMutationResult>;
  readonly readEvents: (input: {
    readonly limit: number;
    readonly ownerId: string;
    readonly processId: string;
  }) => Promise<ProcessEventPage | null>;
  readonly readSnapshot: (input: {
    readonly ownerId: string;
    readonly processId: string;
  }) => Promise<ProcessSnapshot | null>;
}

type Database = ReturnType<typeof getDb>;

function iso(value: Date): string {
  return value.toISOString();
}

function toProcessSummary(row: Process): ProcessSummary {
  return {
    archivedAt: row.archivedAt ? iso(row.archivedAt) : null,
    createdAt: iso(row.createdAt),
    graphSchemaVersion: row.graphSchemaVersion,
    id: row.id,
    number: row.number,
    ownerId: row.ownerId,
    projectionSchema: row.projectionSchema,
    status: row.status,
    tags: [...row.tags],
    title: row.title,
    updatedAt: iso(row.updatedAt),
    version: row.version,
  };
}

function toProcessNode(row: ProcessNodeRow): ProcessNode {
  return {
    createdAt: iso(row.createdAt),
    id: row.id,
    kind: row.kind,
    label: row.label,
    metadata: row.metadata,
    processId: row.processId,
    tombstonedAt: row.tombstonedAt ? iso(row.tombstonedAt) : null,
    updatedAt: iso(row.updatedAt),
  };
}

function toProcessEdge(row: ProcessEdgeRow): ProcessEdge {
  return {
    createdAt: iso(row.createdAt),
    id: row.id,
    metadata: row.metadata,
    processId: row.processId,
    relation: row.relation,
    sourceNodeId: row.sourceNodeId,
    targetNodeId: row.targetNodeId,
    tombstonedAt: row.tombstonedAt ? iso(row.tombstonedAt) : null,
    updatedAt: iso(row.updatedAt),
  };
}

function toProcessEvent(row: ProcessEventRow): ProcessEvent {
  return {
    callId: row.callId,
    createdAt: iso(row.createdAt),
    eveSessionId: row.eveSessionId,
    id: row.id,
    mutationKey: row.mutationKey,
    operationType: row.operationType,
    ownerId: row.ownerId,
    payload: row.payload,
    processId: row.processId,
    processVersion: row.processVersion,
    reason: row.reason,
    sequence: row.sequence,
    toolName: row.toolName,
    turnId: row.turnId,
    turnSequence: row.turnSequence,
  };
}

function toProjection(
  row: ProcessProjectionRow | undefined,
  process: ProcessSummary,
  nodes: readonly ProcessNode[],
  edges: readonly ProcessEdge[]
): ProcessProjection {
  if (!row) {
    return projectProcess({
      columns: process.projectionSchema.columns,
      edges,
      nodes,
      process,
    });
  }
  return {
    blockers: [...row.blockers],
    columns: [...row.columns],
    generatedAt: iso(row.generatedAt),
    metrics: row.metrics,
    nextAction: row.nextAction,
    pendingItems: [...row.pendingItems],
    processId: process.id,
    processNumber: process.number,
    projectionVersion: row.projectionSchemaVersion,
    sourceProcessVersion: row.sourceProcessVersion,
    status: process.status,
    summary: row.summary,
    tags: process.tags,
    title: process.title,
  };
}

function replayResult(
  row: ProcessEventRow | undefined
): ProcessMutationResult | null {
  if (!row) {
    return null;
  }
  const candidate = row.payload.result;
  const parsed = processToolResultSchema.safeParse(candidate);
  if (
    !(
      parsed.success &&
      parsed.data.eventId &&
      parsed.data.mutationKey &&
      parsed.data.process &&
      parsed.data.projection
    ) ||
    parsed.data.version === null
  ) {
    throw new ProcessError(
      "process_store_unavailable",
      "Process memory is temporarily unavailable."
    );
  }
  return {
    ...parsed.data,
    eventId: parsed.data.eventId,
    mutationKey: parsed.data.mutationKey,
    process: parsed.data.process,
    projection: parsed.data.projection,
    version: parsed.data.version,
  };
}

async function loadSnapshot(
  database: Database | DatabaseTransaction,
  input: { readonly ownerId: string; readonly processId: string }
): Promise<ProcessSnapshot | null> {
  const [processRow, nodeRows, edgeRows, projectionRows] = await Promise.all([
    database
      .select()
      .from(processTable)
      .where(
        and(
          eq(processTable.id, input.processId),
          eq(processTable.ownerId, input.ownerId)
        )
      )
      .limit(1),
    database
      .select()
      .from(processNodeTable)
      .where(
        and(
          eq(processNodeTable.processId, input.processId),
          eq(processNodeTable.ownerId, input.ownerId)
        )
      ),
    database
      .select()
      .from(processEdgeTable)
      .where(
        and(
          eq(processEdgeTable.processId, input.processId),
          eq(processEdgeTable.ownerId, input.ownerId)
        )
      ),
    database
      .select()
      .from(processProjectionTable)
      .where(
        and(
          eq(processProjectionTable.processId, input.processId),
          eq(processProjectionTable.ownerId, input.ownerId)
        )
      )
      .limit(1),
  ]);
  const row = processRow[0];
  if (!row) {
    return null;
  }
  const process = toProcessSummary(row);
  const nodes = nodeRows.map(toProcessNode);
  const edges = edgeRows.map(toProcessEdge);
  return {
    edges,
    nodes,
    process,
    projection: toProjection(projectionRows[0], process, nodes, edges),
  };
}

function processUpdateValues(process: ProcessSummary) {
  return {
    archivedAt: process.archivedAt ? new Date(process.archivedAt) : null,
    graphSchemaVersion: process.graphSchemaVersion,
    projectionSchema: process.projectionSchema,
    status: process.status,
    tags: process.tags,
    title: process.title,
    updatedAt: new Date(process.updatedAt),
    version: process.version,
  };
}

async function persistDraft(
  transaction: DatabaseTransaction,
  draft: ProcessMutationDraft
): Promise<void> {
  const { snapshot } = draft;
  if (snapshot.nodes.length > 0) {
    await transaction
      .insert(processNodeTable)
      .values(
        snapshot.nodes.map((node) => ({
          createdAt: new Date(node.createdAt),
          id: node.id,
          kind: node.kind,
          label: node.label,
          metadata: node.metadata,
          ownerId: snapshot.process.ownerId,
          processId: snapshot.process.id,
          tombstonedAt: node.tombstonedAt ? new Date(node.tombstonedAt) : null,
          updatedAt: new Date(node.updatedAt),
        }))
      )
      .onConflictDoUpdate({
        set: {
          kind: sql`excluded.kind`,
          label: sql`excluded.label`,
          metadata: sql`excluded.metadata`,
          tombstonedAt: sql`excluded.tombstoned_at`,
          updatedAt: sql`excluded.updated_at`,
        },
        target: processNodeTable.id,
      });
  }
  if (snapshot.edges.length > 0) {
    await transaction
      .insert(processEdgeTable)
      .values(
        snapshot.edges.map((edge) => ({
          createdAt: new Date(edge.createdAt),
          id: edge.id,
          metadata: edge.metadata,
          ownerId: snapshot.process.ownerId,
          processId: snapshot.process.id,
          relation: edge.relation,
          sourceNodeId: edge.sourceNodeId,
          targetNodeId: edge.targetNodeId,
          tombstonedAt: edge.tombstonedAt ? new Date(edge.tombstonedAt) : null,
          updatedAt: new Date(edge.updatedAt),
        }))
      )
      .onConflictDoUpdate({
        set: {
          metadata: sql`excluded.metadata`,
          relation: sql`excluded.relation`,
          sourceNodeId: sql`excluded.source_node_id`,
          targetNodeId: sql`excluded.target_node_id`,
          tombstonedAt: sql`excluded.tombstoned_at`,
          updatedAt: sql`excluded.updated_at`,
        },
        target: processEdgeTable.id,
      });
  }
  await transaction
    .insert(processProjectionTable)
    .values({
      blockers: snapshot.projection.blockers,
      columns: snapshot.projection.columns,
      generatedAt: new Date(snapshot.projection.generatedAt),
      metrics: snapshot.projection.metrics,
      nextAction: snapshot.projection.nextAction,
      ownerId: snapshot.process.ownerId,
      pendingItems: snapshot.projection.pendingItems,
      processId: snapshot.process.id,
      projectionSchemaVersion: snapshot.projection.projectionVersion,
      sourceProcessVersion: snapshot.projection.sourceProcessVersion,
      summary: snapshot.projection.summary,
    })
    .onConflictDoUpdate({
      set: {
        blockers: snapshot.projection.blockers,
        columns: snapshot.projection.columns,
        generatedAt: new Date(snapshot.projection.generatedAt),
        metrics: snapshot.projection.metrics,
        nextAction: snapshot.projection.nextAction,
        pendingItems: snapshot.projection.pendingItems,
        projectionSchemaVersion: snapshot.projection.projectionVersion,
        sourceProcessVersion: snapshot.projection.sourceProcessVersion,
        summary: snapshot.projection.summary,
      },
      target: processProjectionTable.processId,
    });
  await transaction.insert(processEventTable).values({
    callId: draft.event.callId,
    createdAt: new Date(draft.event.createdAt),
    eveSessionId: draft.event.eveSessionId,
    id: draft.event.id,
    mutationKey: draft.event.mutationKey,
    operationType: draft.event.operationType,
    ownerId: draft.event.ownerId,
    payload: draft.event.payload,
    processId: draft.event.processId,
    processVersion: draft.event.processVersion,
    reason: draft.event.reason,
    sequence: draft.event.sequence,
    toolName: draft.event.toolName,
    turnId: draft.event.turnId,
    turnSequence: draft.event.turnSequence,
  });
}

function isUniqueViolation(error: unknown): boolean {
  return Boolean(
    error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "23505"
  );
}

async function storeBoundary<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof ProcessError) {
      throw error;
    }
    throw new ProcessError(
      "process_store_unavailable",
      "Process memory is temporarily unavailable."
    );
  }
}

export function createDrizzleProcessRepository(
  configuredDatabase?: Database
): ProcessRepository {
  const database = () => configuredDatabase ?? getDb();

  async function findMutationResult(input: {
    readonly mutationKey: string;
    readonly ownerId: string;
  }): Promise<ProcessMutationResult | null> {
    const rows = await database()
      .select()
      .from(processEventTable)
      .where(
        and(
          eq(processEventTable.ownerId, input.ownerId),
          eq(processEventTable.mutationKey, input.mutationKey)
        )
      )
      .limit(1);
    return replayResult(rows[0]);
  }

  async function findCreationResult(input: {
    readonly context: ProcessCommandContext;
  }): Promise<ProcessMutationResult | null> {
    const rows = await database()
      .select()
      .from(processEventTable)
      .where(
        and(
          eq(processEventTable.ownerId, input.context.ownerId),
          eq(processEventTable.eveSessionId, input.context.eveSessionId),
          eq(processEventTable.turnId, input.context.turnId),
          eq(processEventTable.operationType, "create_process")
        )
      )
      .limit(1);
    return replayResult(rows[0]);
  }

  return {
    async createProcess(input, initialize) {
      return storeBoundary(async () => {
        const existing = await findCreationResult(input);
        if (existing) {
          return existing;
        }
        try {
          return await withDatabaseTransaction(async (transaction) => {
            const [createdRow] = await transaction
              .insert(processTable)
              .values({
                createdAt: new Date(input.now),
                id: input.processId,
                ownerId: input.context.ownerId,
                title: input.title,
                updatedAt: new Date(input.now),
                version: 1,
              })
              .returning();
            if (!createdRow) {
              throw new ProcessError(
                "process_store_unavailable",
                "Process memory is temporarily unavailable."
              );
            }
            const draft = initialize(toProcessSummary(createdRow));
            await transaction
              .update(processTable)
              .set(processUpdateValues(draft.snapshot.process))
              .where(
                and(
                  eq(processTable.id, draft.snapshot.process.id),
                  eq(processTable.ownerId, draft.snapshot.process.ownerId)
                )
              );
            await persistDraft(transaction, draft);
            return draft.result;
          });
        } catch (error) {
          if (isUniqueViolation(error)) {
            const replay = await findCreationResult(input);
            if (replay) {
              return replay;
            }
          }
          throw error;
        }
      });
    },

    findProcesses(input) {
      return storeBoundary(async () => {
        const limit = Math.max(1, Math.min(input.limit, 50));
        const query = input.query?.trim();
        const numberMatch = query?.match(/^(?:PROC-0*)?(\d+)$/i);
        const number = numberMatch?.[1]
          ? Number.parseInt(numberMatch[1], 10)
          : null;
        const search = query
          ? or(
              ilike(processTable.title, `%${query}%`),
              number ? eq(processTable.number, number) : undefined
            )
          : undefined;
        const rows = await database()
          .select()
          .from(processTable)
          .where(and(eq(processTable.ownerId, input.ownerId), search))
          .orderBy(desc(processTable.updatedAt), desc(processTable.id))
          .limit(limit);
        return { items: rows.map(toProcessSummary), nextCursor: null };
      });
    },

    inspectGraph(input) {
      return storeBoundary(async () => {
        const visible = await database()
          .select({ id: processTable.id })
          .from(processTable)
          .where(
            and(
              eq(processTable.id, input.processId),
              eq(processTable.ownerId, input.ownerId)
            )
          )
          .limit(1);
        if (!visible[0]) {
          return null;
        }
        const limit = Math.max(1, Math.min(input.limit ?? 50, 50));
        const edgeRows = await database()
          .select()
          .from(processEdgeTable)
          .where(
            and(
              eq(processEdgeTable.ownerId, input.ownerId),
              eq(processEdgeTable.processId, input.processId),
              isNull(processEdgeTable.tombstonedAt),
              input.relation
                ? eq(processEdgeTable.relation, input.relation)
                : undefined,
              input.nodeId
                ? or(
                    eq(processEdgeTable.sourceNodeId, input.nodeId),
                    eq(processEdgeTable.targetNodeId, input.nodeId)
                  )
                : undefined
            )
          )
          .orderBy(desc(processEdgeTable.updatedAt), desc(processEdgeTable.id))
          .limit(limit);
        const neighborIds = input.nodeId
          ? [
              input.nodeId,
              ...edgeRows.flatMap((edge) => [
                edge.sourceNodeId,
                edge.targetNodeId,
              ]),
            ]
          : [];
        const nodeRows = await database()
          .select()
          .from(processNodeTable)
          .where(
            and(
              eq(processNodeTable.ownerId, input.ownerId),
              eq(processNodeTable.processId, input.processId),
              isNull(processNodeTable.tombstonedAt),
              input.kind ? eq(processNodeTable.kind, input.kind) : undefined,
              neighborIds.length > 0
                ? inArray(processNodeTable.id, [...new Set(neighborIds)])
                : undefined
            )
          )
          .orderBy(desc(processNodeTable.updatedAt), desc(processNodeTable.id))
          .limit(limit);
        return {
          edges: edgeRows.map(toProcessEdge),
          nextCursor: null,
          nodes: nodeRows.map(toProcessNode),
        };
      });
    },

    async mutateProcess(input, mutate) {
      return storeBoundary(async () => {
        const existing = await findMutationResult({
          mutationKey: input.mutationKey,
          ownerId: input.ownerId,
        });
        if (existing) {
          return existing;
        }
        try {
          return await withDatabaseTransaction(async (transaction) => {
            const lockedRows = await transaction
              .select()
              .from(processTable)
              .where(
                and(
                  eq(processTable.id, input.processId),
                  eq(processTable.ownerId, input.ownerId)
                )
              )
              .for("update")
              .limit(1);
            const locked = lockedRows[0];
            if (!locked) {
              throw new ProcessError("process_not_found", "Process not found.");
            }
            const snapshot = await loadSnapshot(transaction, input);
            if (!snapshot) {
              throw new ProcessError("process_not_found", "Process not found.");
            }
            if (snapshot.process.version !== input.expectedVersion) {
              throw new ProcessError(
                "version_conflict",
                "Process version changed.",
                {
                  currentVersion: snapshot.process.version,
                  projection: snapshot.projection,
                }
              );
            }
            const draft = mutate(snapshot);
            const updated = await transaction
              .update(processTable)
              .set(processUpdateValues(draft.snapshot.process))
              .where(
                and(
                  eq(processTable.id, input.processId),
                  eq(processTable.ownerId, input.ownerId),
                  eq(processTable.version, input.expectedVersion)
                )
              )
              .returning({ id: processTable.id });
            if (!updated[0]) {
              throw new ProcessError(
                "version_conflict",
                "Process version changed.",
                {
                  currentVersion: snapshot.process.version,
                  projection: snapshot.projection,
                }
              );
            }
            await persistDraft(transaction, draft);
            return draft.result;
          });
        } catch (error) {
          if (isUniqueViolation(error)) {
            const replay = await findMutationResult({
              mutationKey: input.mutationKey,
              ownerId: input.ownerId,
            });
            if (replay) {
              return replay;
            }
          }
          throw error;
        }
      });
    },

    readEvents(input) {
      return storeBoundary(async () => {
        const visible = await database()
          .select({ id: processTable.id })
          .from(processTable)
          .where(
            and(
              eq(processTable.id, input.processId),
              eq(processTable.ownerId, input.ownerId)
            )
          )
          .limit(1);
        if (!visible[0]) {
          return null;
        }
        const rows = await database()
          .select()
          .from(processEventTable)
          .where(
            and(
              eq(processEventTable.ownerId, input.ownerId),
              eq(processEventTable.processId, input.processId)
            )
          )
          .orderBy(desc(processEventTable.sequence))
          .limit(Math.max(1, Math.min(input.limit, 50)));
        return { items: rows.map(toProcessEvent), nextCursor: null };
      });
    },

    readSnapshot(input) {
      return storeBoundary(() => loadSnapshot(database(), input));
    },
  };
}
