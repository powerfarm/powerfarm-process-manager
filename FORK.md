# PowerFarm Process Manager: origin and adaptation

Created on 2026-09-09 at the user's request to preserve the existing marketing team's work and carry out the process-manager adaptation in an independent repository.

## Provenance

- New repository: https://github.com/powerfarm/powerfarm-process-manager
- Source repository: https://github.com/danvoulez/marketing-team-eve-template
- Source main commit: `20621fe06c64dd3a24b14b02335d841b965f8244`
- Source tree: `eca2656576310993fc1eee6d76a5f5b68cac4408`
- Unmodified foundation tag: `foundation/marketing-room`
- Original template: https://github.com/vercel-labs/marketing-team-eve-template
- Original template commit: `295fe26`
- License: MIT, including the original Vercel copyright notice in `LICENSE`.

The initial copy preserves the complete history reachable from source main, including the original prompts and subsequent process-memory, attachment, MCP, and governed GitHub artifact work. Source branches, issues, pull requests, deployment settings, and live data are not duplicated by this source-code copy.

## Working boundary

All process-manager adaptation belongs in this repository. Its origin remote points only to this repository. The original checkout, GitHub repository, and live Marketing Room remain unchanged.

The new checkout contains tracked source files, not the original `.env`, `.vercel`, sandbox state, or build output. A future deployment needs its own deliberate resource configuration. Compatibility of identifiers does not imply that this copy should automatically write to the original live database or Blob store.

## Adaptation map

The following is the mapped direction, not a claim that these roles already exist.

| Area | Proposed adaptation | Preserve |
| --- | --- | --- |
| Lead | Process Manager, coordinating work and maintaining process memory | Complete briefs, dependency ordering, caveats, lead-only process writes |
| Specialists | Process Analyst, Investigator, Planner, Operator, Verifier | Bounded responsibilities, isolated contexts, evidence discipline and artifact handoffs |
| Shared context | Derive briefs from the active process, projection and governed sources | Personal preferences; existing stored documents remain recoverable |
| Artifacts | Add general brief, plan, candidate, evidence and verification types | Readability of existing marketing artifact IDs |
| Connections | Align tools with each new role; decide which marketing capabilities remain optional | Approval semantics and exact tool allow-lists |
| UI | Process-manager identity, role roster, composer, metadata, accessibility labels and Slack prompts | Process pill, status, read-only panel, graph, history, attachments and chat |
| Documentation | Update instructions, architecture, system map and examples as code changes | Explicit distinction between implemented behavior and proposals |
| Verification | Exercise delegation boundaries and durable process continuity | Existing ownership, concurrency, provenance and UI tests |

The Operator's first release scope remains to be settled: Sandbox candidates alone, or a separately bounded draft-PR write path. The repository copy does not add either capability.

## Compatibility

Keep `marketing-team.active-process` and the existing principal identifiers stable until any migration is explicitly designed. They are storage and ownership keys, not presentation labels. Existing connector UIDs and Blob paths likewise require deliberate compatibility handling.

Retain the existing process graph, append-only events, version checks, authenticated read routes, session binding, MCP and GitHub observation machinery. Do not replace the global mutable brand document with another global mutable document named process context; process context comes from the process itself.

## Current status

Repository creation and the source copy are complete. The baseline tree matches the source main tree exactly. This initial follow-up changes documentation only; the application still has its original marketing roles. No new deployment, credential copy, or live-data migration has occurred.
