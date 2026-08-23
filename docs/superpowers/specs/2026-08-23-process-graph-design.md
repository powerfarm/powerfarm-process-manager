# Conversational Process Graph Design

**Status:** Approved architecture for the first production-shaped test

**Date:** 2026-08-23

**Application:** Marketing Room on Eve 0.39.3

## 1. Purpose

Add a durable process memory to the existing Marketing Room without replacing
or duplicating Eve's sessions, tools, event stream, authentication, client, or
chat persistence.

Every Eve session begins as an unbound brainstorm. During the conversation, the
person and the lead agent may explicitly agree to create or activate a process.
The lead then maintains a rich, navigable process graph through typed tools. The
person reads a compact human projection from a pill and read-only panel inside
the existing composer.

The process graph is long-term application data. It can be activated from many
independent sessions. The active-process binding is short-term session state and
belongs to Eve.

## 2. Goals

- Let every session begin with no active process.
- Create, find, activate, deactivate, inspect, and continue processes through
  ordinary chat.
- Keep the active process visible as a small pill inside the composer.
- Let the lead agent navigate a large graph incrementally without placing the
  whole graph in model context.
- Present a stable, readable projection of the graph to the person.
- Keep a permanent append-only domain log of every process mutation.
- Permit many sessions to activate the same process independently.
- Keep all structural writes behind typed Eve tools owned by the lead agent.
- Reuse the existing database client, authentication, stream, event persistence,
  message reducer, composer, and UI primitives.

## 3. Non-goals

- A separate Project entity.
- A replacement session manager or event bus.
- A second authentication system, database client, or database environment
  variable.
- Direct human CRUD forms or mutation endpoints.
- Sharing Eve `defineState` with subagents.
- Treating Eve's built-in todo list, Workflow, or agent graph as the process
  domain.
- Treating Google ADK's execution graph as the process graph.
- Storing the graph in browser storage, chat events, artifacts, or Vercel Blob.
- Sending the complete graph to the model or UI after every operation.
- A graph-layout engine or large visual-canvas dependency in the first test.

## 4. Existing primitives to preserve

The implementation extends the current application rather than building a
parallel stack.

| Requirement | Existing primitive |
| --- | --- |
| Durable conversation | Eve session and session cursor |
| Active process in one session | Eve `defineState` |
| Caller and provenance | `ctx.session`, turn metadata, and `ctx.callId` |
| Typed mutations | Eve `defineTool` with Zod input/output schemas |
| Rich UI result and compact model result | Full tool output plus `toModelOutput` |
| Transient progress | `actions.requested`, `action.partial`, `action.result` |
| Reconnect and replay | Existing Eve event stream and persisted chat events |
| Message rendering | Existing `defaultMessageReducer` path |
| Composer placement | Existing `footerStart` / `ComposerFooterControls` |
| Authentication | Existing password, Better Auth, local-dev, and Eve auth chain |
| Database | Existing Neon, Drizzle, `DATABASE_URL`, schema, and migrations |
| Rate limiting | Existing Upstash/KV abstraction where configured |

The existing `chat_event` table is a UI restoration cache, not a domain ledger.
It performs upserts and snapshot tail deletion. It must not be reused as the
process log.

## 5. Core invariants

1. A new Eve session has `activeProcessId: null`.
2. Activating or deactivating a process is explicit and affects only the current
   Eve session.
3. Activation does not alter process status.
4. A completed process may remain active for consultation.
5. Activating a completed process does not reopen it.
6. The lead is the only process writer. Specialists receive a bounded process
   brief and return their result to the lead.
7. The person can read the process through the UI and request changes through
   chat, but the browser has no process mutation endpoint.
8. Process, graph, projection, and domain log are scoped to the authenticated
   principal resolved by the server, never to a model-supplied owner ID.
9. Every successful domain mutation appends one immutable `process_event` and
   updates current graph state and projection in the same transaction.
10. Failed validation, authorization, version checks, or projection generation
    roll back the entire mutation.
11. Nodes and edges are tombstoned rather than physically deleted.
12. Processes are archived rather than physically deleted.
13. `process_projection` is a materialized read model and is always derivable
    from the process envelope, live graph, and projection schema.
