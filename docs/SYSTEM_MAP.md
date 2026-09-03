# SYSTEM_MAP.md

A working map of this repository for whoever arrives next, human or agent. It answers "where does this live and what happens when I press send", so nobody has to rediscover it by reading the whole tree and the framework's compiled output.

Read this first, then the file you actually need:

| Document | Answers |
| --- | --- |
| `docs/SYSTEM_MAP.md` (this file) | where things live, how a turn flows end to end, and which framework behaviors are load-bearing |
| [`AGENTS.md`](../AGENTS.md) | the rules you must follow when editing: conventions, boundaries, code style, security |
| [`docs/ARCHITECTURE.md`](./ARCHITECTURE.md) | why the pieces are split the way they are, the approval matrix, the credential model |
| [`docs/CUSTOMIZING.md`](./CUSTOMIZING.md) | recipes: add a specialist, a skill, a tool, a connection |
| `node_modules/eve/docs/` | the framework itself. Resolve it with `ls -d node_modules/.pnpm/eve@*/node_modules/eve \| head -1` |

Symbols are cited as `path — symbolName` rather than line numbers, which drift. `rg "symbolName" path` finds them.

## One deployment, two runtimes

`next.config.ts` wraps the Next config in `withEve()`. That single Vercel deployment serves:

- the **Marketing Room** web app (`app/`, `components/`, root `lib/`) on ordinary Next routes, and
- the **eve agent runtime** (`agent/`) mounted at `/eve/v1/*`, plus `/eve/v1/slack` and `/eve/v1/mcp`.

