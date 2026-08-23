# ARCHITECTURE.md

This document maps how the agent is put together, for humans and AI agents working in the repo. Keep it current as the codebase evolves.

## Project identification

- **Name:** `marketing-team-eve-template`
- **Maintainer:** Vercel Labs
- **License:** MIT
- **Last updated:** 2026-08-23

## Overview

Marketing agents arranged as a hierarchy on the [eve](https://eve.dev) framework. The root **lead** grounds itself in a shared brand context document and this user's standing preferences, then routes the request to exactly one specialist. `product-marketer` owns positioning: the competitive alternatives, the segment, the message hierarchy, and the shared brand context document itself. `content-marketer` owns long-form: content planning by buyer stage, then blog posts, landing pages, case studies, newsletters, and docs, written into Notion rather than handed back as chat text. `social-media-coordinator` owns short-form: posts and threads for X, LinkedIn, Threads, Bluesky, and Mastodon, plus the Typefully queue and Notion briefs. `seo` owns organic search: page and site audits, hierarchy and internal linking, JSON-LD schema, and templated page sets. `email` owns the email channel: taking copy that already exists, reworking it to survive an inbox, then building, targeting, and sending it in Resend. No specialist delegates further: each gathers its own evidence with the framework's `web_search` and `web_fetch`, and the ones that touch prose run their own review pass against the editing rubrics before handing work back. Shared state (brand context, per-user preferences, assets) lives in Vercel Blob.

The five specialists do not overlap by accident. `product-marketer` decides what the team claims, `content-marketer` writes the words, `seo` decides which pages should exist and whether one is findable, and `social-media-coordinator` and `email` are the two that can put something in front of an audience. Where their guidance touches the same number, such as title length or internal-link counts, the specs are kept in agreement rather than duplicated silently.

`content-marketer` and `email` are the pair most likely to blur, so the split is by job rather than by artifact: the content marketer authors the prose, and the email agent adapts it and operates the channel. A newsletter is therefore two hops, and the lead chains them with an artifact id or a Notion link rather than briefing both. The email agent's own writing work is the email-fit pass (subject and preview text, one call to action, the plain text version, link and alt text hygiene), never a draft from nothing.

The dependency runs one way. The product marketer writes the brand context document, and the other three read it at the start of every task. That makes it the one piece of shared state whose quality bounds everything else, which is why one specialist owns authoring it and its structure is a skill rather than a convention.

There is no central registry or wiring file: a tool's name is its filename, a subagent's name is its directory name, a connection's name is its filename, and a skill's name is its directory name. eve walks `agent/` at build time and produces a manifest from what it finds. Adding a specialist means adding a directory; removing one means deleting it. `npx eve info` prints the resulting surface.

## Project structure

```text
app/                                # Next.js routes, auth endpoints, and durable chat pages
components/                         # Marketing Room, chat, auth, and UI components
lib/                                # browser/server auth, chat persistence, setup, and Neon schema
next.config.ts                      # withEve(): one origin and one Vercel project
agent/
  agent.ts                          # lead: model and compaction threshold
  instructions/
    base.md                         # lead behavior: ground, route, and process-memory rules
    process-context.ts              # user-role active-process projection on turn.started
  sandbox.ts                        # Vercel Sandbox backend for the lead
  channels/
    eve.ts                          # inbound route for the TUI and your own front end
    slack.ts                        # inbound route for Slack, credentials via Vercel Connect
  tools/
    {create,activate,deactivate}_process.ts # session binding and process lifecycle
    {find,read,inspect}_process*.ts         # owner-scoped bounded reads
    {mutate,change,update}_process*.ts      # typed graph/state/tag commits
    get_brand_context.ts            # read the team's shared product/positioning/voice document
    save_brand_context.ts           # overwrite it (no approval gate)
    get_user_preferences.ts         # read this principal's standing preferences
    save_user_preferences.ts        # write them
    clear_user_preferences.ts       # delete them (approval: always)
    read_artifact.ts                # read a handoff artifact by id, on request
  lib/                              # shared typed helpers; imported as #lib/<domain>/<file>.js
    vercel-blob/{config,tools}.ts   # Blob key layout, reserved-prefix guards, 5 asset tool factories
    brand-context/{config,tools}.ts # brand context key + size cap, get/save tool factories
    user-preferences/config.ts      # principal-scoped key + size cap (no tools; consumed by root tools)
    content/{config,tools}.ts       # style-skill layout + match helpers, lintAgainstStyleTool(surfaces)
    artifacts/{config,tools}.ts     # artifact key layout + id format, save/readArtifactTool()
    tracking/{config,tools}.ts      # campaign-tag vocabulary, buildTrackedLinkTool(surfaces)
    writing-quality/{config,skill}.ts # the shared prose-rules skill, used by every prose agent
    processes/{config,tools}.ts     # defineState binding and lead-only process tool factories
  subagents/
    product-marketer/
      agent.ts  instructions.md     # interview, position, then write the shared document
      sandbox.ts                    # its own sandbox; subagents inherit nothing
      connections/notion.ts         # Notion MCP: search, read, edit pages and databases
      skills/positioning/           # alternatives, segment, differentiators, statement
      skills/messaging/             # hierarchy, value props per audience, objections, grades
      skills/customer-research/     # interview questions, mining customers' own words
      skills/brand-context/         # the shared document's structure and merge rules
      tools/                        # 5 asset tools, get/save_brand_context, save/read_artifact,
                                    #   bash disabled
    social-media-coordinator/
      agent.ts  instructions.md     # short-form drafting, platform fit, queue management
      sandbox.ts                    # its own sandbox; subagents inherit nothing
      connections/typefully.ts      # Typefully MCP: read/create/edit drafts, schedule, analytics
      connections/notion.ts         # Notion MCP: search, read, edit pages and databases
      skills/x-style/               # per-surface voice, specs, and banned-words list
      skills/linkedin-style/
      skills/threads-style/
      skills/bluesky-style/
      skills/mastodon-style/
      skills/writing-quality.ts     # surface-independent prose rules (shared from lib)
      tools/                        # 5 asset tools, get/save_brand_context, lint_against_style,
                                    #   save/read_artifact, bash disabled
    content-marketer/
      agent.ts  instructions.md     # planning then drafting long-form
      sandbox.ts                    # its own sandbox; subagents inherit nothing
      connections/notion.ts         # Notion MCP: the finished piece is written here
      skills/blog-style/            # blog voice, format specs, banned words
      skills/content-planning/      # buyer stages, pillars and clusters
      skills/content-editing/       # editing in separate passes
      skills/writing-quality.ts     # surface-independent prose rules (shared from lib)
      tools/                        # 5 asset tools, get_brand_context, lint_against_style,
                                    #   save/read_artifact, bash disabled
    seo/
      agent.ts  instructions.md     # audit what it can see, plan what should exist
      sandbox.ts                    # its own sandbox; subagents inherit nothing
      connections/notion.ts         # Notion MCP: search, read, edit pages and databases
      skills/seo-audit/             # priority-ordered checks, marked fetch vs tool-only
      skills/site-architecture/     # hierarchy, URL patterns, navigation, internal linking
      skills/schema/                # JSON-LD per type, plus validation
      skills/programmatic-seo/      # 12 patterns, data defensibility, thin-content failure
      tools/                        # 5 asset tools, get_brand_context, save/read_artifact,
                                    #   bash disabled
    email/
      agent.ts  instructions.md     # adapt copy for the inbox, then build and send in Resend
      sandbox.ts                    # its own sandbox; subagents inherit nothing
      connections/resend.ts         # Resend MCP: allow-listed; sends and deletes gated
      connections/notion.ts         # Notion MCP: reads the piece the content marketer wrote
      skills/email-style/           # inbox voice, sourced format limits, banned words
      skills/email-adaptation/      # what to cut, pointer vs whole-thing, per-type patterns
      skills/deliverability/        # checks marked by the tool that verifies them, or none;
                                    #   plus the legal gate (postal address, consent, opt-out)
      skills/resend-build/          # tool order, the compose/html mode trap, the send gate
      skills/writing-quality.ts     # surface-independent prose rules (shared from lib)
      tools/                        # 5 asset tools, get_brand_context, lint_against_style,
                                    #   save/read_artifact, bash disabled
```

## Core components

| Component | Lives in | eve primitive | Responsibility |
| --- | --- | --- | --- |
| Marketing Room | `app/`, `components/`, root `lib/` | `withEve`, `useEveAgent` | Same-origin browser chat with streamed messages, reasoning, tool cards, approvals, connection authorization, durable URLs, reload recovery, and sidebar history. |
| Browser identity | `lib/eve-auth.ts`, `lib/password-auth.ts`, `lib/auth.ts` | channel auth | Resolves a user principal from the starter password cookie or Better Auth. This principal owns chats and authorizes user-scoped Notion and Resend grants. |
| eve channel | `agent/channels/eve.ts` | channel | Inbound session routes for the web app and terminal UI. Tries Better Auth, password auth, trusted local development, and Vercel OIDC; browser traffic fails closed when none resolves. |
| Slack channel | `agent/channels/slack.ts` | channel | Inbound route for Slack. Answers mentions and DMs, and auto-replies to un-mentioned messages only in a subscribed thread whose original requester is still the sole human participant. Credentials and webhook verification come from Vercel Connect. |
| Lead runtime | `agent/agent.ts`, `agent/instructions/` | agent | Loads brand context and preferences, picks one specialist, writes the brief, returns the specialist's work without rewriting it, and maintains any explicitly active process. Runs the same model as the specialists; it routes rather than produces, so a cheaper tier here is the first cost lever to reach for. |
| Process session binding | `agent/lib/processes/config.ts` | `defineState` | Stores only the active process id and observed projection version for one Eve session. It survives resume and compaction but is not shared with specialists or other sessions. |
| Process context loader | `agent/instructions/process-context.ts` | dynamic instructions | On `turn.started`, loads only the owner-scoped process envelope and visible projection columns as user-role application data. Raw graph rows and event history stay out of the prompt. |
| Process tools | `agent/tools/*process*.ts`, `agent/lib/processes/tools.ts` | tools | Ten lead-only tools create, bind, query, and commit typed graph, state, and tag operations. Server context supplies owner, session, turn, tool, and `ctx.callId`; the model supplies none of that provenance. |
| Process store | `lib/processes/`, `lib/db/schema.ts` | application Postgres | Stores process envelopes, nodes, edges, materialized human projections, and an append-only event log in the existing `DATABASE_URL`. Mutations use row locking, expected versions, and unique mutation keys in a transaction. |
| Process UI | `components/processes/`, `app/api/processes/` | Eve stream + authenticated GET | Reconstructs the active pill from persisted `action.result` events, then refreshes summary, graph, and log through owner-scoped read-only routes. No HTTP mutation route exists. |
| Shared state tools | `agent/tools/*.ts` + `lib/brand-context`, `lib/user-preferences` | tools | Read and write the team-wide brand context and the per-user preference document in Blob. |
| Social media coordinator | `agent/subagents/social-media-coordinator/` | subagent | Drafts short-form for five platforms, drives the Typefully queue, reads and writes Notion. Owns six skills. |
| Product marketer | `agent/subagents/product-marketer/` | subagent | Interviews the user, researches the competitive set, decides positioning and messaging, then writes the shared brand context document. The only specialist whose deliverable is that document rather than a piece of work. Owns four skills and a sandbox. Grades every claim `proven`, `plausible`, or `assumption`, so downstream agents know when to hedge. Does not draft posts, pages, or campaigns. |
| Content marketer | `agent/subagents/content-marketer/` | subagent | Plans content by buyer stage, then drafts long-form. Owns four skills and a sandbox. Does not publish, schedule, or touch social accounts. |
| SEO | `agent/subagents/seo/` | subagent | Audits a page against what a fetch can actually show, plans hierarchy, URLs and internal linking, writes JSON-LD, and scopes templated page sets. Owns four skills and a sandbox. Recommends titles, meta descriptions, and slugs; hands body copy to the content marketer. Has no crawler, rank tracker, or Search Console, and says so instead of inferring. |
| Email | `agent/subagents/email/` | subagent | Takes copy the content marketer (or the user) already wrote, reworks it for an inbox, then builds the template or broadcast in Resend, picks a verified from address, targets the segment, and reports delivery. Owns four skills and a sandbox. Does not originate long-form prose, and says so rather than producing a thin version of it. Cannot see inbox placement or domain reputation, and marks every deliverability check with the tool that verifies it. |
| Typefully connection | `.../connections/typefully.ts` | connection | Remote MCP. Deletes always pause for approval; create and edit pause only when the call schedules a post. |
| Resend connection | `.../email/connections/resend.ts` | connection | Remote MCP, user-scoped OAuth through Vercel Connect, the same as Notion. The only connection that narrows discovery: `tools.allow` cuts around 85 published tools to the 47 that make up the campaign, list, diagnostic, and read-only-domain surface, leaving out API keys, webhooks, and domain writes entirely. Sends (`send-broadcast`, `send-email`, `send-batch-emails`) and destructive calls always pause for approval, scheduled or not, since Resend splits composing from committing into separate tools. The connector issues only `user` tokens, so sends are attributed to the person who approved them. |
| Notion connection | `agent/connections/notion.ts` and one per specialist | connection | Remote MCP, user-scoped OAuth, identical in all six copies. Updates, moves, and view changes pause for approval; page creation is deliberately ungated, since drafting into Notion is the normal flow. |
| Asset tools | `lib/vercel-blob/tools.ts`, wired per agent | tools | Upload, list, inspect, download, and delete Blob assets. Deletes pause for approval; the reserved brand-context and preference prefixes are refused. |
| Style lint | `lib/content/tools.ts` | tool factory | Reads `references/banned-words.json` from the calling agent's `<surface>-style` skill and returns `{ ok, violations }`. The coordinator passes five surfaces; the content marketer passes `blog`; the email agent passes `email`. |
| Handoff artifacts | `lib/artifacts/` | tool factories | `save_artifact` writes a Markdown document to a private Blob under the reserved `artifacts/` prefix and returns an id; `read_artifact` reads it back through the authenticated path. All five specialists hold both. The lead holds only the reader, so a long document can be relayed between specialists by id without passing through the lead's context. This is also the main channel from the content marketer to the email agent. |
| Campaign tracking | `lib/tracking/` | tool factory | `build_tracked_link` adds `utm_*` parameters to a batch of links, deriving source and medium from the surface and normalizing the campaign name, so one campaign doesn't arrive in analytics as several spellings. Held by the coordinator and the email agent. Deliberately not on links between pages of your own site. |
| Writing quality | `lib/writing-quality/skill.ts` | skill factory | The surface-independent prose rules and their two reference lists, defined once and called from a one-line `skills/writing-quality.ts` in each agent that drafts or edits prose. `defineSkill` materializes the references as real sibling files, so the compiled package matches an authored directory. |

The eve channel and optional Slack channel are the inbound boundaries, and Blob plus the three MCP servers are the outbound ones. The browser reaches the eve channel through same-origin `/eve/v1/*` routes mounted by `withEve()`. Everything else is model reasoning over loaded skills. Each specialist call starts a fresh session with none of the lead's conversation, skills, connections, or sandbox, so the lead's job is to write a complete `message`. The tree is one level deep: the lead delegates, and specialists do not.

## Data flow

```text
you
 └─ Marketing Room or optional Slack
     └─ eve channel (resolve principal)
         └─ lead
         ├─ active process id                               (Eve defineState, session only)
         ├─ active process projection                       (Postgres read on turn.started)
         ├─ process tools                                   (lead-only typed Postgres commits)
         ├─ get_brand_context / get_user_preferences        (Blob read)
         ├─ save_brand_context / save_user_preferences      (Blob write, ungated)
         └─ one specialist, briefed in full
             ├─ get_brand_context                           (Blob read, again: fresh context)
             ├─ save_brand_context                          (product-marketer: its deliverable)
             ├─ load_skill <surface>-style, writing-quality  (sandbox materializes references/)
             ├─ load_skill positioning, messaging, ...        (product-marketer only)
             ├─ load_skill seo-audit, schema, ...            (seo only)
             ├─ web_fetch a page under review                (seo only: server HTML, no JS)
             ├─ web_search / web_fetch                       (own research, source-budgeted)
             ├─ lint_against_style                           (banned-words check)
             ├─ save_artifact -> id                          (long output, private Blob)
             ├─ read_artifact <id>                           (an artifact the brief named)
             ├─ load_skill content-editing, writing-quality   (own review pass before handback)
             ├─ load_skill email-adaptation, resend-build     (email only)
             ├─ notion MCP tools                             (content-marketer: writes the page)
             ├─ typefully MCP tools                          (approval on scheduling and deletes)
             ├─ resend MCP tools                             (email only: allow-listed surface,
             │                                                 approval on every send and delete)
             └─ asset tools                                  (Blob)
```

A newsletter is the one request that routes twice. The lead calls `content-marketer`, which writes the piece into Notion and hands back a link (or saves an artifact and hands back an id), and the lead puts that into `email`'s brief. The email agent opens it, runs the email-fit pass, builds the broadcast, and stops at the approval gate.

## Data stores

- **Vercel Blob** — the document and asset store, one public store (`ASSETS_*`). Four namespaces: the team's shared brand context document under a reserved prefix, per-user preference documents under a reserved `user-preferences/` prefix keyed by resolved principal, handoff artifacts under a reserved `artifacts/` prefix (capped at 200,000 characters), and free-form assets everywhere else. The brand context and preference caps are 20,000 characters. The general asset tools refuse every reserved prefix so they can't read or overwrite state as a side channel.
- **Postgres process store** — `process`, `process_node`, `process_edge`, `process_projection`, and append-only `process_event` tables in the existing `DATABASE_URL`. It is owner-scoped and crosses Eve sessions. `process_projection` is a rebuildable read model; `process_event` rejects update and delete.
- **Notion** — the workspace the specialists read and write through MCP, and where the content marketer's finished pieces live. Owned by the user, not this project.
- **Typefully** — the social draft and schedule queue, reached through MCP.
- **Resend** — the email campaigns, templates, contacts, segments, and delivery records, reached through MCP. Owned by the user, not this project, and the only outbound integration whose writes reach people directly.
- **Chat history** — starter mode stores chat metadata, Eve session cursors, and event snapshots in the authenticated browser. Production mode stores the same records in Neon under the authenticated user id.
- **Session state** — eve manages the durable runtime session; the web app persists the cursor needed to reconnect and resume streaming. The lead's `defineState` stores only the active process binding. Compaction kicks in at 90% of the window for the lead and every specialist.

Neon is optional for browser chat but required for durable process memory. Password mode can therefore run as a hybrid: chat stays in authenticated browser storage while process graphs use Postgres. Full production mode uses the same Postgres configuration for both cross-device chat history and process memory. There is no second database client or process-specific environment variable.

## External integrations

| Integration | Purpose | Method |
| --- | --- | --- |
| Vercel AI Gateway | model access for every agent | ambient project credentials; models are plain gateway strings such as `anthropic/claude-opus-5` |
| Vercel Blob | brand context, per-user preferences, assets | `@vercel/blob` SDK |
| Notion | briefs, calendars, and the finished long-form pieces | remote MCP at `mcp.notion.com`, user-scoped OAuth through Vercel Connect |
| Typefully | social drafts, scheduling, post and follower analytics | remote MCP at `mcp.typefully.com`, static workspace API key |
| Resend | email campaigns, templates, contacts and segments, delivery records | remote MCP at `mcp.resend.com`, user-scoped OAuth through Vercel Connect, discovery narrowed by `tools.allow` |
| Vercel Sandbox | materializes each skill's `references/` files and runs `bash` | `defineSandbox({ backend: vercel() })` |
| Open web | research and fact-checking | the framework's default `web_search` and `web_fetch`, in each specialist; `bash` is disabled so fetching goes through `web_fetch` |

## Deployment & infrastructure

- **Platform:** Vercel. `vercel deploy` ships the Next.js app and eve runtime together; `pnpm build` verifies that combined output.
- **Stores:** one public Vercel Blob store. Auth is the project's OIDC token, so no Blob credential is stored.
- **Connectors:** Notion (`NOTION_CONNECTOR`, defaulting to `notion/marketing-team`) and Resend (`RESEND_CONNECTOR`, defaulting to `resend/marketing-team`) are the web app's configured integrations. Slack (`SLACK_CONNECTOR`) is optional and needs triggers pointed at `/eve/v1/slack`. Blob is provisioned as a store, not a connector.
- **Environment:** starter mode adds `EVE_CHAT_PASSWORD` as its shared access credential. Adding a migrated `DATABASE_URL` enables the process store without changing password auth or browser chat storage. Full production mode combines Better Auth, Neon, and Upstash variables. `TYPEFULLY_API_KEY` remains the only static outbound-service credential. Notion and Resend are authorized per user, while Blob and the model use the project's OIDC token. Resend needs a verified sending domain before anything can be sent.
- **Runtime:** Node 24.x, ESM, `moduleResolution: "bundler"`.
- **Local development:** `vercel link` then `vercel env pull`, then `pnpm dev` for the same-origin web app at `http://localhost:3000`. Use `pnpm dev:eve` for the terminal UI. The sandbox only starts against a linked and authenticated Vercel project.

## Development & testing

- **Web runtime:** `pnpm dev` starts Next.js and eve together. Verify auth, one streamed turn, reload recovery, approvals, and connection authorization in a real browser.
- **Runtime/TUI:** `pnpm dev:eve` talks to the same lead without the web layer.
- **Type checking:** `pnpm typecheck` generates Next.js route types and checks the complete app.
- **Unit tests:** `pnpm test` runs the Vitest contracts for projection, repository, service, Eve tools, dynamic context, authenticated routes, stream projection, browser loading, and status presentation.
- **Database integration:** after `pnpm db:migrate`, run `RUN_DATABASE_TESTS=1 pnpm vitest run lib/processes/repository.integration.test.ts` against a disposable Postgres database. These tests cover atomic commits, replay, owner isolation, projection rebuilds, and append-only enforcement.
- **Production build:** `pnpm build` compiles Next.js and the embedded eve service.
- **Lint/format:** `pnpm check` and `pnpm fix` (Ultracite / Biome).
- **Discovery diagnostics:** `npx eve info` prints the manifest, currently 5 subagents and 16 root tools. Its `Skills` and `Connections` counts cover the root only, so `Skills` reads `0`: all 23 skills belong to subagents, as do the Typefully and Resend connections. Detail lands in `.eve/discovery/diagnostics.json`.
- **Everything at once:** `pnpm validate`.

The local gate is `pnpm test`, `pnpm validate`, `pnpm build:eve`, and `pnpm build`. A real process acceptance test additionally needs a migrated `DATABASE_URL`, then two separate Eve sessions to prove cross-session activation and version refresh.

## Glossary

- **eve** — Vercel's agent framework. Discovers an agent's capabilities from the filesystem and produces a deployable app.
- **Channel** — an inbound entry point plus its auth chain. This project has one, `eve`.
- **Connection** — an MCP server the agent can call. Its tools appear to the model as `connection__<name>__<tool>`, for example `connection__notion__notion-create-pages`.
- **Tool** — a typed function in the app runtime, one default export per file, named after its filename.
- **Skill** — a `SKILL.md` plus optional `references/`, loaded on demand when its frontmatter `description` matches the situation. Scoped to the agent that declares it; there is no shared-skill mechanism, so shared procedures are copied.
- **Subagent** — a child agent exposed to its parent as a tool. It runs in a fresh session and inherits nothing, so the parent passes everything in `message`.
- **Principal** — the identity a channel resolves for the caller. Used to key per-user storage.
- **Process** — an owner-scoped durable graph plus human projection and append-only log. Sessions bind to it explicitly; there is no Project entity or session-process table.
- **Vercel Connect** — brokers per-user OAuth to third-party services, so the app holds no long-lived user tokens.
- **OIDC** — the short-lived, per-deployment token that lets the project authenticate to Vercel services such as Blob, the AI Gateway, and Sandbox without a static key.