14. The graph has a fixed storage grammar and extensible metadata. It does not
    have one fixed business ontology.
15. Model context receives bounded slices, never an unbounded graph dump.
16. Domain-event payloads contain the normalized accepted operations. Current
    graph tables are authoritative for ordinary reads, while the event sequence
    remains sufficient to audit and replay how that state was produced.

## 6. Session binding

Declare one module-scope Eve state handle:

```ts
interface ActiveProcessState {
  readonly processId: string | null;
  readonly projectionVersion: number | null;
}
```

The state is initialized with both values `null`. `activate_process` and
`deactivate_process` are the only writers.

`defineState` is the authority for the active binding because it already
survives turns, interruptions, redeploys, compaction, and clear within one Eve
session. No `session_process_binding` table is created.

The state is not shared with subagent sessions. When the lead delegates, it
includes only the process title, current human projection, relevant graph slice,
and the requested outcome in the specialist brief. The lead receives the result
and decides which graph mutations to record.

## 7. Process lifecycle

The first version has five durable statuses:

| Stored value | Human label | Meaning |
| --- | --- | --- |
| `in_progress` | Em andamento | Active work is occurring or expected |
| `waiting` | Aguardando | Waiting for an answer, dependency, or external event |
| `blocked` | Bloqueado | Work cannot advance without resolving a blocker |
| `completed` | Concluído | The agreed result has been reached |
| `archived` | Arquivado | Retained for reference but removed from ordinary active lists |

A new process starts as `in_progress`.

Allowed transitions are explicit:

- `in_progress` may move to `waiting`, `blocked`, `completed`, or `archived`.
- `waiting` may move to `in_progress`, `blocked`, `completed`, or `archived`.
- `blocked` may move to `in_progress`, `waiting`, `completed`, or `archived`.
- `completed` may move to `in_progress` or `archived`.
- `archived` may move to `in_progress`.

Every transition, including reopening or restoring an archived process, requires
explicit conversational agreement and a logged reason.

`Processing...` is not a process status. It is transient UI activity derived
from the current Eve stream while a process tool is running.

Status and tag changes occur only after an explicit conversational request or
agreement. The corresponding tool automatically records the current Eve session
and turn. Its input includes a concise reason, but never accepts identity or
session coordinates from the model. This first version provides conversational
evidence, not cryptographic proof of consent.

## 8. Graph grammar

The graph uses a stable envelope with extensible semantics.

### Process

- Internal UUID primary key.
- Monotonic human number, rendered as `PROC-000123`.
- Owner principal ID.
- Title.
- Status.
- Tags.
- Monotonic process version.
- Graph schema version.
- Projection schema.
- Created, updated, and archived timestamps.

### Node

- UUID.
- Process ID.
- Bounded `kind` slug.
- Human label.
- JSONB metadata with bounded serialized size.
- Created and updated timestamps.
- Optional tombstone timestamp.

### Edge

- UUID.
- Process ID.
- Source and target node IDs in the same process.
- Bounded relation slug.
- JSONB metadata with bounded serialized size.
- Created and updated timestamps.
- Optional tombstone timestamp.

The application validates key syntax, maximum payload size, relationship
integrity, and ownership. Metadata may contain rich domain-specific fields, but
cannot contain secrets, credentials, unbounded binary data, or cyclic values.

Large documents remain artifacts referenced by stable IDs or URLs; they are not
embedded wholesale into node metadata.

## 9. Human projection

The human projection is a deterministic lens over the current process and
graph. It is not generated afresh by an LLM when the UI opens.

Every projection includes:

- Process number and title.
- Durable status.
- Tags.
- Last update time.
- Summary.
- Next action, when present.
- Blockers and pending items.
- Typed dynamic columns.
- Counts for live nodes, edges, and metadata fields.
- Projection version and source process version.

The process stores a versioned projection schema. A column definition includes
a stable key, human label, value type, ordering, emphasis, and a deterministic
source selector over the process or graph. Schema changes are typed graph
operations and are recorded in the event log.

The first version supports only typed selectors: a process-envelope field, one
node metadata field selected by node ID or kind, a latest matching node value,
or a count of nodes/edges matching bounded filters. A column definition cannot
contain SQL, JavaScript, a free-form expression, or an LLM prompt.

