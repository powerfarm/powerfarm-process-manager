import { defineTool, type ToolContext, toolOutput } from "eve/tools";
import { z } from "zod";
import {
  type ActiveProcessState,
  activeProcessState,
  PROCESS_EVENT_PAGE_SIZE,
  PROCESS_GRAPH_PAGE_SIZE,
  PROCESS_SEARCH_LIMIT,
} from "#lib/processes/config.js";
import {
  graphOperationSchema,
  PROCESS_STATUS_LABELS,
  processEdgeSchema,
  processEventSchema,
  processNodeSchema,
  processProjectionSchema,
  processSummarySchema,
  processToolResultSchema,
} from "@/lib/processes/contracts";
import { ProcessError } from "@/lib/processes/errors";
import { formatProcessNumber } from "@/lib/processes/format";
import { createDrizzleProcessRepository } from "@/lib/processes/repository";
import {
  createProcessService,
  type ProcessCommandContext,
  type ProcessService,
} from "@/lib/processes/service";

export interface ProcessBinding {
  readonly get: () => ActiveProcessState;
  readonly update: (
    update: (current: ActiveProcessState) => ActiveProcessState
  ) => void;
}

interface ProcessToolDependencies {
  readonly binding: ProcessBinding;
  readonly service: ProcessService;
}

const processReadResultSchema = z
  .object({
    process: processSummarySchema.nullable(),
    projection: processProjectionSchema.nullable(),
  })
  .strict();

const processListResultSchema = z
  .object({
    items: z.array(processSummarySchema),
    nextCursor: z.string().nullable(),
  })
  .strict();

const processGraphResultSchema = z
  .object({
    edges: z.array(processEdgeSchema),
    nextCursor: z.string().nullable(),
    nodes: z.array(processNodeSchema),
    processId: z.string(),
  })
  .strict();

const processHistoryResultSchema = z
  .object({
    items: z.array(processEventSchema),
    nextCursor: z.string().nullable(),
    processId: z.string(),
  })
  .strict();

const optionalProcessIdSchema = z.object({
  processId: z
    .string()
    .min(1)
    .max(128)
    .optional()
    .describe(
      "Process id to read. Omit it to use the process active in this session."
    ),
});

function requireOwner(ctx: ToolContext): string {
  const principal = ctx.session.auth.current;
  if (principal?.principalType !== "user" || !principal.principalId) {
    throw new ProcessError(
      "process_not_found",
      "An authenticated user is required for process memory."
    );
  }
  return principal.principalId;
}

function commandContext(ctx: ToolContext): ProcessCommandContext {
  return {
    callId: ctx.callId,
    eveSessionId: ctx.session.id,
    ownerId: requireOwner(ctx),
    toolName: ctx.toolName,
    turnId: ctx.session.turn.id,
    turnSequence: ctx.session.turn.sequence,
  };
}

function processIdOrActive(
  binding: ProcessBinding,
  explicitProcessId: string | undefined
): string {
  const processId = explicitProcessId?.trim() || binding.get().processId;
  if (!processId) {
    throw new ProcessError(
      "process_not_found",
      "No process is active in this session."
    );
  }
  return processId;
}

function bindProcess(
  binding: ProcessBinding,
  processId: string,
  projectionVersion: number
) {
  binding.update(() => ({ processId, projectionVersion }));
}

function compactProcessOutput(result: {
  readonly process: z.infer<typeof processSummarySchema> | null;
  readonly version: number | null;
}) {
  if (!result.process || result.version === null) {
    return toolOutput.text("No process is active.");
  }
  return toolOutput.text(
    `Process ${formatProcessNumber(result.process.number)} is ${PROCESS_STATUS_LABELS[result.process.status]} at version ${result.version}.`
  );
}

