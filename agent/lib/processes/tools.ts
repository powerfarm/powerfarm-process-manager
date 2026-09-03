import { defineTool, type ToolContext, toolOutput } from "eve/tools";
import { z } from "zod";
import {
  createGitHubArtifactObserver,
  type GitHubArtifactObserver,
} from "#lib/github/artifact-observer.js";
import { POWERFARM_PLANNING_REPOSITORY } from "#lib/github/config.js";
import {
  type ActiveProcessState,
  activeProcessState,
  PROCESS_EVENT_PAGE_SIZE,
  PROCESS_GRAPH_PAGE_SIZE,
  PROCESS_SEARCH_LIMIT,
} from "#lib/processes/config.js";
import {
  graphOperationBatchSchema,
  graphOperationSchema,
  MAX_PROCESS_TAGS,
  PROCESS_STATUS_LABELS,
  processEdgeSchema,
  processEventSchema,
  processNodeSchema,
  processProjectionSchema,
  processStatusSchema,
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
  readonly artifactObserver?: GitHubArtifactObserver;
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

const GITHUB_REPOSITORY_PATTERN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

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

function compactMutationOutput(result: {
  readonly operationSummary: string;
  readonly process: z.infer<typeof processSummarySchema> | null;
  readonly version: number | null;
}) {
  if (!result.process || result.version === null) {
    return toolOutput.text("Process mutation did not commit.");
  }
  return toolOutput.text(
    `${formatProcessNumber(result.process.number)} is ${PROCESS_STATUS_LABELS[result.process.status]} at version ${result.version}. ${result.operationSummary}`
  );
}

function committedToolResult(
  binding: ProcessBinding,
  candidate: unknown
): z.infer<typeof processToolResultSchema> {
  const result = processToolResultSchema.parse(candidate);
  if (!(result.process && result.projection && result.version !== null)) {
    throw new ProcessError(
      "process_store_unavailable",
      "Process memory is temporarily unavailable."
    );
  }
  bindProcess(binding, result.process.id, result.projection.projectionVersion);
  return result;
}

export function buildProcessTools({
  artifactObserver = createGitHubArtifactObserver(),
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

  const mutateProcessGraph = defineTool({
    description:
      "Apply one bounded batch of typed operations to the active authorized process graph. Never use arbitrary patches, paths, ownership fields, provenance fields, or caller-selected mutation keys.",
    async execute(input, ctx) {
      return committedToolResult(
        binding,
        await service.mutateGraph({
          context: commandContext(ctx),
          expectedVersion: input.expectedVersion,
          operations: input.operations,
          processId: processIdOrActive(binding, input.processId),
          reason: input.reason,
        })
      );
    },
    inputSchema: optionalProcessIdSchema
      .extend({
        expectedVersion: z.number().int().nonnegative(),
        operations: graphOperationBatchSchema,
        reason: z.string().trim().min(1).max(500),
      })
      .strict(),
    outputSchema: processToolResultSchema,
    toModelOutput: compactMutationOutput,
  });

  const observeProcessArtifact = defineTool({
    description:
      "Resolve one authorized GitHub file to an immutable commit and content digest, read its pull request, review, and check state, then commit that server-observed provenance to the active Process graph. Never copy a SHA from model text into the graph.",
    async execute(input, ctx) {
      const artifact = await artifactObserver.observe({
        path: input.path,
        repository: input.repository,
        requestedRef: input.requestedRef,
      });
      return committedToolResult(
        binding,
        await service.observeArtifact({
          artifact,
          context: commandContext(ctx),
          expectedVersion: input.expectedVersion,
          label: input.label,
          nodeId: input.nodeId,
          processId: processIdOrActive(binding, input.processId),
          reason: input.reason,
        })
      );
    },
    inputSchema: optionalProcessIdSchema
      .extend({
        expectedVersion: z.number().int().nonnegative(),
        label: z.string().trim().min(1).max(240).optional(),
        nodeId: z.string().trim().min(1).max(128),
        path: z.string().trim().min(1).max(1024),
        reason: z.string().trim().min(1).max(500),
        repository: z
          .string()
          .trim()
          .regex(GITHUB_REPOSITORY_PATTERN)
          .default(POWERFARM_PLANNING_REPOSITORY),
        requestedRef: z.string().trim().min(1).max(256).default("main"),
      })
      .strict(),
    outputSchema: processToolResultSchema,
    toModelOutput: compactMutationOutput,
  });

  const changeProcessState = defineTool({
    description:
      "Commit an explicitly agreed durable process state. Use only in_progress, waiting, blocked, completed, or archived; transient execution activity is not process state.",
    async execute(input, ctx) {
      return committedToolResult(
        binding,
        await service.changeState({
          context: commandContext(ctx),
          expectedVersion: input.expectedVersion,
          processId: processIdOrActive(binding, input.processId),
          reason: input.reason,
          status: input.status,
        })
      );
    },
    inputSchema: optionalProcessIdSchema
      .extend({
        expectedVersion: z.number().int().nonnegative(),
        reason: z
          .string()
          .trim()
          .min(1)
          .max(500)
          .describe("Concise note recording the explicit agreement."),
        status: processStatusSchema,
      })
      .strict(),
    outputSchema: processToolResultSchema,
    toModelOutput: compactMutationOutput,
  });

  const processTagSchema = processSummarySchema.shape.tags.element;
  const updateProcessTagsInputSchema = optionalProcessIdSchema
    .extend({
      add: z.array(processTagSchema).max(MAX_PROCESS_TAGS).default([]),
      expectedVersion: z.number().int().nonnegative(),
      reason: z
        .string()
        .trim()
        .min(1)
        .max(500)
        .describe("Concise note recording the explicit agreement."),
      remove: z.array(processTagSchema).max(MAX_PROCESS_TAGS).default([]),
    })
    .strict()
    .superRefine((input, context) => {
      if (new Set(input.add).size !== input.add.length) {
        context.addIssue({
          code: "custom",
          message: "add tags must be unique",
        });
      }
      if (new Set(input.remove).size !== input.remove.length) {
        context.addIssue({
          code: "custom",
          message: "remove tags must be unique",
        });
      }
      const removed = new Set(input.remove);
      if (input.add.some((tag) => removed.has(tag))) {
        context.addIssue({
          code: "custom",
          message: "a tag cannot be added and removed in one mutation",
        });
      }
    });

  const updateProcessTags = defineTool({
    description:
      "Add and remove explicitly agreed tags on the active authorized process without replacing unrelated tags.",
    async execute(input, ctx) {
      return committedToolResult(
        binding,
        await service.updateTags({
          add: input.add,
          context: commandContext(ctx),
          expectedVersion: input.expectedVersion,
          processId: processIdOrActive(binding, input.processId),
          reason: input.reason,
          remove: input.remove,
        })
      );
    },
    inputSchema: updateProcessTagsInputSchema,
    outputSchema: processToolResultSchema,
    toModelOutput: compactMutationOutput,
  });

  return {
    activateProcess,
    changeProcessState,
    createProcess,
    deactivateProcess,
    findProcesses,
    inspectProcessGraph,
    mutateProcessGraph,
    observeProcessArtifact,
    readProcess,
    readProcessHistory,
    updateProcessTags,
  };
}

const defaultProcessService = createProcessService(
  createDrizzleProcessRepository()
);

export const processTools = buildProcessTools({
  binding: activeProcessState,
  service: defaultProcessService,
});