The materialized `process_projection` row is updated in the same transaction as
the mutation. It is a cache: a projector can rebuild it from current process and
graph state.

## 10. Persistence model

Extend the existing Drizzle schema and migration directory. Reuse the existing
Neon client and `DATABASE_URL`.

### `process`

- `id` UUID/text primary key.
- `number` Postgres identity/sequence, unique.
- `owner_id`, indexed.
- `title`.
- `status` with a database constraint for the five values.
- `tags`.
- `version`, monotonic.
- `graph_schema_version`.
- `projection_schema` JSONB.
- `created_at`, `updated_at`, `archived_at`.

### `process_node`

- Node envelope described above.
- Indexes on process, kind, updated time, and live/tombstoned state.
- Optional GIN index only for metadata queries demonstrated by the first test;
  do not add speculative indexes for every possible field.

### `process_edge`

- Edge envelope described above.
- Foreign keys for process, source node, and target node.
- Indexes on process, source, target, relation, and live/tombstoned state.

### `process_event`

- Immutable event ID.
- Process ID.
- Monotonic process-local sequence.
- Resulting process version.
- Mutation key.
- Operation type.
- Validated payload containing the normalized accepted operation batch.
- Human-readable reason.
- Eve session ID, turn ID, turn sequence, call ID, tool name, and principal ID.
- Created timestamp.
- Unique `(process_id, sequence)` and `(process_id, process_version)`.
- A uniqueness rule for the application mutation key.
- No cascade delete from process.
- No application update/delete method; database-level protection rejects
  mutation of existing event rows.

### `process_projection`

- Process ID primary key.
- Source process version.
- Projection schema version.
- Summary.
- Typed columns JSONB.
- Metrics JSONB.
- Generated timestamp.

## 11. Tool surface

Only the root lead sees process tools.

### Discovery and binding

- `find_processes`: bounded search by exact process number or title text.
- `create_process`: create one process and initial graph root.
- `activate_process`: explicitly bind an authorized process to the session.
- `deactivate_process`: return the session to unbound brainstorm mode.

### Reading

- `read_process`: return the current envelope and human projection.
- `inspect_process_graph`: query a bounded graph slice by node, kind, relation,
  search text, or cursor.
- `read_process_history`: return a paginated event-log slice.

### Mutation

- `mutate_process_graph`: accept an array of bounded discriminated operations:
  `add_node`, `update_node`, `tombstone_node`, `link_nodes`, `unlink_nodes`, and
  `define_projection_column`.
- `change_process_state`: perform one allowed status transition after explicit
  conversational agreement.
- `update_process_tags`: add or remove bounded tags after explicit agreement.

The model never receives an arbitrary JSON Patch, SQL fragment, owner ID,
principal ID, session ID, turn ID, call ID, event sequence, or process version
increment. The executor derives authority and provenance from Eve context.

Mutation inputs carry `expectedVersion`. A transaction locks or version-checks
the process, validates the complete operation batch, writes current state,
rebuilds the projection, increments the version, and appends the event.

`ctx.callId` is recorded and participates in the mutation key, but it is not
treated as a complete exactly-once guarantee. Expected-version checks, unique
constraints, and transaction boundaries protect retries and concurrent sessions.
Process creation additionally permits at most one committed `create_process`
operation for the same owner, Eve session, and turn. A repeated attempt returns
the already-created process; creating another process requires a later turn.

## 12. Tool output and model context

Each process tool returns a structured full result for the Eve event stream and
UI. Mutation results include:

- Process ID, number, and title.
- Durable status and tags.
- Active/inactive binding result when relevant.
- New process and projection versions.
- Updated human columns and counts.
- IDs of affected nodes and edges.
- Compact operation summary.

`toModelOutput` sends the model only what it needs:

- Mutations: a compact confirmation, new version, and navigation hints.
- Activation: number, title, status, and a small projection summary.
- Graph inspection: only the requested bounded slice.
- History: only the requested bounded page.

The full structured result remains available to `action.result`, hooks, and UI.
No tool returns the entire graph.

