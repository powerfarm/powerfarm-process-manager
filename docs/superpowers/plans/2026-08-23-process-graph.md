# Conversational Process Graph Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a durable, cross-session process graph that the lead agent alone can create and mutate through chat, while the person sees a small active-process pill and a read-only process panel.

**Architecture:** Eve `defineState` stores only the active process binding for one Eve session. The existing Neon/Drizzle Postgres connection stores owner-scoped process graphs, an append-only domain log, and a derivable materialized projection. Typed lead-only tools are the sole write surface. The existing Eve event stream feeds both the current message reducer and a second pure process-projection reducer; authenticated GET routes refresh the full read-only panel.

**Tech Stack:** TypeScript, Eve 0.39.3, Next.js 16 App Router, React 19, Zod 4, Drizzle ORM, Neon Postgres, Radix UI, Vitest, pnpm.

**Spec:** `docs/superpowers/specs/2026-08-23-process-graph-design.md`

**Global Constraints:** Preserve the existing auth, chat persistence, Eve stream, `defaultMessageReducer`, database client, setup modes, and specialist boundaries. Do not add a Project entity, a session/process join table, a second database client, arbitrary JSON Patch, hard deletion, direct UI mutation, or process tools on specialist agents. Derive ownership from `ctx.session.auth.current`, provenance from Eve context, and idempotency from server-side mutation identity. Treat `chat_event` as UI reconstruction data, never as the process audit log.

## File map

Existing files that change:

- `package.json`, `pnpm-lock.yaml`: add the Vitest runner and test scripts.
- `lib/db/schema.ts`: add the five process tables and exported inferred row types.
- `lib/db/client.ts`: distinguish base chat schema readiness from process schema readiness.
- `lib/chat/types.ts`, `lib/setup.ts`: expose `processStoreReady` independently of chat `storageMode`.
- `.env.example`: document that `DATABASE_URL` enables process memory in password/browser mode.
- `agent/agent.ts`: give process tools only to the lead.
- `agent/instructions.md`: move unchanged baseline instructions into the supported instructions directory form.
- `app/_components/agent-chat.tsx`: run the process event reducer and pass its result to composer controls.
- `app/_components/session-chat-page.tsx`: render the active process UI for a real session.
- `app/_components/home-chat-page.tsx`: keep the pre-session composer process-free.
- `README.md`, `docs/ARCHITECTURE.md`, `AGENTS.md`: record the process-memory boundary and operational commands.

New files:

- `vitest.config.ts`: test discovery and aliases.
- `lib/processes/contracts.ts`: canonical Zod schemas and exported TypeScript types.
- `lib/processes/contracts.test.ts`: graph-operation validation and schema-boundary tests.
- `lib/processes/format.ts`: human process-number formatting.
- `lib/processes/cursor.ts`: opaque graph/event cursor encoding and validation.
- `lib/processes/projection.ts`: pure graph-to-human projection builder.
- `lib/processes/projection.test.ts`: projection behavior.
- `lib/processes/errors.ts`: typed domain failures and HTTP mapping.
- `lib/processes/repository.ts`: owner-scoped Drizzle reads and transactional writes.
- `lib/processes/service.ts`: lifecycle, typed mutation, optimistic concurrency, idempotency, event append, and projection refresh.
- `lib/processes/service.test.ts`: domain tests against an in-memory repository double.
- `lib/processes/repository.integration.test.ts`: opt-in checks against the configured migrated database.
- `lib/processes/ui-projection.ts`: pure reducer over Eve stream events.
- `lib/processes/ui-projection.test.ts`: pill reconstruction and transient activity tests.
- `lib/processes/http.ts`: authenticated owner resolution and query parsing shared by GET routes.
- `lib/processes/client.ts`: browser-only typed GET client.
- `lib/processes/use-process-detail.ts`: panel fetch state and refresh logic.
- `lib/use-media-query.ts`: desktop/mobile surface selection.
- `lib/db/migrations/0002_process_graph.sql`: generated process schema migration.
- `lib/db/migrations/meta/0002_snapshot.json`, `lib/db/migrations/meta/_journal.json`: generated Drizzle migration metadata.
- `agent/lib/processes/config.ts`: `defineState`, limits, labels, and state helpers.
- `agent/lib/processes/tools.ts`: tool factories and compact model-output mapping.
- `agent/tools/find_processes.ts`, `create_process.ts`, `activate_process.ts`, `deactivate_process.ts`, `read_process.ts`, `inspect_process_graph.ts`, `read_process_history.ts`, `mutate_process_graph.ts`, `change_process_state.ts`, `update_process_tags.ts`: one-line lead tool exports.
- `agent/instructions/base.md`: the current lead instructions, preserved as the static source.
- `agent/instructions/process-context.ts`: dynamic active-process projection at `turn.started`.
- `app/api/processes/route.ts`: authenticated process discovery.
- `app/api/processes/[id]/route.ts`: authenticated process summary/projection.
- `app/api/processes/[id]/graph/route.ts`: bounded graph page.
- `app/api/processes/[id]/events/route.ts`: bounded append-only log page.
- `components/ui/popover.tsx`: local Radix popover wrapper.
- `components/processes/process-status.tsx`: durable state label and transient activity indicator.
- `components/processes/process-pill.tsx`: compact composer pill.
- `components/processes/process-panel.tsx`: responsive read-only Summary/Graph/Log panel.
- `components/processes/process-summary.tsx`, `process-graph-list.tsx`, `process-log-list.tsx`: bounded panel sections.