They share an origin, so the browser talks to the agent same-origin with cookies. They do **not** share an identity resolver: the web app resolves a `Viewer` (`lib/session.ts`), the agent resolves a channel principal (`agent/channels/eve.ts`). Both must land on the same id or owner-scoped reads break. See [Environment matrix](#environment-matrix).

There is no wiring file on the agent side. eve walks `agent/` at build time: a tool's name is its filename, a subagent's name is its directory name, a skill's name is its directory name. `npx eve info` prints what it found; `.eve/discovery/diagnostics.json` says why something was skipped.

## Directory map

| Path | Holds | Notes |
| --- | --- | --- |
| `agent/agent.ts` | lead model + compaction | one `defineAgent` |
| `agent/instructions/base.md` | the lead's behavior | prose only, no framework plumbing |
| `agent/instructions/process-context.ts` | `defineDynamic` on `turn.started` | injects the active process projection as user-role data |
| `agent/channels/{eve,slack,mcp}.ts` | inbound entry points | `eve.ts` also owns the attachment `uploadPolicy` |
| `agent/tools/*.ts` | the lead's 17 tools | one default export per file, name = filename |
| `agent/lib/<domain>/{config,tools}.ts` | shared factories | the only reuse mechanism; two files per domain |
| `agent/subagents/<id>/` | the 5 specialists | each has `agent.ts`, `instructions.md`, `sandbox.ts`, `tools/`, `skills/`, `connections/`. 20 packaged `SKILL.md` directories in total, plus the shared `writing-quality` factory called from five one-line files |
| `agent/sandbox.ts` | Vercel Sandbox backend | the lead's shell and filesystem |
| `app/(chat)/` | routes: `/` and `/chat/[id]` | thin; the work is in `app/_components/` |
| `app/_components/agent-chat.tsx` | the chat engine | ~2200 lines, the densest file in the repo |
| `app/_components/{home,session}-chat-page.tsx` | the two composer hosts | own draft + attachment state |
| `app/_components/agent-chat-shell.tsx` | sidebar, auth modal, bootstrap sync | provides `useChatShell()` |
| `app/api/processes/**` | read-only process routes | list, detail, graph, events |
| `app/api/{bootstrap,chats,password-auth}/**` | viewer, setup status, chat history, login | |
| `app/manifest.ts`, `app/icon.svg`, `app/apple-icon.tsx`, `app/icon-512.png/` | the installable icon and the web app manifest | `lib/app-icon.ts` composes the square once, so each generated size is one `img` |
| `components/chat/` | composer, message renderer, sidebar, markdown | |
| `components/processes/` | pill, panel, summary, graph list, log list, sidebar list | all read-only |
| `lib/chat/` | client-side chat persistence, limits, attachment policy | `storageMode` decides browser vs Neon |
| `lib/processes/` | contracts, repository, service, projection, HTTP handlers, client, hooks | the process layer's whole brain |
| `lib/db/` | Drizzle schema, Neon clients, migrations | 11 tables |
| `lib/{auth,session,setup,eve-auth,password-auth,mcp-auth}.ts` | identity and readiness | |

## Flow 1: a browser turn, end to end

1. `components/chat/composer.tsx` — `ChatComposer` collects text plus staged attachments and calls `onSubmit(text, attachments)`.
2. `app/_components/session-chat-page.tsx` — `handleComposerSubmit` forwards to the controller. On the home page, `app/_components/home-chat-page.tsx` instead stores the message in `sessionStorage`, stashes attachments in module memory (`lib/chat/provisional-chat.ts`), and routes to a provisional `new-<uuid>` chat id.
3. `app/_components/agent-chat.tsx` — `AgentChatSession` exposes the controller through `onControllerChange`. `sendMessage` validates length, calls `prepareSend` (which creates the real chat row and `router.replace`s onto its id), then `agent.send(toAttachmentUserContent(message, attachments), { clientContext })`.
4. `useEveAgent` (from `eve/react`) POSTs `/eve/v1/session` or `/eve/v1/session/:id` and opens the NDJSON stream at `/eve/v1/session/:id/stream`.
5. `agent/channels/eve.ts` — `eveChannel({ auth: [...] })` walks the auth chain in order: Better Auth, password cookie, local dev, Vercel OIDC. First hit wins; exhaustion is a 401.
6. The lead runs. Every stream event comes back through `persistStreamEvent`, which passes it through `receiveStreamEvent` (strip inline attachment bytes, then namespace the turn id) and appends it to both React state and storage.
7. `reduceEventsToMessageData(displayEvents)` projects events into messages; `components/chat/message.tsx` renders them.

**The provisional-chat dance is the subtlest part of this flow.** A message typed on `/` is sent from `/chat/new-<uuid>`, which immediately creates a real chat and replaces the route. Anything that must survive the send has to be re-keyed from the provisional id to the real one — `session-chat-page.tsx` does that for both the pending message and the pending attachments. Forgetting the re-key is silent: the message goes out, the extra thing does not.

## Flow 2: where a conversation is stored

`lib/setup.ts` — `computeSetupStatus` returns `storageMode`, and `lib/chat/persistence-client.ts` switches on it:

- `"browser"` — `lib/chat/local-store.ts`, one `localStorage` key (`eve-chat-template:chats`), max 50 chats, throws "Browser storage is full" on quota. Every stream event is stored. This is why inbound attachment bytes are stripped before persisting (`lib/chat/events.ts` — `withoutInlineAttachmentBytes`).
- `"database"` — `/api/chats/*` into Neon `chat` and `chat_event` tables.

`ActiveChat` (`lib/chat/types.ts`) is the unit both modes return: `{ id, title, events, session, pendingUserMessage }`. `session` is the eve `ClientSessionState` cursor needed to resume a stream after reload.

## Flow 3: attachments in

1. `lib/chat/attachments.ts` holds the whole policy: `MAX_ATTACHMENT_BYTES` (3 MB), `MAX_ATTACHMENTS_PER_MESSAGE`, `ALLOWED_ATTACHMENT_MEDIA_TYPES`, and `toAttachmentUserContent`. The composer validates against it and the channel enforces the same values. Change limits here only.
2. The composer reads each file as a base64 `data:` URL and builds AI SDK `UserContent`: one text part, then one file part per attachment.
3. `agent/channels/eve.ts` — `uploadPolicy` rejects violations with 413 or 415 before dispatch.
4. eve stages byte-backed file parts into the session sandbox at `/workspace/attachments/<sha256-16>/<safe-filename>` **before the first model step**, and replaces the part's data with an internal `eve-sandbox:` reference.
5. For the model call, images up to 3 MiB and PDFs up to 20 MiB are re-inlined as bytes. Everything else becomes a text part reading `Attached file <path> (<mediaType>)`. That path is how the lead finds a CSV or a .docx.
6. The lead opens it with `bash` / `read_file` in `agent/sandbox.ts`.

The bytes are the point: a remote `https` URL in a file part is **not** staged (see [Framework facts](#framework-facts-worth-knowing)), so an attachment sent as a link never becomes a file the agent can open.

## Flow 4: files out

`agent/tools/share_file.ts` → `agent/lib/vercel-blob/tools.ts` — `shareFileTool()`. It takes a sandbox path, reads the bytes through `ctx.getSandbox()`, and `put`s them under the `shared/` Blob prefix with a random suffix. Bytes never enter the model's context, which is the difference from `upload_asset` (that one takes content as tool input).

`components/chat/message.tsx` — `readSharedFile` matches settled `share_file` calls and renders `SharedFileCard`: filename, size, media type, link, and a thumbnail for images. Inbound attachments render through `AttachmentPart` on the user message.

`shared/` is deliberately **not** a reserved prefix in `agent/lib/vercel-blob/config.ts`, because a briefed specialist has to reach the file with `download_asset`. The reserved prefixes (`brand-context/`, `user-preferences/`, `artifacts/`) are refused by the generic asset tools so they cannot be used as a side channel.

## Flow 5: delegation

The lead calls a subagent as a tool named after its directory. eve starts a **fresh child session that inherits nothing**: no conversation, no skills, no connections, no sandbox. Hence:

- the brief in `message` must carry everything, quoted rather than referenced;
- all five specialists own duplicate `connections/notion.ts`, `sandbox.ts`, and asset tools;
- the lead's `/workspace` is invisible to a specialist, which is why a file has to be published with `share_file` and passed as a URL;
- long documents move as artifact ids (`agent/lib/artifacts/`), not as text through the lead's context.

Specialists disable `bash` (`tools/bash.ts` → `disableTool()`) so research goes through `web_fetch`. The lead does not, so the lead has a real shell.

## Flow 6: process memory

**Write path (agent only).** `agent/lib/processes/tools.ts` — `buildProcessTools` produces ten lead-only tools, wired one per file in `agent/tools/*process*.ts`. Every mutation: `requireOwner(ctx)` from `ctx.session.auth.current`, an `expectedVersion`, a unique mutation key derived from `sessionId:turnId:callId`, and one appended immutable event in the same transaction (`lib/processes/service.ts` — `commitMutation` → `lib/processes/repository.ts` — `mutateProcess`).

The graph operations are `add_node`, `update_node`, `tombstone_node`, `link_nodes`, `unlink_nodes`, `define_projection_column` (`lib/processes/contracts.ts`). Durable statuses are `in_progress`, `waiting`, `blocked`, `completed`, `archived`, labelled in Portuguese by `PROCESS_STATUS_LABELS`.

**Session binding.** `agent/lib/processes/config.ts` — `activeProcessState` is a `defineState` holding only `{ processId, projectionVersion }` for one eve session. `agent/instructions/process-context.ts` reads it on `turn.started` and injects a bounded projection as user-role application data.

**Read path (browser).** `app/api/processes/**` → `lib/processes/http.ts` — `buildProcessReadHandlers`, owner-scoped by `getServerViewer`. There is no HTTP mutation route and there must not be one.

**UI.** Two entry points, both read-only:

- the **pill** in the composer footer (`app/_components/agent-chat.tsx` — `ComposerFooterControls` → `components/processes/process-pill.tsx`) is reconstructed from *that chat's own* `action.result` events by `lib/processes/ui-projection.ts` — `reduceProcessEvents`. It appears only in a conversation where a process tool actually committed.
- the **sidebar list** (`components/processes/process-list.tsx`, mounted in `components/chat/sidebar.tsx`) fetches `/api/processes` and opens the same `ProcessPanel`. This is the only way to reach a process from a conversation that never touched it.

Both open `components/processes/process-panel.tsx`, which refreshes through `lib/processes/use-process-detail.ts`. Neither can bind a session: activation is `activate_process`, a lead tool.

## Framework facts worth knowing

These cost real time to extract from `node_modules/eve`. They are stable for eve 0.47.x.

- **`action.result` carries the raw tool output, never `toModelOutput`.** `harness/action-result-helpers` decides that once, always raw. This is what lets `reduceProcessEvents` parse a full `processToolResultSchema` out of a stream event while the model only sees a one-line summary.
- **Only byte-backed file parts are staged to the sandbox.** `harness/attachment-staging` stages `data:` URLs and raw bytes. A `URL` instance goes to the channel's `fetchFile` resolver, and a plain `https` string is left alone for the provider to fetch. `eveChannel()` does **not** accept `fetchFile` (only `defineChannel` does), so on the browser channel a linked file is never staged.
- **`message.received` echoes the attachment back with its `data:` URL** on `data.parts[].url`. Persisting that doubles every attachment inside chat history forever; `lib/chat/events.ts` drops it and keeps the decoded size.
- **`localDev()` activates only under `EVE_DEV=1` or `vercel dev`**, and produces `principalId: "local-dev"`, which is *not* the web app's `marketing-room-user`. Plain `next dev` with no `EVE_CHAT_PASSWORD` gets a 401 from the agent even though the web app looks signed in.
- **Compaction drops file payloads** from summarized turns and replaces them with a text stub. Content parts are for "look at this now"; anything the agent may need later belongs in the sandbox or in Blob.
- **`ctx.getSandbox()`** is available inside any authored tool and returns the live sandbox (`run`, `spawn`, `readBinaryFile`, `writeTextFile`, `resolvePath`, …). Authored tools themselves run in the app runtime with full `process.env`, not in the sandbox.
- **The MCP channel publishes four tools** — `agent_start`, `agent_get`, `agent_update`, `agent_cancel` — at `/eve/v1/mcp`. It delegates to the same lead, so an MCP client shares the caller's process memory.

## Invariants

Break these and something silently rots:

1. Owner id comes from `ctx.session.auth.current` or `getServerViewer`, never from model input or a query parameter. An inaccessible process returns 404, not 403.
2. `/api/processes/*` and `components/processes/*` stay read-only. All writes travel through lead tools.
3. One `DATABASE_URL`, one database client (`lib/db/client.ts`). No second store, no session-process table.
4. Attachment limits live in one module and are mirrored, never re-declared.
5. Reserved Blob prefixes are refused by the generic asset tools. Adding a namespace means editing `agent/lib/vercel-blob/config.ts` and nothing else.
6. Tool and skill files export a factory *call*, never a re-export. `noBarrelFile` and `noExportedImports` enforce it.
7. Imports inside `agent/` use the `#lib/...` subpath and always carry a `.js` extension, even though the source is `.ts`.
8. Agent-facing prose follows the "How you write" rules in `agent/instructions/base.md`: no em dashes, no hype, no negative-capability framing.

## Environment matrix

`lib/setup.ts` — `computeSetupStatus` collapses the environment into three switches that most confusion traces back to:

| Condition | `authMode` | `storageMode` | `processStoreReady` |
| --- | --- | --- | --- |
| `DATABASE_URL` + Better Auth vars + Upstash | `vercel` | `database` | yes, once migrated |
| `EVE_CHAT_PASSWORD` set | `password` | `browser` | yes when `DATABASE_URL` is migrated |
| `NODE_ENV=development`, no password | `local-dev` | `browser` | same |
| none of the above | `unconfigured` | `browser` | no |

`processStoreReady` is the authority for whether the process panel may refresh. Password mode is a legitimate hybrid: chat in the browser, processes in Postgres.

For local development, `vercel env pull` does **not** bring `EVE_CHAT_PASSWORD` (it is Production-scoped). Either add one to `.env.local` or set `EVE_DEV=1`, otherwise the agent rejects every browser turn with a 401.

## Triage

| Symptom | Look here first |
| --- | --- |
| Agent returns 401 in local dev | auth chain in `agent/channels/eve.ts`; see the environment note above |
| Process pill never appears | it is per-conversation by design. Did a process tool commit *in this chat*? Otherwise use the sidebar list |
| Process panel says the binding is stale | the channel principal and the web viewer resolved to different ids |
| Attachment arrives but the agent cannot find it | it was sent as a URL rather than bytes, or the media type was rejected by `uploadPolicy` (413/415 on the POST) |
| "Browser storage is full" | `lib/chat/local-store.ts` quota. Something large is being persisted into the event log |
| A new tool does not show up | `npx eve info`, then `.eve/discovery/diagnostics.json`. Usually a re-export instead of a factory call, or a bad filename |
| Skill silently missing | unquoted colon in the YAML `description`, or a name that does not start with an alphanumeric |
| Types pass but the build fails | check disk space; the TypeScript step writes `.next/cache/.tsbuildinfo` |

## Verifying a change

```bash
pnpm test        # vitest: contracts, projection, repository, tools, routes, UI projection
pnpm validate    # ultracite + typecheck + eve info, must be 0 errors / 0 warnings
pnpm build       # production Next build with the embedded eve runtime
npx eve info     # 5 subagents, 17 root tools. Its Skills count covers the root only, so it reads 0
```

Database behavior additionally needs a migrated disposable `DATABASE_URL` and `RUN_DATABASE_TESTS=1 pnpm vitest run lib/processes/repository.integration.test.ts`.

Anything touching the browser is worth exercising for real: `pnpm dev`, send one turn, reload mid-stream, and confirm the event log replays.