export function buildProcessTools({
  binding,
  service,
}: ProcessToolDependencies) {
  const findProcesses = defineTool({
    description:
      "Find processes owned by the current authenticated person by exact process number or title text. Use this before activation when the person names an existing process but does not provide its internal id.",
    async execute(input, ctx) {
      return processListResultSchema.parse(
        await service.findProcesses({
          limit: input.limit,
          ownerId: requireOwner(ctx),
          query: input.query,
        })
      );
    },
    inputSchema: z.object({
      limit: z.number().int().min(1).max(PROCESS_SEARCH_LIMIT).default(20),
      query: z.string().trim().min(1).max(240).optional(),
    }),
    outputSchema: processListResultSchema,
    toModelOutput(result) {
      return toolOutput.text(
        result.items.length === 0
          ? "No matching process was found."
          : result.items
              .map(
                (process) =>
                  `${formatProcessNumber(process.number)}: ${process.title} (${PROCESS_STATUS_LABELS[process.status]}, version ${process.version})`
              )
              .join("\n")
      );
    },
  });

  const createProcess = defineTool({
    description:
      "Create and activate one durable process after the person and lead explicitly agree to begin it. Do not use during ordinary brainstorming or to silently turn a topic into a process.",
    async execute(input, ctx) {
      const result = processToolResultSchema.parse(
        await service.createProcess({
          context: commandContext(ctx),
          initialOperations: input.initialOperations,
          reason: input.reason,
          tags: input.tags,
          title: input.title,
        })
      );
      if (!(result.process && result.projection)) {
        throw new ProcessError(
          "process_store_unavailable",
          "Process memory is temporarily unavailable."
        );
      }
      bindProcess(
        binding,
        result.process.id,
        result.projection.projectionVersion
      );
      return result;
    },
    inputSchema: z.object({
      initialOperations: z.array(graphOperationSchema).max(20).default([]),
      reason: z
        .string()
        .trim()
        .min(1)
        .max(500)
        .describe(
          "Concise record of the explicit conversational agreement to begin."
        ),
      tags: z.array(z.string().min(1).max(64)).max(20).default([]),
      title: z.string().trim().min(1).max(240),
    }),
    outputSchema: processToolResultSchema,
    toModelOutput: compactProcessOutput,
  });

  const activateProcess = defineTool({
    description:
      "Activate an existing authorized process in this Eve session after the person asks to work with or consult it. Activation does not reopen or otherwise mutate the process.",
    async execute({ processId }, ctx) {
      const snapshot = await service.readProcess({
        ownerId: requireOwner(ctx),
        processId,
      });
      if (!snapshot) {
        throw new ProcessError("process_not_found", "Process not found.");
      }
      bindProcess(
        binding,
        snapshot.process.id,
        snapshot.projection.projectionVersion
      );
      return processToolResultSchema.parse({
        active: true,
        affectedEdgeIds: [],
        affectedNodeIds: [],
        eventId: null,
        mutationKey: null,
        operationSummary: "Activated the process in this session.",
        process: snapshot.process,
        projection: snapshot.projection,
        version: snapshot.process.version,
      });
    },
    inputSchema: z.object({ processId: z.string().min(1).max(128) }),
    outputSchema: processToolResultSchema,
    toModelOutput: compactProcessOutput,
  });

  const deactivateProcess = defineTool({
    description:
      "Turn off the current session's process binding and return to brainstorm mode after the person asks. This does not change process status or delete any process data.",
    execute() {
      binding.update(() => ({ processId: null, projectionVersion: null }));
      return processToolResultSchema.parse({
        active: false,
        affectedEdgeIds: [],
        affectedNodeIds: [],
        eventId: null,
        mutationKey: null,
        operationSummary: "Returned this session to brainstorm mode.",
        process: null,
        projection: null,
        version: null,
      });
    },
    inputSchema: z.object({}),
    outputSchema: processToolResultSchema,
    toModelOutput: compactProcessOutput,
  });

  const readProcess = defineTool({
    description:
      "Read the current envelope and human projection of an authorized process. Omit processId to consult the process active in this session.",
    async execute({ processId }, ctx) {
      const snapshot = await service.readProcess({
        ownerId: requireOwner(ctx),
        processId: processIdOrActive(binding, processId),
      });
      return processReadResultSchema.parse(
        snapshot
          ? { process: snapshot.process, projection: snapshot.projection }
          : { process: null, projection: null }
      );
    },
    inputSchema: optionalProcessIdSchema,
    outputSchema: processReadResultSchema,
    toModelOutput(result) {
      return result.process
        ? toolOutput.text(
            `${formatProcessNumber(result.process.number)}: ${result.process.title}, ${PROCESS_STATUS_LABELS[result.process.status]}, version ${result.process.version}.`
          )
        : toolOutput.text("Process not found.");
    },
  });

  const inspectProcessGraph = defineTool({
    description:
      "Read one bounded current graph slice for an authorized process. Use filters and pagination instead of requesting the whole graph.",
    async execute(input, ctx) {
      const processId = processIdOrActive(binding, input.processId);
      const page = await service.inspectGraph({
        kind: input.kind,
        limit: input.limit,
        nodeId: input.nodeId,
        ownerId: requireOwner(ctx),
        processId,
        relation: input.relation,
      });
      if (!page) {
        throw new ProcessError("process_not_found", "Process not found.");
      }
      return processGraphResultSchema.parse({ ...page, processId });
    },
    inputSchema: optionalProcessIdSchema.extend({
      kind: z.string().min(1).max(64).optional(),
      limit: z.number().int().min(1).max(PROCESS_GRAPH_PAGE_SIZE).default(50),
      nodeId: z.string().min(1).max(128).optional(),
      relation: z.string().min(1).max(64).optional(),
    }),
    outputSchema: processGraphResultSchema,
    toModelOutput(result) {
      return toolOutput.json(result);
    },
  });

  const readProcessHistory = defineTool({
    description:
      "Read one bounded page of immutable events for an authorized process. Omit processId to use the active process.",
    async execute(input, ctx) {
      const processId = processIdOrActive(binding, input.processId);
      const page = await service.readHistory({
        limit: input.limit,
        ownerId: requireOwner(ctx),
        processId,
      });
      if (!page) {
        throw new ProcessError("process_not_found", "Process not found.");
      }
      return processHistoryResultSchema.parse({ ...page, processId });
    },
    inputSchema: optionalProcessIdSchema.extend({
      limit: z.number().int().min(1).max(PROCESS_EVENT_PAGE_SIZE).default(50),
    }),
    outputSchema: processHistoryResultSchema,
    toModelOutput(result) {
      return toolOutput.json(result);
    },
  });

  return {
    activateProcess,
    createProcess,
    deactivateProcess,
    findProcesses,
    inspectProcessGraph,
    readProcess,
    readProcessHistory,
  };
}

const defaultProcessService = createProcessService(
  createDrizzleProcessRepository()
);

export const processTools = buildProcessTools({
  binding: activeProcessState,
  service: defaultProcessService,
});