## Task 1: Install a focused test harness

**Files:**

- Modify: `package.json`
- Modify: `pnpm-lock.yaml`
- Create: `vitest.config.ts`

### Step 1: Add the failing script contract

Add these scripts to `package.json` before installing Vitest:

```json
{
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest"
  }
}
```

### Step 2: Prove the runner is missing

Run:

```bash
pnpm test
```

Expected: the command fails because `vitest` is not installed.

### Step 3: Install and configure Vitest

Run:

```bash
pnpm add --save-dev --save-exact vitest
```

Create `vitest.config.ts`:

```ts
import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "."),
      "#": path.resolve(import.meta.dirname, "agent"),
    },
  },
  test: {
    environment: "node",
    include: ["**/*.test.ts"],
  },
});
```

### Step 4: Verify the empty suite is wired

Run:

```bash
pnpm test -- --passWithNoTests
pnpm typecheck
```

Expected: both commands exit zero.

### Step 5: Commit only the test harness

```bash
git add package.json pnpm-lock.yaml vitest.config.ts
git commit -m "test: add vitest harness"
```

## Task 2: Define the process and graph contracts

**Files:**

- Create: `lib/processes/contracts.ts`
- Create: `lib/processes/contracts.test.ts`
- Create: `lib/processes/format.ts`
- Create: `lib/processes/cursor.ts`
- Create: `lib/processes/projection.test.ts`
- Create: `lib/processes/projection.ts`

### Step 1: Write projection tests first

Cover these exact cases in `lib/processes/projection.test.ts`:

```ts
describe("projectProcess", () => {
  it("keeps fixed process fields ahead of dynamic columns", () => {});
  it("resolves node metadata, latest matching value, and bounded count selectors", () => {});
  it("returns null for a selector whose source is missing", () => {});
  it("sorts columns by position and then stable column id", () => {});
  it("caps count selectors at their declared bound", () => {});
});
```

The fixtures must include one process, three nodes with two node kinds, two edges, and four declared projection columns.

In `lib/processes/contracts.test.ts`, cover all six graph operations, rejection of unknown operations and oversized metadata, `PROC-000123` formatting, and graph/event cursor round trips plus malformed-cursor rejection.

Run:

```bash
pnpm vitest run lib/processes/projection.test.ts
```

Expected: compilation fails because the contracts and projector do not exist.

### Step 2: Create canonical Zod contracts

In `lib/processes/contracts.ts`, define and export:

```ts
export const processStatusSchema = z.enum([
  "in_progress",
  "waiting",
  "blocked",
  "completed",
  "archived",
]);

export const graphOperationSchema = z.discriminatedUnion("op", [
  addNodeOperationSchema,
  updateNodeOperationSchema,
  tombstoneNodeOperationSchema,
  linkNodesOperationSchema,
  unlinkNodesOperationSchema,
  defineProjectionColumnOperationSchema,
]);

export const processToolResultSchema = z.object({
  active: z.boolean(),
  affectedEdgeIds: z.array(z.string()),
  affectedNodeIds: z.array(z.string()),
  eventId: z.string().nullable(),
  mutationKey: z.string().nullable(),
  operationSummary: z.string(),
  process: processSummarySchema.nullable(),
  projection: processProjectionSchema.nullable(),
  version: z.number().int().nonnegative().nullable(),
});
```

The contract must also define:

- `ProcessStatus`, `ProcessSummary`, `ProcessNode`, `ProcessEdge`, `ProcessEvent`, `ProcessProjection`, and `ProcessToolResult` inferred from Zod.
- Fixed process fields: `id`, `number`, `title`, `status`, `tags`, `ownerId`, `version`, `graphSchemaVersion`, `projectionSchema`, `createdAt`, `updatedAt`, `archivedAt`.
- Node fields: `id`, `processId`, `kind`, `label`, `metadata`, `createdAt`, `updatedAt`, `tombstonedAt`.
- Edge fields: `id`, `processId`, `sourceNodeId`, `targetNodeId`, `relation`, `metadata`, `createdAt`, `updatedAt`, `tombstonedAt`.
- Projection selector union limited to `process_field`, `node_metadata`, `latest_node_value`, and `node_count`.
- Human projection fields for summary, next action, blockers, pending items, typed columns, live node/edge/metadata counts, generated time, projection schema version, and source process version.
- Cursor schemas for graph and event pagination.
- A single exported `PROCESS_TOOL_NAMES` tuple used by both the agent and the browser reducer.

Do not accept `ownerId`, Eve session id, turn id, call id, event id, mutation key, or version increment as model inputs.

