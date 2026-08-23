import { z } from "zod";

export const MAX_GRAPH_METADATA_BYTES = 16_384;
export const MAX_GRAPH_OPERATIONS = 20;
export const MAX_PROCESS_TAGS = 20;

const identifierSchema = z.string().trim().min(1).max(128);
const slugSchema = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .regex(/^[a-z][a-z0-9_-]*$/);
const timestampSchema = z.iso.datetime();

export type JsonValue =
  | boolean
  | null
  | number
  | string
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue };

const jsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.string(),
    z.number().finite(),
    z.boolean(),
    z.null(),
    z.array(jsonValueSchema),
    z.record(z.string(), jsonValueSchema),
  ])
);

export const graphMetadataSchema = z
  .record(slugSchema, jsonValueSchema)
  .superRefine((metadata, context) => {
    const serialized = JSON.stringify(metadata);
    if (
      new TextEncoder().encode(serialized).byteLength > MAX_GRAPH_METADATA_BYTES
    ) {
      context.addIssue({
        code: "custom",
        message: `Metadata must not exceed ${MAX_GRAPH_METADATA_BYTES} serialized bytes`,
      });
    }
  });

export const processStatusSchema = z.enum([
  "in_progress",
  "waiting",
  "blocked",
  "completed",
  "archived",
]);

export const projectionValueTypeSchema = z.enum([
  "text",
  "number",
  "boolean",
  "date",
  "list",
  "status",
  "json",
]);

export const projectionEmphasisSchema = z.enum(["muted", "normal", "strong"]);

const processFieldSelectorSchema = z
  .object({
    field: z.enum(["number", "title", "status", "tags", "updatedAt"]),
    selector: z.literal("process_field"),
  })
  .strict();

const nodeMetadataSelectorSchema = z
  .object({
    key: slugSchema,
    kind: slugSchema.optional(),
    nodeId: identifierSchema.optional(),
    selector: z.literal("node_metadata"),
  })
  .strict()
  .refine((selector) => Boolean(selector.nodeId || selector.kind), {
    message: "A node metadata selector requires nodeId or kind",
  });

const latestNodeValueSelectorSchema = z
  .object({
    key: slugSchema,
    kind: slugSchema,
    selector: z.literal("latest_node_value"),
  })
  .strict();

const nodeCountSelectorSchema = z
  .object({
    entity: z.enum(["node", "edge"]),
    kind: slugSchema.optional(),
    limit: z.number().int().min(1).max(10_000),
    relation: slugSchema.optional(),
    selector: z.literal("node_count"),
  })
  .strict()
  .superRefine((selector, context) => {
    if (selector.entity === "node" && selector.relation) {
      context.addIssue({
        code: "custom",
        message: "Node counts cannot filter by relation",
      });
    }
    if (selector.entity === "edge" && selector.kind) {
      context.addIssue({
        code: "custom",
        message: "Edge counts cannot filter by node kind",
      });
    }
  });

export const projectionSelectorSchema = z.discriminatedUnion("selector", [
  processFieldSelectorSchema,
  nodeMetadataSelectorSchema,
  latestNodeValueSelectorSchema,
  nodeCountSelectorSchema,
]);

export const projectionColumnDefinitionSchema = z
  .object({
    emphasis: projectionEmphasisSchema,
    key: slugSchema,
    label: z.string().trim().min(1).max(120),
    position: z.number().int().min(0).max(1000),
    selector: projectionSelectorSchema,
    valueType: projectionValueTypeSchema,
  })
  .strict();

export const projectionSchemaSchema = z
  .object({
    columns: z.array(projectionColumnDefinitionSchema).max(50),
    version: z.number().int().positive(),
  })
  .strict();

const addNodeOperationSchema = z
  .object({
    kind: slugSchema,
    label: z.string().trim().min(1).max(240),
    metadata: graphMetadataSchema.default({}),
    nodeId: identifierSchema,
    op: z.literal("add_node"),
  })
  .strict();

const updateNodeOperationSchema = z
  .object({
    kind: slugSchema.optional(),
    label: z.string().trim().min(1).max(240).optional(),
    metadata: graphMetadataSchema.optional(),
    nodeId: identifierSchema,
    op: z.literal("update_node"),
  })
  .strict()
  .refine(
    (operation) =>
      operation.kind !== undefined ||
      operation.label !== undefined ||
      operation.metadata !== undefined,
    { message: "An update_node operation must change at least one field" }
  );

const tombstoneNodeOperationSchema = z
  .object({
    nodeId: identifierSchema,
    op: z.literal("tombstone_node"),
  })
  .strict();

const linkNodesOperationSchema = z
  .object({
    edgeId: identifierSchema,
    metadata: graphMetadataSchema.default({}),
    op: z.literal("link_nodes"),
    relation: slugSchema,
    sourceNodeId: identifierSchema,
    targetNodeId: identifierSchema,
  })
  .strict()
  .refine((operation) => operation.sourceNodeId !== operation.targetNodeId, {
    message: "An edge must connect two different nodes",
  });

const unlinkNodesOperationSchema = z
  .object({
    edgeId: identifierSchema,
    op: z.literal("unlink_nodes"),
  })
  .strict();

const defineProjectionColumnOperationSchema = z
  .object({
    column: projectionColumnDefinitionSchema,
    op: z.literal("define_projection_column"),
  })
  .strict();

