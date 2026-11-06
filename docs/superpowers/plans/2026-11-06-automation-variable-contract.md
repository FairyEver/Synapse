# Automation variable contract implementation plan

> Execute in the current main checkout using superpowers:executing-plans. User authorized implementation and one local commit; no push, branch/worktree, dependency, server or app startup.

Goal: implement the seven findings from the product review in this conversation.

## Decisions

- Each trigger discovers one canonical variable per value. Descriptor aliases preserve the old mail url and Webhook payload.request paths, but never messageId. No persistent data migration.
- triggeredAt is source occurrence (scheduled trigger activation, Webhook receive time, letter source time); executedAt is actual executor preparation. Event receivedAt is local enqueue/receive time, not execution time. scheduledAt is displayed only for schedules. date uses schedule time (including catch-up) or event occurrence in the effective timezone; manual uses execution time. runId identifies the actual run.
- Shared variable contract validates prompt references in renderer and main create/update/enable/runtime. Unknown, retired and malformed references fail with actionable errors. Compatibility metadata is explicit, not a blanket trigger.* allowlist.
- Webhook paths resolve from original data on demand independent of flatten budgets. Dot paths select nested properties; JSON Pointer suffix #/ selects literal keys. Own properties only, at most 64 segments / 2048 path characters. Null/empty are legal; absent fields and exceeded limits fail explicitly.
- Webhook manual run requires receipt context and is disabled in UI/main. JSON sample preview tests variable selection locally without executing an Automation or storing sample data.
- External mail adds senderAddresses, replyToAddresses (Reply-To then From), sentAt. Internal mail adds senderId, senderKind, sentAt; system broadcasts have no replyable user ID. Attachments include attachmentId and, for external mail, assetId usable by existing tools. No hidden recipient expansion, attachment downloads or marking read.

## Tasks and validation

- [x] Runtime: failing tests for wide/deep/colliding paths, missing/null/zero, event-free rendering, effective timezone, catch-up date, delayed event execution; implement shared path helpers and runtime resolution.
- [x] Metadata and validation: shared canonical descriptors, aliases, examples; tests for typo/retired/malformed variables, disabled creates, failed updates, enable and automatic execution. Preserve registered custom triggers without descriptor contracts.
- [x] Mail and manual execution: test address fallback, broadcast sender, attachment locators, enqueue timestamps and context-free Webhook rejection; implement minimal payload and guard changes.
- [x] UI: shared validator, JSON sample preview and JSON Pointer path entry; interaction tests for preview, malformed/missing/null values, grouping and aliases. Do not start app/browser.
- [x] Update capability registry, module boundaries, source design documents, MCP/Skill guidance and pending release notes. Run focused main/renderer suites, desktop typecheck and hard constraints; inspect final diff and commit only task files in Chinese, without push.

Review focus: distinguish absent from null; no prototype traversal or path collision; catch-up across midnight and timezone; metadata updates still bypass activation hooks; legacy persisted prompts are diagnosed without deleting configuration or silently restoring messageId.


## Execution record

- Implemented all five tasks in the current main checkout; no dependencies, branch/worktree, app/browser startup, migration, deployment or push.
- Independent review found and confirmed fixes for static aliases under a wide Body, gateway/local Webhook timestamps, and template-delimiter keys in JSON Pointer. Each finding received a failing test followed by a passing regression.
- Another chat concurrently changed V2 compatibility in overlapping files. Only this task's changes are staged; compatibility format/revision rules, tests and documents remain outside this commit. Validation reads the exact staged files through in-memory compiler/Vite hosts in the existing checkout; no alternate checkout was created.
- Staged snapshot: 299 main/runtime/MCP/executor tests and 260 renderer tests passed (559 total). All four TypeScript projects (electron, renderer, tests, preload) reported zero errors; hard-constraint check passed. Test logs are local only: `/tmp/synapse-variable-index-main.log`, `/tmp/synapse-variable-index-ui.log`; verification helper is `/tmp/synapse-verify-variable-index.mjs`. No online report link.
- Full shared-workspace attempts encountered the concurrent task's future-revision/configuration tests, dispatcher compatibility errors and DataNamespace type errors; these were not repaired or committed here. Snapshot testing excludes the untouched retired-executor-cleanup suite because its esbuild subprocess reads concurrently modified working files directly, bypassing the in-memory snapshot. That suite passed in the earlier 234-test run before the concurrent edits; no cleanup code is part of this change.
- No real application/window validation was performed. Legacy messageId remains retired; saved prompts using it need replacement. Missing Webhook fields now fail explicitly rather than silently becoming empty strings; null/empty remain valid.