In `lib/processes/format.ts`, make `formatProcessNumber(123)` return `PROC-000123`. In `lib/processes/cursor.ts`, encode only validated keyset fields and decode through the matching Zod schema; do not serialize query text, owner ids, or credentials.

### Step 3: Implement the pure projector

In `lib/processes/projection.ts`, expose this interface:

```ts
export function projectProcess(input: {
  readonly process: ProcessSummary;
  readonly nodes: readonly ProcessNode[];
  readonly edges: readonly ProcessEdge[];
  readonly columns: readonly ProjectionColumnDefinition[];
}): ProcessProjection;
```

Make selectors exhaustive with a `never` guard. Exclude tombstoned nodes and edges from current projection values, retain fixed process fields, and never evaluate SQL, JavaScript, or natural-language selectors.

### Step 4: Run the focused tests

```bash
pnpm vitest run lib/processes/contracts.test.ts lib/processes/projection.test.ts
pnpm typecheck
```

Expected: all five tests pass and TypeScript exits zero.

### Step 5: Commit the contracts and projector

```bash
git add lib/processes/contracts.ts lib/processes/contracts.test.ts lib/processes/cursor.ts lib/processes/format.ts lib/processes/projection.ts lib/processes/projection.test.ts
git commit -m "feat: define process graph contracts"
```

## Task 3: Add the process tables and independent readiness check

**Files:**

- Modify: `lib/db/schema.ts`
- Modify: `lib/db/client.ts`
- Modify: `lib/chat/types.ts`
- Modify: `lib/setup.ts`
- Modify: `.env.example`
- Create: `lib/setup.test.ts`
- Create: `lib/db/migrations/0002_process_graph.sql`
- Create: `lib/db/migrations/meta/0002_snapshot.json`
- Modify: `lib/db/migrations/meta/_journal.json`

### Step 1: Write setup-mode tests

Extract setup computation into a pure exported helper accepting booleans, then test:

```ts
it("keeps password auth and browser chat storage while enabling the process store", () => {});
it("does not report the process store ready without DATABASE_URL", () => {});
it("keeps full Vercel mode dependent on auth, rate limit, and base chat schema", () => {});
it("reports a configured database whose process migration is missing", () => {});
```

Run:

```bash
pnpm vitest run lib/setup.test.ts
```

Expected: tests fail because `SetupStatus` has no `processStoreReady` field.

### Step 2: Add Drizzle tables

Add `process`, `processNode`, `processEdge`, `processEvent`, and `processProjection` to `lib/db/schema.ts` with these invariants:

- Every table has `owner_id`; all reads include it even when an id is globally unique.
- `process.number` is a unique Postgres identity/sequence rendered by the application as `PROC-000123`.
- `process.version` is a non-negative integer with default `0`.
- `process.graph_schema_version` and `process.projection_schema` version the extensible graph and its human lens.
- `process.status` has a database constraint for the five approved durable values.
- `process_event` stores normalized accepted operations in `payload` JSONB and is never updated or deleted.
- `process_event` has unique indexes on `(owner_id, mutation_key)` and `(process_id, version)`.
- `process_event` stores process-local sequence, operation type, reason, Eve session id, turn id, turn sequence, call id, tool name, principal id, and created time.
- `process_event` has a partial unique index for one `create_process` per `(owner_id, eve_session_id, turn_id)`.
- The migration installs a trigger that rejects `UPDATE` and `DELETE` on existing `process_event` rows.
- `process_node` and `process_edge` have stable ids and nullable `tombstoned_at`.
- `process_projection` has one row per process, carries the source process version, and stores the typed projection JSONB.
- `process_event` has no cascade delete from process. Other foreign keys may support administrative removal, but the application never issues that delete.

Export each inferred select and insert type.

### Step 3: Generate the migration

Run:

```bash
pnpm db:generate --name process_graph
```

Expected: Drizzle creates `lib/db/migrations/0002_process_graph.sql`, updates `_journal.json`, and creates `0002_snapshot.json`.

Inspect the SQL and confirm it contains all five tables and both `process_event` unique indexes:

```bash
rg -n 'CREATE TABLE|process_event|mutation_key|version' lib/db/migrations/0002_process_graph.sql
```

### Step 4: Split schema readiness

Keep `isDatabaseSchemaReady()` for the existing auth/chat tables. Add:

```ts
export async function isProcessSchemaReady(): Promise<boolean>;
```

It must check only the five process tables and return `false` on connection/schema errors without throwing setup rendering.

Add `processStoreReady` to `SetupStatus`. Compute it as:

```ts
const processStoreReady = databaseConfigured && processSchemaReady;
```

This must not change password/local development to `storageMode: "database"`.

### Step 5: Document environment behavior

In `.env.example`, state that `DATABASE_URL` alone enables durable process memory when password auth is used; Better Auth and Upstash are still required only for database-backed chat mode.

### Step 6: Verify focused and generated artifacts

```bash
pnpm vitest run lib/setup.test.ts
pnpm typecheck
git add .env.example lib/chat/types.ts lib/db/client.ts lib/db/schema.ts lib/db/migrations lib/setup.ts lib/setup.test.ts
pnpm db:generate --name process_graph_check
git diff --exit-code -- lib/db/migrations lib/db/schema.ts
```

