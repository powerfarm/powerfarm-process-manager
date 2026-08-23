import {
  type GraphOperation,
  graphOperationBatchSchema,
  graphOperationSchema,
  type JsonValue,
  MAX_PROCESS_TAGS,
  type ProcessEdge,
  type ProcessEvent,
  type ProcessNode,
  type ProcessProjection,
  type ProcessStatus,
  type ProcessSummary,
  processStatusSchema,
} from "@/lib/processes/contracts";
import { ProcessError, toProcessError } from "@/lib/processes/errors";
import { projectProcess } from "@/lib/processes/projection";
import type {
  ProcessEventPage,
  ProcessGraphPage,
  ProcessListPage,
  ProcessMutationResult,
  ProcessRepository,
  ProcessSnapshot,
  ProcessCommandContext as RepositoryCommandContext,
} from "@/lib/processes/repository";

export type ProcessCommandContext = RepositoryCommandContext;

interface ServiceDependencies {
  readonly createId: () => string;
  readonly now: () => string;
}

interface OwnerProcessInput {
  readonly ownerId: string;
  readonly processId: string;
}

interface MutatingCommand {
  readonly context: ProcessCommandContext;
  readonly expectedVersion: number;
  readonly processId: string;
  readonly reason: string;
}

export interface ProcessService {
  readonly changeState: (
    input: MutatingCommand & { readonly status: ProcessStatus }
  ) => Promise<ProcessMutationResult>;
  readonly createProcess: (input: {
    readonly context: ProcessCommandContext;
    readonly initialOperations?: readonly GraphOperation[];
    readonly reason: string;
    readonly status?: ProcessStatus;
    readonly tags?: readonly string[];
    readonly title: string;
  }) => Promise<ProcessMutationResult>;
  readonly findProcesses: (input: {
    readonly limit: number;
    readonly ownerId: string;
    readonly query?: string;
  }) => Promise<ProcessListPage>;
  readonly inspectGraph: (
    input: OwnerProcessInput & {
      readonly kind?: string;
      readonly limit?: number;
      readonly nodeId?: string;
      readonly relation?: string;
    }
  ) => Promise<ProcessGraphPage | null>;
  readonly mutateGraph: (
    input: MutatingCommand & { readonly operations: readonly GraphOperation[] }
  ) => Promise<ProcessMutationResult>;
  readonly readHistory: (
    input: OwnerProcessInput & { readonly limit: number }
  ) => Promise<ProcessEventPage | null>;
  readonly readProcess: (
    input: OwnerProcessInput
  ) => Promise<ProcessSnapshot | null>;
  readonly rebuildProjection: (
    input: OwnerProcessInput
  ) => Promise<ProcessProjection | null>;
  readonly updateTags: (
    input: MutatingCommand & {
      readonly add: readonly string[];
      readonly remove: readonly string[];
    }
  ) => Promise<ProcessMutationResult>;
}

const DEFAULT_DEPENDENCIES: ServiceDependencies = {
  createId: () => crypto.randomUUID(),
  now: () => new Date().toISOString(),
};

const ALLOWED_STATUS_TRANSITIONS: Readonly<
  Record<ProcessStatus, readonly ProcessStatus[]>
> = {
  archived: ["in_progress"],
  blocked: ["in_progress", "waiting", "completed", "archived"],
  completed: ["in_progress", "archived"],
  in_progress: ["waiting", "blocked", "completed", "archived"],
  waiting: ["in_progress", "blocked", "completed", "archived"],
};

function mutationKey(context: ProcessCommandContext): string {
  return `${context.eveSessionId}:${context.turnId}:${context.callId}`;
}

function normalizedReason(reason: string): string {
  const normalized = reason.trim();
  if (!(normalized.length > 0 && normalized.length <= 500)) {
    throw new ProcessError(
      "invalid_graph_operation",
      "A mutation reason must contain between 1 and 500 characters."
    );
  }
  return normalized;
}

function normalizedTags(tags: readonly string[]): string[] {
  const normalized = [
    ...new Set(tags.map((tag) => tag.trim().toLowerCase()).filter(Boolean)),
  ].toSorted();
  if (
    normalized.length > MAX_PROCESS_TAGS ||
    normalized.some((tag) => !/^[a-z][a-z0-9_-]{0,63}$/.test(tag))
  ) {
    throw new ProcessError(
      "invalid_graph_operation",
      "Process tags must use the bounded lowercase tag grammar."
    );
  }
  return normalized;
}

function requireProcessId(processId: string): string {
  const normalized = processId.trim();
  if (!normalized) {
    throw new ProcessError("process_not_found", "Process not found.");
  }
  return normalized;
}

