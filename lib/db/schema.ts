import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import type { ClientSessionState, MessageStreamEvent } from "eve/client";
import type {
  JsonValue,
  ProcessProjection,
  ProcessStatus,
  ProjectedColumn,
  ProjectionSchema,
} from "@/lib/processes/contracts";

export const user = pgTable("user", {
  createdAt: timestamp("created_at").notNull().defaultNow(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").notNull().default(false),
  id: text("id").primaryKey(),
  image: text("image"),
  name: text("name").notNull(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const session = pgTable("session", {
  createdAt: timestamp("created_at").notNull().defaultNow(),
  expiresAt: timestamp("expires_at").notNull(),
  id: text("id").primaryKey(),
  ipAddress: text("ip_address"),
  token: text("token").notNull().unique(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
  userAgent: text("user_agent"),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
});

export const account = pgTable("account", {
  accessToken: text("access_token"),
  accessTokenExpiresAt: timestamp("access_token_expires_at"),
  accountId: text("account_id").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  id: text("id").primaryKey(),
  idToken: text("id_token"),
  password: text("password"),
  providerId: text("provider_id").notNull(),
  refreshToken: text("refresh_token"),
  refreshTokenExpiresAt: timestamp("refresh_token_expires_at"),
  scope: text("scope"),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
});

export const verification = pgTable("verification", {
  createdAt: timestamp("created_at").defaultNow(),
  expiresAt: timestamp("expires_at").notNull(),
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  updatedAt: timestamp("updated_at").defaultNow(),
  value: text("value").notNull(),
});

export const chat = pgTable(
  "chat",
  {
    createdAt: timestamp("created_at").notNull().defaultNow(),
    eveSession: jsonb("eve_session").$type<ClientSessionState | null>(),
    id: text("id").primaryKey(),
    pendingUserMessage: text("pending_user_message"),
    pendingUserMessageCreatedAt: timestamp("pending_user_message_created_at"),
    title: text("title").notNull().default("New chat"),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
  },
  (table) => [
    index("idx_chat_user_updated").on(table.userId, table.updatedAt),
    index("idx_chat_user_created").on(table.userId, table.createdAt),
  ]
);

export const chatEvent = pgTable(
  "chat_event",
  {
    chatId: text("chat_id")
      .notNull()
      .references(() => chat.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    event: jsonb("event")
      .$type<MessageStreamEvent>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    eventIndex: integer("event_index").notNull(),
    id: text("id").primaryKey(),
  },
  (table) => [
    index("idx_chat_event_chat").on(table.chatId),
    uniqueIndex("idx_chat_event_chat_index").on(table.chatId, table.eventIndex),
  ]
);

export const process = pgTable(
  "process",
  {
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    graphSchemaVersion: integer("graph_schema_version").notNull().default(1),
    id: text("id").primaryKey(),
    number: integer("number").generatedAlwaysAsIdentity({
      name: "process_number_seq",
    }),
    ownerId: text("owner_id").notNull(),
    projectionSchema: jsonb("projection_schema")
      .$type<ProjectionSchema>()
      .notNull()
      .default(sql`'{"version":1,"columns":[]}'::jsonb`),
    status: text("status")
      .$type<ProcessStatus>()
      .notNull()
      .default("in_progress"),
    tags: jsonb("tags")
      .$type<readonly string[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    title: text("title").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    version: integer("version").notNull().default(0),
  },
  (table) => [
    check(
      "process_status_check",
      sql`${table.status} in ('in_progress', 'waiting', 'blocked', 'completed', 'archived')`
    ),
    check("process_version_check", sql`${table.version} >= 0`),
    check(
      "process_graph_schema_version_check",
      sql`${table.graphSchemaVersion} > 0`
    ),
    uniqueIndex("idx_process_number").on(table.number),
    index("idx_process_owner_updated").on(table.ownerId, table.updatedAt),
    index("idx_process_owner_status").on(table.ownerId, table.status),
  ]
);

export const processNode = pgTable(
  "process_node",
  {
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    id: text("id").notNull(),
    kind: text("kind").notNull(),
    label: text("label").notNull(),
    metadata: jsonb("metadata")
      .$type<Readonly<Record<string, JsonValue>>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    ownerId: text("owner_id").notNull(),
    processId: text("process_id")
      .notNull()
      .references(() => process.id, { onDelete: "cascade" }),
    tombstonedAt: timestamp("tombstoned_at", { withTimezone: true }),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    primaryKey({
      columns: [table.processId, table.id],
      name: "process_node_process_id_id_pk",
    }),
    index("idx_process_node_process").on(table.processId),
    index("idx_process_node_process_kind").on(table.processId, table.kind),
    index("idx_process_node_process_updated").on(
      table.processId,
      table.updatedAt
    ),
    index("idx_process_node_live")
      .on(table.processId, table.kind)
      .where(sql`${table.tombstonedAt} is null`),
    index("idx_process_node_owner").on(table.ownerId, table.processId),
  ]
);

export const processEdge = pgTable(
  "process_edge",
  {
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    id: text("id").notNull(),
    metadata: jsonb("metadata")
      .$type<Readonly<Record<string, JsonValue>>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    ownerId: text("owner_id").notNull(),
    processId: text("process_id")
      .notNull()
      .references(() => process.id, { onDelete: "cascade" }),
    relation: text("relation").notNull(),
    sourceNodeId: text("source_node_id").notNull(),
    targetNodeId: text("target_node_id").notNull(),
    tombstonedAt: timestamp("tombstoned_at", { withTimezone: true }),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    primaryKey({
      columns: [table.processId, table.id],
      name: "process_edge_process_id_id_pk",
    }),
    foreignKey({
      columns: [table.processId, table.sourceNodeId],
      foreignColumns: [processNode.processId, processNode.id],
      name: "process_edge_source_process_node_fk",
    }),
    foreignKey({
      columns: [table.processId, table.targetNodeId],
      foreignColumns: [processNode.processId, processNode.id],
      name: "process_edge_target_process_node_fk",
    }),
    index("idx_process_edge_process").on(table.processId),
    index("idx_process_edge_source").on(table.processId, table.sourceNodeId),
    index("idx_process_edge_target").on(table.processId, table.targetNodeId),
    index("idx_process_edge_relation").on(table.processId, table.relation),
    index("idx_process_edge_live")
      .on(table.processId, table.relation)
      .where(sql`${table.tombstonedAt} is null`),
    index("idx_process_edge_owner").on(table.ownerId, table.processId),
  ]
);

export const processEvent = pgTable(
  "process_event",
  {
    callId: text("call_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    eveSessionId: text("eve_session_id").notNull(),
    id: text("id").primaryKey(),
    mutationKey: text("mutation_key").notNull(),
    operationType: text("operation_type").notNull(),
    ownerId: text("owner_id").notNull(),
    payload: jsonb("payload")
      .$type<Readonly<Record<string, JsonValue>>>()
      .notNull(),
    processId: text("process_id")
      .notNull()
      .references(() => process.id, { onDelete: "restrict" }),
    processVersion: integer("process_version").notNull(),
    reason: text("reason").notNull(),
    sequence: integer("sequence").notNull(),
    toolName: text("tool_name").notNull(),
    turnId: text("turn_id").notNull(),
    turnSequence: integer("turn_sequence").notNull(),
  },
  (table) => [
    check("process_event_sequence_check", sql`${table.sequence} > 0`),
    check("process_event_version_check", sql`${table.processVersion} > 0`),
    uniqueIndex("idx_process_event_owner_mutation").on(
      table.ownerId,
      table.mutationKey
    ),
    uniqueIndex("idx_process_event_process_sequence").on(
      table.processId,
      table.sequence
    ),
    uniqueIndex("idx_process_event_process_version").on(
      table.processId,
      table.processVersion
    ),
    uniqueIndex("idx_process_event_create_turn")
      .on(table.ownerId, table.eveSessionId, table.turnId)
      .where(sql`${table.operationType} = 'create_process'`),
    index("idx_process_event_owner_created").on(table.ownerId, table.createdAt),
  ]
);

export const processProjection = pgTable(
  "process_projection",
  {
    blockers: jsonb("blockers")
      .$type<ProcessProjection["blockers"]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    columns: jsonb("columns")
      .$type<readonly ProjectedColumn[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    generatedAt: timestamp("generated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    metrics: jsonb("metrics").$type<ProcessProjection["metrics"]>().notNull(),
    nextAction: text("next_action"),
    ownerId: text("owner_id").notNull(),
    pendingItems: jsonb("pending_items")
      .$type<ProcessProjection["pendingItems"]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    processId: text("process_id")
      .primaryKey()
      .references(() => process.id, { onDelete: "cascade" }),
    projectionSchemaVersion: integer("projection_schema_version").notNull(),
    sourceProcessVersion: integer("source_process_version").notNull(),
    summary: text("summary"),
  },
  (table) => [
    check(
      "process_projection_schema_version_check",
      sql`${table.projectionSchemaVersion} > 0`
    ),
    check(
      "process_projection_source_version_check",
      sql`${table.sourceProcessVersion} >= 0`
    ),
    index("idx_process_projection_owner").on(table.ownerId, table.generatedAt),
  ]
);

export type Chat = typeof chat.$inferSelect;
export type ChatEvent = typeof chatEvent.$inferSelect;
export type Process = typeof process.$inferSelect;
export type ProcessEdgeRow = typeof processEdge.$inferSelect;
export type ProcessEventRow = typeof processEvent.$inferSelect;
export type ProcessNodeRow = typeof processNode.$inferSelect;
export type ProcessProjectionRow = typeof processProjection.$inferSelect;
export type User = typeof user.$inferSelect;