Expected: tests and typecheck pass; the second generate reports no schema changes and leaves no diff.

### Step 7: Commit the schema slice

```bash
git add .env.example lib/chat/types.ts lib/db/client.ts lib/db/schema.ts lib/db/migrations lib/setup.ts lib/setup.test.ts
git commit -m "feat: add durable process graph schema"
```

## Task 4: Implement the owner-scoped process service

**Files:**

- Create: `lib/processes/errors.ts`
- Create: `lib/processes/repository.ts`
- Create: `lib/processes/service.ts`
- Create: `lib/processes/service.test.ts`
- Create: `lib/processes/repository.integration.test.ts`

### Step 1: Write service tests against an in-memory repository double

Cover these exact behaviors:

```ts
describe("ProcessService", () => {
  it("creates one process for the same owner, session, and turn replay", () => {});
  it("allows two different turns to create two processes", () => {});
  it("rejects a stale expected version without appending an event", () => {});
  it("returns the committed result when a mutation key is replayed", () => {});
  it("applies typed graph operations atomically and increments once", () => {});
  it("tombstones nodes and their current edges without erasing history", () => {});
  it("rejects edges across processes and missing node endpoints", () => {});
  it("changes durable state only through the state method", () => {});
  it("enforces the approved status transition table", () => {});
  it("changes tags only through the tag method", () => {});
  it("rebuilds the same projection from authoritative rows", () => {});
  it("never returns another owner's process", () => {});
});
```

Run:

```bash
pnpm vitest run lib/processes/service.test.ts
```

Expected: compilation fails because the service contract is absent.

### Step 2: Define typed domain failures

In `lib/processes/errors.ts`, add discriminated failures for:

- `process_not_found`
- `process_store_unavailable`
- `version_conflict`
- `invalid_graph_operation`
- `projection_limit_exceeded`
- `replayed_mutation`

Expose a safe public message and HTTP status mapper. Never include raw SQL or connection strings.

### Step 3: Define the repository boundary

Use an injectable interface so service tests do not require a database:

```ts
export interface ProcessRepository {
  findProcesses(input: FindProcessesInput): Promise<ProcessListPage>;
  readSnapshot(input: OwnerProcessInput): Promise<ProcessSnapshot | null>;
  readEvents(input: ReadEventsInput): Promise<ProcessEventPage>;
  transact<T>(work: (tx: ProcessTransaction) => Promise<T>): Promise<T>;
}
```

The Drizzle implementation must:

- add `owner_id = ?` to every select/update;
- lock the process row during mutation;
- look up `mutation_key` before applying a replay;
- update graph rows, append one event, update process version, and upsert projection in one transaction;
- paginate graph and log by opaque validated cursors;
- never expose a delete method.

### Step 4: Implement service methods

Expose:

```ts
export interface ProcessService {
  createProcess(input: CreateProcessCommand): Promise<ProcessMutationResult>;
  findProcesses(input: FindProcessesQuery): Promise<ProcessListPage>;
  readProcess(input: ReadProcessQuery): Promise<ProcessSnapshot | null>;
  inspectGraph(input: InspectGraphQuery): Promise<ProcessGraphPage>;
  readHistory(input: ReadHistoryQuery): Promise<ProcessEventPage>;
  mutateGraph(input: MutateGraphCommand): Promise<ProcessMutationResult>;
  changeState(input: ChangeStateCommand): Promise<ProcessMutationResult>;
  updateTags(input: UpdateTagsCommand): Promise<ProcessMutationResult>;
}
```

Server-derived command context contains `ownerId`, `eveSessionId`, `turnId`, `turnSequence`, `callId`, and `toolName`. Build mutation keys on the server:

```ts
const mutationKey = `${context.eveSessionId}:${context.turnId}:${context.callId}`;
```

Creation additionally enforces a unique origin key for `(owner_id, eve_session_id, turn_id, create_process)` so two create calls in one turn converge on the same process.

### Step 5: Make accepted operations auditable

Before persistence, normalize every accepted operation to the canonical Zod shape. Store only that normalized array plus the before/after status or tag delta in `process_event.payload`. Build current reads from process/node/edge tables. Confirm event replay can reconstruct version order and mutation intent.

### Step 6: Run the service suite

```bash
pnpm vitest run lib/processes/service.test.ts
pnpm typecheck
```

Expected: all twelve tests pass and TypeScript exits zero.

### Step 7: Add opt-in database integration tests

`lib/processes/repository.integration.test.ts` runs only when `RUN_DATABASE_TESTS=1` and uses the configured `DATABASE_URL`; it does not introduce another runtime database variable. Give every test a unique owner prefix and archive retained fixtures rather than bypassing the application log.

Cover process-number uniqueness, atomic graph/projection/event commit, event update/delete rejection, tombstones, two-session stale-version conflict, replay convergence, owner isolation, projection rebuild equality, and migrated-schema readiness.

Run after Task 3's migration has been applied to a disposable test database:

```bash
RUN_DATABASE_TESTS=1 pnpm vitest run lib/processes/repository.integration.test.ts
```