Async-generator tools may yield transient phases such as `reading`, `writing`,
and `projecting`. These power UI activity but are not process events.

## 13. Agent behavior and dynamic context

Keep the existing lead instructions exactly once. When implementation begins,
convert the single `agent/instructions.md` into an instructions directory:

- One static Markdown entry containing the unchanged current instructions.
- One dynamic TypeScript entry for active-process context.

At `turn.started`, the dynamic entry reads the session's `activeProcessId`. When
present, it loads a small current projection from Postgres and contributes it as
user-role data. It clearly labels stored process content as data, never system
instructions.

The injected context contains only process ID, title, status, tags, version,
summary, and the most important projected columns. The lead uses graph tools for
anything deeper.

Behavioral rules tell the lead:

- Do not create or activate a process silently.
- It may suggest a matching existing process, but waits for explicit agreement.
- Use typed tools for every process write.
- Keep the process active after completion unless asked to deactivate it.
- Do not change status or tags without explicit agreement.
- After a specialist returns, decide which facts, decisions, outputs, or blockers
  should be recorded; specialists never write the process directly.

## 14. UI design

### Pill

Add the process pill to the existing `ComposerFooterControls` through
`footerStart`, before integration controls.

The pill displays:

- `PROC-000123`.
- Truncated title.
- Status label, icon, and color.
- Transient pulse while a process tool is active.

Status is never communicated by color alone. The pill has no close or mutation
button. Clicking it opens the read-only process panel.

### Panel

Desktop uses a small popover-style panel anchored to the pill and opening above
the composer. Mobile uses the existing dialog foundation with a sheet-like
layout. Do not misuse the semantic dropdown menu for a rich document panel.

The panel has three read-only sections:

1. **Summary:** status, tags, projected columns, next action, blockers, counts,
   and timestamps.
2. **Graph:** paginated/filterable nodes and relations around a selected node;
   no large visual-canvas dependency in the first test.
3. **Log:** paginated immutable process events with operation, reason, session,
   turn, and time.

All mutations continue through chat.

### Event projection

Do not replace the current message reducer. Add a second pure reducer over the
same persisted/display events:

```text
displayEvents
├── existing message reducer -> messages
└── process UI reducer        -> pill, activity, cached projection
```

The reducer observes process-tool requests, partials, results, failures, and
cancellations. Replaying stored chat events reconstructs the session's pill
without a new binding table.

The event-derived projection is a UI cache. Opening the panel performs an
authenticated GET for the latest shared projection, because another session may
have changed the process.

## 15. Read-only web API

Create authenticated, owner-scoped GET routes only:

- Find/list processes with keyset pagination.
- Read one process projection.
- Read a bounded graph slice.
- Read process history with keyset pagination.

Every route resolves the viewer with the existing `getServerViewer()` flow and
never accepts an owner ID. There are no web mutation routes or process server
actions.

The tools and GET routes share one application process store; they do not call
each other over HTTP.

## 16. Setup mode for the first test

The current setup does not switch to database chat storage when only
`DATABASE_URL` is provided. Full database chat mode requires database, Better
Auth/Vercel OAuth, rate limiting, and ready migrations.

For the first test, use a hybrid capability arrangement:

```text
authentication = password
chat storage    = browser
process storage = existing Postgres/Neon
```

Implementation requirements:

- Keep `authMode: "password"` and `storageMode: "browser"` unchanged.
- Add `DATABASE_URL` to the deployment.
- Add process tables through the existing Drizzle migration path.
- Extend setup status with an independently calculated `processStoreReady`.
- Check process-table migration readiness whenever `DATABASE_URL` exists, even
  when full database chat mode is not configured.
- Hide or disable process tools and the panel with a clear setup error when the
  process store is unavailable.
- Do not create a second database URL, client, migration directory, or storage
  mode.

In password mode, all operators share the existing logical principal
`marketing-room-user`. This is acceptable for the single-operator test but is
not a multi-user security boundary. Full Better Auth remains the later path for
separate process ownership.

## 17. Concurrency, retry, and failure behavior