function copyProcess(
  process: ProcessSummary,
  changes: Partial<ProcessSummary>
): ProcessSummary {
  return { ...process, ...changes };
}

interface AppliedGraph {
  readonly affectedEdgeIds: readonly string[];
  readonly affectedNodeIds: readonly string[];
  readonly edges: readonly ProcessEdge[];
  readonly nodes: readonly ProcessNode[];
  readonly projectionSchema: ProcessSummary["projectionSchema"];
}

function graphFailure(message: string): never {
  throw new ProcessError("invalid_graph_operation", message);
}

function applyGraphOperations(input: {
  readonly edges: readonly ProcessEdge[];
  readonly now: string;
  readonly nodes: readonly ProcessNode[];
  readonly operations: readonly GraphOperation[];
  readonly process: ProcessSummary;
}): AppliedGraph {
  const nodes = [...input.nodes];
  let edges = [...input.edges];
  const columns = [...input.process.projectionSchema.columns];
  let projectionSchemaChanged = false;
  const affectedNodeIds = new Set<string>();
  const affectedEdgeIds = new Set<string>();

  for (const operation of input.operations) {
    switch (operation.op) {
      case "add_node": {
        if (nodes.some((node) => node.id === operation.nodeId)) {
          graphFailure(`Node ${operation.nodeId} already exists.`);
        }
        nodes.push({
          createdAt: input.now,
          id: operation.nodeId,
          kind: operation.kind,
          label: operation.label,
          metadata: operation.metadata,
          processId: input.process.id,
          tombstonedAt: null,
          updatedAt: input.now,
        });
        affectedNodeIds.add(operation.nodeId);
        break;
      }
      case "update_node": {
        const index = nodes.findIndex(
          (node) => node.id === operation.nodeId && node.tombstonedAt === null
        );
        if (index < 0) {
          graphFailure(`Node ${operation.nodeId} is not live in this process.`);
        }
        const current = nodes[index];
        if (!current) {
          graphFailure(`Node ${operation.nodeId} is not live in this process.`);
        }
        nodes[index] = {
          ...current,
          ...(operation.kind === undefined ? {} : { kind: operation.kind }),
          ...(operation.label === undefined ? {} : { label: operation.label }),
          ...(operation.metadata === undefined
            ? {}
            : { metadata: { ...current.metadata, ...operation.metadata } }),
          updatedAt: input.now,
        };
        affectedNodeIds.add(operation.nodeId);
        break;
      }
      case "tombstone_node": {
        const index = nodes.findIndex(
          (node) => node.id === operation.nodeId && node.tombstonedAt === null
        );
        if (index < 0) {
          graphFailure(`Node ${operation.nodeId} is not live in this process.`);
        }
        const current = nodes[index];
        if (!current) {
          graphFailure(`Node ${operation.nodeId} is not live in this process.`);
        }
        nodes[index] = {
          ...current,
          tombstonedAt: input.now,
          updatedAt: input.now,
        };
        edges = edges.map((edge) => {
          if (
            edge.tombstonedAt === null &&
            (edge.sourceNodeId === operation.nodeId ||
              edge.targetNodeId === operation.nodeId)
          ) {
            affectedEdgeIds.add(edge.id);
            return {
              ...edge,
              tombstonedAt: input.now,
              updatedAt: input.now,
            };
          }
          return edge;
        });
        affectedNodeIds.add(operation.nodeId);
        break;
      }
      case "link_nodes": {
        if (edges.some((edge) => edge.id === operation.edgeId)) {
          graphFailure(`Edge ${operation.edgeId} already exists.`);
        }
        const source = nodes.find(
          (node) =>
            node.id === operation.sourceNodeId && node.tombstonedAt === null
        );
        const target = nodes.find(
          (node) =>
            node.id === operation.targetNodeId && node.tombstonedAt === null
        );
        if (!(source && target)) {
          graphFailure(
            "Both edge endpoints must be live nodes in this process."
          );
        }
        edges.push({
          createdAt: input.now,
          id: operation.edgeId,
          metadata: operation.metadata,
          processId: input.process.id,
          relation: operation.relation,
          sourceNodeId: operation.sourceNodeId,
          targetNodeId: operation.targetNodeId,
          tombstonedAt: null,
          updatedAt: input.now,
        });
        affectedEdgeIds.add(operation.edgeId);
        break;
      }
      case "unlink_nodes": {
        const index = edges.findIndex(
          (edge) => edge.id === operation.edgeId && edge.tombstonedAt === null
        );
        if (index < 0) {
          graphFailure(`Edge ${operation.edgeId} is not live in this process.`);
        }
        const current = edges[index];
        if (!current) {
          graphFailure(`Edge ${operation.edgeId} is not live in this process.`);
        }
        edges[index] = {
          ...current,
          tombstonedAt: input.now,
          updatedAt: input.now,
        };
        affectedEdgeIds.add(operation.edgeId);
        break;
      }
      case "define_projection_column": {
        const index = columns.findIndex(
          (column) => column.key === operation.column.key
        );
        if (index >= 0) {
          columns[index] = operation.column;
        } else {
          columns.push(operation.column);
        }
        projectionSchemaChanged = true;
        break;
      }
      default: {
        const exhaustiveOperation: never = operation;
        graphFailure(`Unknown graph operation: ${String(exhaustiveOperation)}`);
      }
    }
  }

  return {
    affectedEdgeIds: [...affectedEdgeIds],
    affectedNodeIds: [...affectedNodeIds],
    edges,
    nodes,
    projectionSchema: {
      columns: columns.toSorted(
        (left, right) =>
          left.position - right.position || left.key.localeCompare(right.key)
      ),
      version:
        input.process.projectionSchema.version +
        (projectionSchemaChanged ? 1 : 0),
    },
  };
}