Expected: every database invariant passes and the append-only trigger rejects direct update/delete attempts.

### Step 8: Commit the service

```bash
git add lib/processes/errors.ts lib/processes/repository.ts lib/processes/repository.integration.test.ts lib/processes/service.ts lib/processes/service.test.ts
git commit -m "feat: implement process graph service"
```

## Task 5: Add Eve session binding and read tools

**Files:**

- Create: `agent/lib/processes/config.ts`
- Create: `agent/lib/processes/tools.ts`
- Create: `agent/tools/find_processes.ts`
- Create: `agent/tools/create_process.ts`
- Create: `agent/tools/activate_process.ts`
- Create: `agent/tools/deactivate_process.ts`
- Create: `agent/tools/read_process.ts`
- Create: `agent/tools/inspect_process_graph.ts`
- Create: `agent/tools/read_process_history.ts`
- Modify: `agent/agent.ts`
- Create: `agent/lib/processes/tools.test.ts`

### Step 1: Write tool-boundary tests

Test that:

- owner id comes from `ctx.session.auth.current`, not input;
- active process state is session-local;
- create activates its result;
- activate verifies owner visibility before binding;
- deactivate clears only the binding and does not mutate the process;
- all read tools default to the active process but accept an explicit process id;
- a missing database returns a safe store-unavailable result;
- no process tool is attached to any specialist agent.

Run:

```bash
pnpm vitest run agent/lib/processes/tools.test.ts
```

Expected: compilation fails because tool factories do not exist.

### Step 2: Define session state and bounded constants

In `agent/lib/processes/config.ts`:

```ts
export const activeProcessState = defineState(
  "marketing-active-process",
  () => ({ processId: null as string | null, projectionVersion: null as number | null })
);

export const PROCESS_GRAPH_PAGE_SIZE = 50;
export const PROCESS_EVENT_PAGE_SIZE = 50;
export const PROCESS_SEARCH_LIMIT = 20;
```

Use the exact Eve 0.39.3 `defineState` signature confirmed from the installed package. State contains no graph data.

### Step 3: Build tool factories around the service

`agent/lib/processes/tools.ts` must receive the service as a dependency for tests and expose one factory per tool. Map full results to the action stream while keeping model output small:

```ts
toModelOutput(result) {
  return result.process
    ? `Process ${result.process.id} is ${result.process.status} at version ${result.version}.`
    : "No process is active.";
}
```

Read tools return bounded pages. `create_process` input contains only title, optional initial status, optional initial tags, and optional typed initial graph operations.

### Step 4: Add thin tool exports

Each file in `agent/tools/` imports one configured factory and exports its definition. Keep database/service construction in the shared process tool module, not duplicated ten times.

### Step 5: Attach tools only to the lead

Update `agent/agent.ts` to include all process tools. Do not modify `agent/subagents/*/agent.ts`.

### Step 6: Verify tool boundaries

```bash
pnpm vitest run agent/lib/processes/tools.test.ts
pnpm typecheck
rg -n 'process|activeProcess' agent/subagents
```

Expected: tests and typecheck pass; the final search returns no process tools or state in specialist definitions.

### Step 7: Commit session binding and read tools

```bash
git add agent/agent.ts agent/lib/processes agent/tools/find_processes.ts agent/tools/create_process.ts agent/tools/activate_process.ts agent/tools/deactivate_process.ts agent/tools/read_process.ts agent/tools/inspect_process_graph.ts agent/tools/read_process_history.ts
git commit -m "feat: add process binding and read tools"
```

## Task 6: Add typed graph, state, and tag mutation tools

**Files:**

- Create: `agent/tools/mutate_process_graph.ts`
- Create: `agent/tools/change_process_state.ts`
- Create: `agent/tools/update_process_tags.ts`
- Modify: `agent/lib/processes/tools.ts`
- Modify: `agent/lib/processes/tools.test.ts`
- Modify: `agent/agent.ts`

### Step 1: Add failing mutation-tool tests

Cover:

```ts
it("forwards ctx.callId and the expected process version", () => {});
it("rejects arbitrary patch paths and untyped operations at schema parsing", () => {});
it("requires an explicit agreed durable state", () => {});
it("supports add and remove tag sets without replacing unrelated tags", () => {});
it("updates the session projection version after a committed mutation", () => {});
it("returns the same structured result for an idempotent replay", () => {});
```

Run the focused test and confirm it fails before implementation.

### Step 2: Define model-visible schemas

- `mutate_process_graph`: `processId?`, `expectedVersion`, and one to twenty `graphOperationSchema` operations.
- `change_process_state`: `processId?`, `expectedVersion`, `status`, and a concise agreement note.
- `update_process_tags`: `processId?`, `expectedVersion`, distinct `add` and `remove` arrays, and a concise agreement note.

No tool input may contain SQL, JSON Patch paths, arbitrary code, ownership, provenance, or a caller-selected mutation key.

### Step 3: Implement compact model outputs

Full `ProcessToolResult` remains in `action.result`. `toModelOutput` returns process id, durable state, version, and a short mutation summary only. It never serializes the graph or event page.