- Every mutation validates ownership before reading graph data.
- Every mutation uses a database transaction.
- Every mutation checks `expectedVersion` and increments exactly once.
- A stale version returns a structured conflict containing the current version
  and a compact latest projection. The lead rereads before proposing a retry.
- A repeated committed mutation returns the recorded result when its mutation
  key is recognized; it does not append another event.
- A repeated process creation in the same owner/session/turn returns the first
  process instead of allocating another human number.
- Invalid nodes, cross-process edges, oversized metadata, and unknown operations
  fail before any write.
- Projection failure rolls back graph and event changes.
- Cancellation before commit leaves no domain change.
- Ambiguous interruption after commit is resolved through version and mutation
  lookup, not by blindly repeating the write.
- Process-not-found and unauthorized access use indistinguishable external
  responses where appropriate to avoid leaking IDs.
- Archive and tombstone operations are recoverable through later logged events;
  nothing exposes hard deletion in the first test.

## 18. Testing strategy

### Pure unit tests

- Graph operation validation.
- Projection rebuilding from graph fixtures.
- Status labels, icons, and visual-token mapping.
- Process UI event reducer, including replay and duplicate stream events.
- Human-number formatting and cursor encoding.

### Database tests

- Process creation and human-number uniqueness.
- Atomic graph mutation, projection update, version increment, and event append.
- Event append-only enforcement.
- Node/edge tombstones.
- Stale-version conflicts from two simulated sessions.
- Repeated mutation behavior.
- Owner scoping and unauthorized reads.
- Projection rebuild equality.
- Setup readiness with missing and applied process migrations.

### Tool tests/evals

- Sessions start unbound.
- Creation/activation requires explicit conversational agreement.
- Activation and deactivation affect only the current session.
- Completed processes remain active for reading.
- Activating a completed process does not reopen it.
- Status/tag changes follow explicit agreement.
- Large graph inspection is paginated and bounded.
- Full tool output reaches UI while `toModelOutput` stays compact.
- Specialists receive context but cannot write process state.

### Browser tests

- Pill appears, updates, and disappears from the existing composer.
- Desktop drop-up and mobile dialog behavior.
- Status is visible by text/icon as well as color.
- Transient processing activity settles correctly on success, failure, and
  cancellation.
- Reload reconstructs the active-process pill from persisted Eve events.
- Opening the panel refreshes a projection changed in another session.
- Summary, graph, and log pagination remain readable.
- No browser mutation request exists.

### Project verification

- `pnpm validate` reports zero errors and warnings.
- `pnpm build` succeeds.
- `npx eve info` discovers the intended root tools and no specialist copies.
- Local browser and Eve TUI smoke tests cover create, activate, mutate, complete,
  consult, deactivate, and reactivate flows.
- Production promotion occurs only after migrations and process-store readiness
  are verified.

## 19. Reference boundaries

Google ADK is a design reference, not a runtime dependency. Useful ideas include
event envelopes, state deltas, typed interruption, and graph rendering. Its
workflow graph models execution rather than the durable process object required
here.

Official Eve examples are implementation references:

- The Personal Agent pattern for tool-managed long-term memory, Drizzle storage,
  dynamic instructions, and a specialized tool card.
- The Software Factory pattern for bounded shared memory and passing large
  artifacts by stable ID rather than injecting full documents.

Copy small patterns into the current Eve/Drizzle architecture. Do not import a
second session service, workflow runtime, memory service, ORM, or UI application.

## 20. Acceptance criteria

The first test is complete when:

1. A session begins without a process pill.
2. A user can ask the lead to create or activate a process by chat.
3. The pill appears inside the existing composer with number, title, and visible
   status.
4. The lead can navigate and mutate a rich graph through typed bounded tools.
5. The same process can be activated from a different session by explicit
   request.
6. Summary, graph slice, and log are readable from the pill panel.
7. A completed process may remain active and readable.
8. Deactivation returns the session to unbound brainstorm mode without changing
   process status.
9. Every successful mutation has one immutable event and one matching current
   projection version.
10. Concurrent/replayed mutations do not silently duplicate or overwrite work.
11. Existing chat, auth, streaming, integrations, and specialist behavior remain
    functional.
12. The deployed test uses the existing password mode and existing Postgres
    configuration with no parallel infrastructure.