function eventPayload(
  value: Readonly<Record<string, JsonValue>>
): Readonly<Record<string, JsonValue>> {
  return value;
}

export function createProcessService(
  repository: ProcessRepository,
  dependencies: ServiceDependencies = DEFAULT_DEPENDENCIES
): ProcessService {
  async function commitMutation(input: {
    readonly command: MutatingCommand;
    readonly operationSummary: string;
    readonly operationType: string;
    readonly payload: Readonly<Record<string, JsonValue>>;
    readonly transform: (
      snapshot: ProcessSnapshot,
      now: string
    ) => {
      readonly affectedEdgeIds?: readonly string[];
      readonly affectedNodeIds?: readonly string[];
      readonly edges?: readonly ProcessEdge[];
      readonly nodes?: readonly ProcessNode[];
      readonly process: ProcessSummary;
    };
  }): Promise<ProcessMutationResult> {
    const processId = requireProcessId(input.command.processId);
    const reason = normalizedReason(input.command.reason);
    const key = mutationKey(input.command.context);
    const now = dependencies.now();

    try {
      return await repository.mutateProcess(
        {
          context: input.command.context,
          expectedVersion: input.command.expectedVersion,
          mutationKey: key,
          now,
          ownerId: input.command.context.ownerId,
          processId,
        },
        (snapshot) => {
          const changed = input.transform(snapshot, now);
          const process = copyProcess(changed.process, {
            updatedAt: now,
            version: snapshot.process.version + 1,
          });
          const nodes = changed.nodes ?? snapshot.nodes;
          const edges = changed.edges ?? snapshot.edges;
          const projection = projectProcess({
            columns: process.projectionSchema.columns,
            edges,
            nodes,
            process,
          });
          const eventId = dependencies.createId();
          const result: ProcessMutationResult = {
            active: true,
            affectedEdgeIds: [...(changed.affectedEdgeIds ?? [])],
            affectedNodeIds: [...(changed.affectedNodeIds ?? [])],
            eventId,
            mutationKey: key,
            operationSummary: input.operationSummary,
            process,
            projection,
            version: process.version,
          };
          const event: ProcessEvent = {
            callId: input.command.context.callId,
            createdAt: now,
            eveSessionId: input.command.context.eveSessionId,
            id: eventId,
            mutationKey: key,
            operationType: input.operationType,
            ownerId: input.command.context.ownerId,
            payload: eventPayload({
              ...input.payload,
              result: result as unknown as JsonValue,
            }),
            processId,
            processVersion: process.version,
            reason,
            sequence: process.version,
            toolName: input.command.context.toolName,
            turnId: input.command.context.turnId,
            turnSequence: input.command.context.turnSequence,
          };
          return {
            event,
            result,
            snapshot: { edges, nodes, process, projection },
          };
        }
      );
    } catch (error) {
      throw toProcessError(error);
    }
  }

  return {
    async changeState(input) {
      const status = processStatusSchema.parse(input.status);
      return commitMutation({
        command: input,
        operationSummary: `Changed process state to ${status}.`,
        operationType: "change_process_state",
        payload: eventPayload({ status }),
        transform(snapshot, now) {
          if (
            !ALLOWED_STATUS_TRANSITIONS[snapshot.process.status].includes(
              status
            )
          ) {
            graphFailure(
              `Cannot move from ${snapshot.process.status} to ${status}.`
            );
          }
          return {
            process: copyProcess(snapshot.process, {
              archivedAt: status === "archived" ? now : null,
              status,
            }),
          };
        },
      });
    },

    async createProcess(input) {
      const title = input.title.trim();
      if (!(title.length > 0 && title.length <= 240)) {
        throw new ProcessError(
          "invalid_graph_operation",
          "A process title must contain between 1 and 240 characters."
        );
      }
      const reason = normalizedReason(input.reason);
      const tags = normalizedTags(input.tags ?? []);
      const status = processStatusSchema.parse(input.status ?? "in_progress");
      if (status !== "in_progress") {
        throw new ProcessError(
          "invalid_graph_operation",
          "A new process must start in progress."
        );
      }
      const initialOperations = input.initialOperations?.length
        ? graphOperationBatchSchema.parse(input.initialOperations)
        : [];
      const rootOperation = graphOperationSchema.parse({
        kind: "process_root",
        label: title,
        metadata: {},
        nodeId: dependencies.createId(),
        op: "add_node",
      });
      const operations = [rootOperation, ...initialOperations];
      const processId = dependencies.createId();
      const eventId = dependencies.createId();
      const now = dependencies.now();
      const key = mutationKey(input.context);

      try {
        return await repository.createProcess(
          {
            context: input.context,
            mutationKey: key,
            now,
            processId,
            title,
          },
          (created) => {
            const base = copyProcess(created, { status, tags, title });
            const applied = applyGraphOperations({
              edges: [],
              nodes: [],
              now,
              operations,
              process: base,
            });
            const process = copyProcess(base, {
              projectionSchema: applied.projectionSchema,
            });
            const projection = projectProcess({
              columns: process.projectionSchema.columns,
              edges: applied.edges,
              nodes: applied.nodes,
              process,
            });
            const result: ProcessMutationResult = {
              active: true,
              affectedEdgeIds: [...applied.affectedEdgeIds],
              affectedNodeIds: [...applied.affectedNodeIds],
              eventId,
              mutationKey: key,
              operationSummary: "Created and activated the process.",
              process,
              projection,
              version: process.version,
            };
            return {
              event: {
                callId: input.context.callId,
                createdAt: now,
                eveSessionId: input.context.eveSessionId,
                id: eventId,
                mutationKey: key,
                operationType: "create_process",
                ownerId: input.context.ownerId,
                payload: eventPayload({
                  operations: operations as unknown as JsonValue,
                  result: result as unknown as JsonValue,
                }),
                processId,
                processVersion: process.version,
                reason,
                sequence: process.version,
                toolName: input.context.toolName,
                turnId: input.context.turnId,
                turnSequence: input.context.turnSequence,
              },
              result,
              snapshot: {
                edges: applied.edges,
                nodes: applied.nodes,
                process,
                projection,
              },
            };
          }
        );
      } catch (error) {
        throw toProcessError(error);
      }
    },

    findProcesses(input) {
      return repository.findProcesses(input);
    },

    inspectGraph(input) {
      return repository.inspectGraph(input);
    },

    async mutateGraph(input) {
      const operations = graphOperationBatchSchema.parse(input.operations);
      return commitMutation({
        command: input,
        operationSummary: `Applied ${operations.length} graph operation${operations.length === 1 ? "" : "s"}.`,
        operationType: "mutate_process_graph",
        payload: eventPayload({
          operations: operations as unknown as JsonValue,
        }),
        transform(snapshot, now) {
          const applied = applyGraphOperations({
            edges: snapshot.edges,
            nodes: snapshot.nodes,
            now,
            operations,
            process: snapshot.process,
          });
          return {
            affectedEdgeIds: applied.affectedEdgeIds,
            affectedNodeIds: applied.affectedNodeIds,
            edges: applied.edges,
            nodes: applied.nodes,
            process: copyProcess(snapshot.process, {
              projectionSchema: applied.projectionSchema,
            }),
          };
        },
      });
    },

    readHistory(input) {
      return repository.readEvents(input);
    },

    readProcess(input) {
      return repository.readSnapshot(input);
    },

    async rebuildProjection(input) {
      const snapshot = await repository.readSnapshot(input);
      return snapshot
        ? projectProcess({
            columns: snapshot.process.projectionSchema.columns,
            edges: snapshot.edges,
            nodes: snapshot.nodes,
            process: snapshot.process,
          })
        : null;
    },

    async updateTags(input) {
      const add = normalizedTags(input.add);
      const remove = new Set(normalizedTags(input.remove));
      return commitMutation({
        command: input,
        operationSummary: "Updated process tags.",
        operationType: "update_process_tags",
        payload: eventPayload({ add, remove: [...remove] }),
        transform(snapshot) {
          return {
            process: copyProcess(snapshot.process, {
              tags: normalizedTags([
                ...snapshot.process.tags.filter((tag) => !remove.has(tag)),
                ...add,
              ]),
            }),
          };
        },
      });
    },
  };
}