Attach the three mutation tools to `agent/agent.ts` beside the read/binding tools. Do not modify any specialist agent.

### Step 4: Run the mutation tool suite

```bash
pnpm vitest run agent/lib/processes/tools.test.ts
pnpm typecheck
```

Expected: all tool tests pass.

### Step 5: Commit mutation tools

```bash
git add agent/agent.ts agent/lib/processes/tools.ts agent/lib/processes/tools.test.ts agent/tools/mutate_process_graph.ts agent/tools/change_process_state.ts agent/tools/update_process_tags.ts
git commit -m "feat: add typed process mutations"
```

## Task 7: Inject a compact active-process context at turn start

**Files:**

- Delete: `agent/instructions.md`
- Create: `agent/instructions/base.md`
- Create: `agent/instructions/process-context.ts`
- Create: `agent/instructions/process-context.test.ts`

### Step 1: Preserve current instructions exactly

Move the complete current contents of `agent/instructions.md` to `agent/instructions/base.md` in one rename operation, then append only the approved process behavior:

- brainstorm by default when no process is active;
- create or activate only after explicit agreement in conversation;
- only the lead mutates process memory;
- state/tag changes require conversational agreement;
- keep a completed process active until asked to turn it off or activate another;
- read before mutation and use the observed version.
- when delegating, pass only the process title, current human projection, relevant bounded graph slice, and requested outcome; the specialist returns work and the lead decides what to record.

Do not leave both the flat file and directory form.

### Step 2: Test dynamic context output

Test that the dynamic instruction source:

- emits nothing when no process is active;
- emits only process id, title, state, tags, version, and visible projection columns;
- never emits raw graph rows or event history;
- emits a safe stale-binding note when an active id is no longer readable;
- uses a user-role instruction event on `turn.started`.

### Step 3: Implement the dynamic source

Use the installed Eve dynamic-instructions API and `activeProcessState`. Read through the owner-scoped service and cap serialized projection text. The resulting event should tell the lead what is active without treating stored data as system authority.

### Step 4: Verify instruction discovery

```bash
pnpm vitest run agent/instructions/process-context.test.ts
pnpm typecheck
pnpm build:eve
```

Expected: tests, typecheck, and Eve build pass; Eve discovers both directory entries.

### Step 5: Commit dynamic context

```bash
git add agent/instructions.md agent/instructions/base.md agent/instructions/process-context.ts agent/instructions/process-context.test.ts
git commit -m "feat: inject active process context"
```

## Task 8: Add authenticated read-only process routes

**Files:**

- Create: `lib/processes/http.ts`
- Create: `app/api/processes/route.ts`
- Create: `app/api/processes/[id]/route.ts`
- Create: `app/api/processes/[id]/graph/route.ts`
- Create: `app/api/processes/[id]/events/route.ts`
- Create: `app/api/processes/process-routes.test.ts`

### Step 1: Write route tests

Test:

- unauthenticated requests return `401`;
- password mode resolves the fixed authenticated principal already used by the app;
- Vercel auth resolves the existing viewer id;
- another owner's id returns `404`, not `403`;
- missing process schema returns `503` with a safe error code;
- graph and event limits are capped at `50`;
- malformed cursors return `400`;
- all route modules export GET only.

### Step 2: Implement shared HTTP helpers

Reuse existing authentication functions. `lib/processes/http.ts` should expose:

```ts
export async function requireProcessOwner(): Promise<Viewer>;
export function parseGraphQuery(url: URL): InspectGraphQuery;
export function parseEventQuery(url: URL): ReadHistoryQuery;
export function processErrorResponse(error: unknown): Response;
```

### Step 3: Implement GET routes

- `/api/processes?q=&cursor=` returns owner-scoped summaries.
- `/api/processes/[id]` returns the latest process and materialized projection.
- `/api/processes/[id]/graph?cursor=&limit=&kind=` returns a bounded current graph page.
- `/api/processes/[id]/events?cursor=&limit=` returns append-only events newest first with a stable cursor.

Never accept mutation through HTTP in this version.

### Step 4: Verify route behavior

```bash
pnpm vitest run app/api/processes/process-routes.test.ts
pnpm typecheck
rg -n 'export (async )?function (POST|PUT|PATCH|DELETE)' app/api/processes
```

Expected: tests and typecheck pass; the final search returns no mutation handler.

### Step 5: Commit the API

```bash
git add app/api/processes lib/processes/http.ts
git commit -m "feat: expose read-only process api"
```

## Task 9: Project process tool results from the existing Eve stream

**Files:**

- Create: `lib/processes/ui-projection.ts`
- Create: `lib/processes/ui-projection.test.ts`
- Modify: `app/_components/agent-chat.tsx`

### Step 1: Capture real event fixtures

Use Eve's installed `MessageStreamEvent` type and existing persisted event format. Build minimal fixtures for a process tool `action.result`, tool-started, tool-completed, session reconnect, and non-process action. Do not invent a second event format.

### Step 2: Write reducer tests

Cover:

