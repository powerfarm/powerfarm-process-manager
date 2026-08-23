CREATE TABLE "process" (
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"graph_schema_version" integer DEFAULT 1 NOT NULL,
	"id" text PRIMARY KEY NOT NULL,
	"number" integer GENERATED ALWAYS AS IDENTITY (sequence name "process_number_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"owner_id" text NOT NULL,
	"projection_schema" jsonb DEFAULT '{"version":1,"columns":[]}'::jsonb NOT NULL,
	"status" text DEFAULT 'in_progress' NOT NULL,
	"tags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"title" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "process_status_check" CHECK ("process"."status" in ('in_progress', 'waiting', 'blocked', 'completed', 'archived')),
	CONSTRAINT "process_version_check" CHECK ("process"."version" >= 0),
	CONSTRAINT "process_graph_schema_version_check" CHECK ("process"."graph_schema_version" > 0)
);
--> statement-breakpoint
CREATE TABLE "process_edge" (
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"id" text PRIMARY KEY NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"owner_id" text NOT NULL,
	"process_id" text NOT NULL,
	"relation" text NOT NULL,
	"source_node_id" text NOT NULL,
	"target_node_id" text NOT NULL,
	"tombstoned_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "process_event" (
	"call_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"eve_session_id" text NOT NULL,
	"id" text PRIMARY KEY NOT NULL,
	"mutation_key" text NOT NULL,
	"operation_type" text NOT NULL,
	"owner_id" text NOT NULL,
	"payload" jsonb NOT NULL,
	"process_id" text NOT NULL,
	"process_version" integer NOT NULL,
	"reason" text NOT NULL,
	"sequence" integer NOT NULL,
	"tool_name" text NOT NULL,
	"turn_id" text NOT NULL,
	"turn_sequence" integer NOT NULL,
	CONSTRAINT "process_event_sequence_check" CHECK ("process_event"."sequence" > 0),
	CONSTRAINT "process_event_version_check" CHECK ("process_event"."process_version" > 0)
);
--> statement-breakpoint
CREATE TABLE "process_node" (
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"id" text PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"label" text NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"owner_id" text NOT NULL,
	"process_id" text NOT NULL,
	"tombstoned_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "process_projection" (
	"blockers" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"columns" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"generated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"metrics" jsonb NOT NULL,
	"next_action" text,
	"owner_id" text NOT NULL,
	"pending_items" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"process_id" text PRIMARY KEY NOT NULL,
	"projection_schema_version" integer NOT NULL,
	"source_process_version" integer NOT NULL,
	"summary" text,
	CONSTRAINT "process_projection_schema_version_check" CHECK ("process_projection"."projection_schema_version" > 0),
	CONSTRAINT "process_projection_source_version_check" CHECK ("process_projection"."source_process_version" >= 0)
);
--> statement-breakpoint
ALTER TABLE "process_edge" ADD CONSTRAINT "process_edge_process_id_process_id_fk" FOREIGN KEY ("process_id") REFERENCES "public"."process"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "process_edge" ADD CONSTRAINT "process_edge_source_node_id_process_node_id_fk" FOREIGN KEY ("source_node_id") REFERENCES "public"."process_node"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "process_edge" ADD CONSTRAINT "process_edge_target_node_id_process_node_id_fk" FOREIGN KEY ("target_node_id") REFERENCES "public"."process_node"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "process_event" ADD CONSTRAINT "process_event_process_id_process_id_fk" FOREIGN KEY ("process_id") REFERENCES "public"."process"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "process_node" ADD CONSTRAINT "process_node_process_id_process_id_fk" FOREIGN KEY ("process_id") REFERENCES "public"."process"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "process_projection" ADD CONSTRAINT "process_projection_process_id_process_id_fk" FOREIGN KEY ("process_id") REFERENCES "public"."process"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "idx_process_number" ON "process" USING btree ("number");--> statement-breakpoint
CREATE INDEX "idx_process_owner_updated" ON "process" USING btree ("owner_id","updated_at");--> statement-breakpoint
CREATE INDEX "idx_process_owner_status" ON "process" USING btree ("owner_id","status");--> statement-breakpoint
CREATE INDEX "idx_process_edge_process" ON "process_edge" USING btree ("process_id");--> statement-breakpoint
CREATE INDEX "idx_process_edge_source" ON "process_edge" USING btree ("process_id","source_node_id");--> statement-breakpoint
CREATE INDEX "idx_process_edge_target" ON "process_edge" USING btree ("process_id","target_node_id");--> statement-breakpoint
CREATE INDEX "idx_process_edge_relation" ON "process_edge" USING btree ("process_id","relation");--> statement-breakpoint
CREATE INDEX "idx_process_edge_live" ON "process_edge" USING btree ("process_id","relation") WHERE "process_edge"."tombstoned_at" is null;--> statement-breakpoint
CREATE INDEX "idx_process_edge_owner" ON "process_edge" USING btree ("owner_id","process_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_process_event_owner_mutation" ON "process_event" USING btree ("owner_id","mutation_key");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_process_event_process_sequence" ON "process_event" USING btree ("process_id","sequence");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_process_event_process_version" ON "process_event" USING btree ("process_id","process_version");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_process_event_create_turn" ON "process_event" USING btree ("owner_id","eve_session_id","turn_id") WHERE "process_event"."operation_type" = 'create_process';--> statement-breakpoint
CREATE INDEX "idx_process_event_owner_created" ON "process_event" USING btree ("owner_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_process_node_process" ON "process_node" USING btree ("process_id");--> statement-breakpoint
CREATE INDEX "idx_process_node_process_kind" ON "process_node" USING btree ("process_id","kind");--> statement-breakpoint
CREATE INDEX "idx_process_node_process_updated" ON "process_node" USING btree ("process_id","updated_at");--> statement-breakpoint
CREATE INDEX "idx_process_node_live" ON "process_node" USING btree ("process_id","kind") WHERE "process_node"."tombstoned_at" is null;--> statement-breakpoint
CREATE INDEX "idx_process_node_owner" ON "process_node" USING btree ("owner_id","process_id");--> statement-breakpoint
CREATE INDEX "idx_process_projection_owner" ON "process_projection" USING btree ("owner_id","generated_at");--> statement-breakpoint
CREATE OR REPLACE FUNCTION reject_process_event_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
	RAISE EXCEPTION 'process_event is append-only';
END;
$$;--> statement-breakpoint
CREATE TRIGGER process_event_append_only
BEFORE UPDATE OR DELETE ON "process_event"
FOR EACH ROW
EXECUTE FUNCTION reject_process_event_mutation();