export const graphOperationSchema = z.discriminatedUnion("op", [
  addNodeOperationSchema,
  updateNodeOperationSchema,
  tombstoneNodeOperationSchema,
  linkNodesOperationSchema,
  unlinkNodesOperationSchema,
  defineProjectionColumnOperationSchema,
]);

export const graphOperationBatchSchema = z
  .array(graphOperationSchema)
  .min(1)
  .max(MAX_GRAPH_OPERATIONS);

export const processSummarySchema = z
  .object({
    archivedAt: timestampSchema.nullable(),
    createdAt: timestampSchema,
    graphSchemaVersion: z.number().int().positive(),
    id: identifierSchema,
    number: z.number().int().positive(),
    ownerId: identifierSchema,
    projectionSchema: projectionSchemaSchema,
    status: processStatusSchema,
    tags: z.array(slugSchema).max(MAX_PROCESS_TAGS),
    title: z.string().trim().min(1).max(240),
    updatedAt: timestampSchema,
    version: z.number().int().nonnegative(),
  })
  .strict();

export const processNodeSchema = z
  .object({
    createdAt: timestampSchema,
    id: identifierSchema,
    kind: slugSchema,
    label: z.string().trim().min(1).max(240),
    metadata: graphMetadataSchema,
    processId: identifierSchema,
    tombstonedAt: timestampSchema.nullable(),
    updatedAt: timestampSchema,
  })
  .strict();

export const processEdgeSchema = z
  .object({
    createdAt: timestampSchema,
    id: identifierSchema,
    metadata: graphMetadataSchema,
    processId: identifierSchema,
    relation: slugSchema,
    sourceNodeId: identifierSchema,
    targetNodeId: identifierSchema,
    tombstonedAt: timestampSchema.nullable(),
    updatedAt: timestampSchema,
  })
  .strict();

export const projectedColumnSchema = projectionColumnDefinitionSchema
  .omit({ selector: true })
  .extend({ value: jsonValueSchema.nullable() })
  .strict();

export const processProjectionSchema = z
  .object({
    blockers: z.array(z.string()),
    columns: z.array(projectedColumnSchema),
    generatedAt: timestampSchema,
    metrics: z
      .object({
        liveEdges: z.number().int().nonnegative(),
        liveMetadataFields: z.number().int().nonnegative(),
        liveNodes: z.number().int().nonnegative(),
      })
      .strict(),
    nextAction: z.string().nullable(),
    pendingItems: z.array(z.string()),
    processId: identifierSchema,
    processNumber: z.number().int().positive(),
    projectionVersion: z.number().int().positive(),
    sourceProcessVersion: z.number().int().nonnegative(),
    status: processStatusSchema,
    summary: z.string().nullable(),
    tags: z.array(slugSchema),
    title: z.string(),
  })
  .strict();

export const processEventSchema = z
  .object({
    callId: identifierSchema,
    createdAt: timestampSchema,
    eveSessionId: identifierSchema,
    id: identifierSchema,
    mutationKey: z.string().min(1).max(512),
    operationType: slugSchema,
    ownerId: identifierSchema,
    payload: z.record(z.string(), jsonValueSchema),
    processId: identifierSchema,
    processVersion: z.number().int().positive(),
    reason: z.string().max(500),
    sequence: z.number().int().positive(),
    toolName: slugSchema,
    turnId: identifierSchema,
    turnSequence: z.number().int().nonnegative(),
  })
  .strict();

export const processToolResultSchema = z
  .object({
    active: z.boolean(),
    affectedEdgeIds: z.array(identifierSchema),
    affectedNodeIds: z.array(identifierSchema),
    eventId: identifierSchema.nullable(),
    mutationKey: z.string().nullable(),
    operationSummary: z.string().max(500),
    process: processSummarySchema.nullable(),
    projection: processProjectionSchema.nullable(),
    version: z.number().int().nonnegative().nullable(),
  })
  .strict();

export const graphCursorSchema = z
  .object({
    id: identifierSchema,
    updatedAt: timestampSchema,
  })
  .strict();

export const eventCursorSchema = z
  .object({
    eventId: identifierSchema,
    sequence: z.number().int().positive(),
  })
  .strict();

export const PROCESS_TOOL_NAMES = [
  "find_processes",
  "create_process",
  "activate_process",
  "deactivate_process",
  "read_process",
  "inspect_process_graph",
  "read_process_history",
  "mutate_process_graph",
  "change_process_state",
  "update_process_tags",
] as const;

export type EventCursor = z.infer<typeof eventCursorSchema>;
export type GraphCursor = z.infer<typeof graphCursorSchema>;
export type GraphOperation = z.infer<typeof graphOperationSchema>;
export type ProcessEdge = z.infer<typeof processEdgeSchema>;
export type ProcessEvent = z.infer<typeof processEventSchema>;
export type ProcessNode = z.infer<typeof processNodeSchema>;
export type ProcessProjection = z.infer<typeof processProjectionSchema>;
export type ProcessStatus = z.infer<typeof processStatusSchema>;
export type ProcessSummary = z.infer<typeof processSummarySchema>;
export type ProcessToolName = (typeof PROCESS_TOOL_NAMES)[number];
export type ProcessToolResult = z.infer<typeof processToolResultSchema>;
export type ProjectedColumn = z.infer<typeof projectedColumnSchema>;
export type ProjectionColumnDefinition = z.infer<
  typeof projectionColumnDefinitionSchema
>;
export type ProjectionSchema = z.infer<typeof projectionSchemaSchema>;
export type ProjectionSelector = z.infer<typeof projectionSelectorSchema>;