```ts
it("ignores non-process actions", () => {});
it("activates a pill from create or activate action results", () => {});
it("updates projection and durable status from later tool results", () => {});
it("clears the pill only from a successful deactivate result", () => {});
it("derives transient processing only from process-tool lifecycle events", () => {});
it("settles transient processing after process-tool failure or cancellation", () => {});
it("reconstructs the same pill from persisted display events", () => {});
it("keeps the latest process version when older events arrive", () => {});
```

### Step 3: Implement the pure reducer

Expose:

```ts
export interface ProcessUiState {
  readonly activeProcess: ProcessSummary | null;
  readonly projection: ProcessProjection | null;
  readonly isProcessing: boolean;
}

export function reduceProcessEvents(
  events: readonly MessageStreamEvent[],
  isBusy: boolean
): ProcessUiState;
```

Validate rich tool results with `processToolResultSchema`; malformed results are ignored. Use process version to prevent stale overwrite. Overall agent busy state may keep an already-open process action pending, but unrelated agent work must not create the process pulse.

### Step 4: Wire beside the message reducer

In `app/_components/agent-chat.tsx`, compute `ProcessUiState` from the same `displayEvents` and `isBusy`. Do not modify `defaultMessageReducer`. Extend `AgentChatControllerStatus` with this process state so `session-chat-page.tsx` can render it.

### Step 5: Verify reducer integration

```bash
pnpm vitest run lib/processes/ui-projection.test.ts
pnpm typecheck
```

Expected: all eight tests pass.

### Step 6: Commit the stream projection

```bash
git add lib/processes/ui-projection.ts lib/processes/ui-projection.test.ts app/_components/agent-chat.tsx
git commit -m "feat: project process state from eve events"
```

## Task 10: Build the read-only pill and responsive panel

**Files:**

- Create: `components/ui/popover.tsx`
- Create: `components/processes/process-status.tsx`
- Create: `components/processes/process-status.test.ts`
- Create: `components/processes/process-pill.tsx`
- Create: `components/processes/process-panel.tsx`
- Create: `components/processes/process-summary.tsx`
- Create: `components/processes/process-graph-list.tsx`
- Create: `components/processes/process-log-list.tsx`
- Create: `lib/processes/client.ts`
- Create: `lib/processes/use-process-detail.ts`
- Create: `lib/use-media-query.ts`
- Modify: `app/_components/agent-chat.tsx`
- Modify: `app/_components/session-chat-page.tsx`
- Modify: `app/_components/home-chat-page.tsx`

### Step 1: Add browser-fetch tests for the detail hook

Using a small injected fetch function, test that opening the panel:

- fetches the latest summary first;
- requests graph and log only for the selected section;
- aborts in-flight requests when process id changes;
- preserves the stream projection until fresher server data arrives;
- reports a stale/deleted process without clearing the session binding from the browser.

Keep these tests in `lib/processes/use-process-detail.test.ts` and run them in the Node environment without a DOM renderer by testing the underlying fetch state machine exported from the module.

### Step 2: Add the local popover primitive

Follow the style of existing `components/ui/dialog.tsx` and import the already installed Radix package. No new component library or graph visualization dependency is added.

### Step 3: Implement status presentation

`process-status.tsx` owns the fixed Portuguese labels:

```ts
export const PROCESS_STATUS_LABELS = {
  in_progress: "Em andamento",
  waiting: "Aguardando",
  blocked: "Bloqueado",
  completed: "Concluído",
  archived: "Arquivado",
} as const;
```

Durable state is visually primary. `isProcessing` adds a separate transient activity dot/text and never changes the durable label.

In `components/processes/process-status.test.ts`, verify all five labels, icon/token mapping, and that each rendered description includes text independent of color.

### Step 4: Implement the compact pill

The pill displays the formatted process number, title, and durable state inside the composer's existing `footerStart`. It opens details but exposes no close, edit, status, tag, or delete control. Truncate title text without hiding the number or state.

### Step 5: Implement the responsive panel

- At `min-width: 640px`, open a popover/drop-up anchored to the pill.
- Below that breakpoint, open the existing Dialog primitive as a sheet-like full-width surface.
- Provide three read-only section buttons: Summary, Graph, Log.
- Graph is a bounded list of nodes and edges around an optional selected node, with kind/relation filters and cursor pagination.
- Log shows event type, version, timestamp, tool, session, turn, reason, and accepted-operation summary.
- Opening or switching section performs authenticated GET refreshes.
- Empty, loading, unavailable-store, and stale-binding states are explicit.
- `setupStatus.processStoreReady` controls the unavailable-store presentation; the browser does not invent a fallback store.

### Step 6: Wire only session composers

Pass `controllerStatus.processUi` into `ComposerFooterControls` in `session-chat-page.tsx`. Keep `home-chat-page.tsx` without a pill because no Eve session exists yet.

### Step 7: Verify UI code

```bash
pnpm vitest run lib/processes/use-process-detail.test.ts
pnpm vitest run components/processes/process-status.test.ts
pnpm typecheck
pnpm build
```

Expected: tests, typecheck, and production build pass.

### Step 8: Commit the UI

