ALTER TABLE "process_edge" DROP CONSTRAINT "process_edge_source_node_id_process_node_id_fk";
--> statement-breakpoint
ALTER TABLE "process_edge" DROP CONSTRAINT "process_edge_target_node_id_process_node_id_fk";
--> statement-breakpoint
ALTER TABLE "process_edge" DROP CONSTRAINT "process_edge_pkey";
--> statement-breakpoint
ALTER TABLE "process_node" DROP CONSTRAINT "process_node_pkey";
--> statement-breakpoint
ALTER TABLE "process_node" ADD CONSTRAINT "process_node_process_id_id_pk" PRIMARY KEY("process_id","id");
--> statement-breakpoint
ALTER TABLE "process_edge" ADD CONSTRAINT "process_edge_process_id_id_pk" PRIMARY KEY("process_id","id");
--> statement-breakpoint
ALTER TABLE "process_edge" ADD CONSTRAINT "process_edge_source_process_node_fk" FOREIGN KEY ("process_id","source_node_id") REFERENCES "public"."process_node"("process_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "process_edge" ADD CONSTRAINT "process_edge_target_process_node_fk" FOREIGN KEY ("process_id","target_node_id") REFERENCES "public"."process_node"("process_id","id") ON DELETE no action ON UPDATE no action;