```bash
git add components/processes components/ui/popover.tsx lib/processes/client.ts lib/processes/use-process-detail.ts lib/processes/use-process-detail.test.ts lib/use-media-query.ts app/_components/agent-chat.tsx app/_components/session-chat-page.tsx app/_components/home-chat-page.tsx
git commit -m "feat: add active process pill and panel"
```

## Task 11: Run live database and conversational acceptance checks

**Files:**

- Modify: `README.md`
- Modify: `docs/ARCHITECTURE.md`
- Modify: `AGENTS.md`

### Step 1: Apply the migration to the configured test database

Confirm the target without printing the connection string:

```bash
test -n "$DATABASE_URL" && echo "DATABASE_URL configured"
pnpm db:migrate
RUN_DATABASE_TESTS=1 pnpm vitest run lib/processes/repository.integration.test.ts
```

Expected: the migration finishes successfully.

### Step 2: Confirm both readiness paths

Start the app:

```bash
pnpm dev
```

Expected in password mode: auth is `password`, chat storage remains `browser`, and process store is ready.

### Step 3: Exercise the full conversation

In a fresh chat:

1. Send a brainstorm message and confirm no process pill appears.
2. Ask to begin a process named `Launch test` and agree to it.
3. Confirm one process is created, activated, and displayed in the pill.
4. Ask the lead to add three graph nodes and link them.
5. Open the panel and confirm Summary, Graph, and Log reflect the committed version.
6. Ask to mark it blocked; confirm the durable label is `Bloqueado` and transient activity disappears after the tool completes.
7. Open a second chat, ask to find and activate `Launch test`, and confirm the same process version appears.
8. Mutate from the second chat, return to the first, reopen the panel, and confirm GET refresh shows the newer version.
9. Turn the process off and confirm the pill disappears without deleting the process.
10. Reactivate it and mark it completed; confirm it remains active and readable.

### Step 4: Inspect database invariants

Use Drizzle Studio or a read-only SQL console and confirm:

- one process exists for the replayed create turn;
- versions are contiguous;
- each committed version has one append-only `process_event`;
- no event row changed after creation;
- the projection version equals the process version;
- tombstoned rows remain present;
- both chats refer to the same process without a binding table.

### Step 5: Document operations and boundaries

Update the three documents with:

- the `defineState` versus Postgres responsibility;
- password/browser-chat plus Postgres/process-store setup;
- migration, test, and verification commands;
- lead-only mutation and specialist context rules;
- read-only UI/API boundary;
- status vocabulary and transient processing distinction.

### Step 6: Run the complete local gate

```bash
pnpm test
pnpm validate
pnpm build:eve
npx eve info
pnpm build
rg -n 'TO[D]O|T[B]D|FIXM[E]|placeholde[r]|coming soo[n]|not implemente[d]' agent app components lib README.md AGENTS.md docs/ARCHITECTURE.md
git status --short
```

Expected: all commands pass; the stub scan returns no feature stubs; `git status` shows only the intended documentation files for this task.

### Step 7: Commit documentation

```bash
git add README.md docs/ARCHITECTURE.md AGENTS.md
git commit -m "docs: explain conversational process memory"
```

## Task 12: Deploy and verify production behavior

**Files:** none unless a deployment-only defect is discovered.

### Step 1: Confirm deployment environment names without printing values

```bash
vercel env ls
```

Expected: production has the current password/auth configuration and `DATABASE_URL`. Add only missing names through Vercel's secret prompt; never place values in the repository or command history.

### Step 2: Apply production migrations before application promotion

```bash
pnpm db:migrate:production
```

Expected: the process schema migration succeeds against the production database.

### Step 3: Deploy the verified commit

```bash
vercel --prod
```

Expected: Vercel returns a production deployment URL and the build exits zero.

### Step 4: Repeat the browser acceptance path in production

Repeat Task 11 Step 3 against the production URL, including cross-session activation and panel refresh. Confirm the browser network log shows only GET requests under `/api/processes`; all mutations appear as Eve tool actions.

### Step 5: Record deployment evidence

Capture in the final handoff:

- deployed commit SHA;
- production deployment URL;
- migration command result;
- local test/build results;
- production process id used for the smoke test;
- observed final status and process version;
- any connector that remains intentionally unconfigured.

Do not call the feature complete until both the deployed chat interaction and database invariants have been observed.

## Plan self-review checklist

- Every approved requirement maps to a task and verification step.
- Existing Eve, auth, stream, chat persistence, database client, and composer primitives are reused.
- Session binding and cross-session process persistence remain separate.
- Every mutation is typed, owner-scoped, optimistic, transactional, idempotent, and append-logged.
- The model cannot select ownership, provenance, mutation identity, or version increments.
- Process deletion is tombstoning; no application delete API exists.
- The lead alone receives process tools.
- Rich tool results feed the UI; compact `toModelOutput` feeds the model.
- Dynamic context is bounded and does not duplicate static instructions.
- The UI and HTTP routes are read-only.
- Durable state and transient processing are represented separately.
- Database readiness does not force password-mode chat storage into database mode.
- Unit, database, tool, browser, build, migration, and production checks are explicit.
