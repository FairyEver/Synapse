# CC Usage Fast Parser Design

## Status

Approved brainstorming direction on 2026-05-27.

This design replaces the current Synapse Claude Code usage scan path with a tokenusage-inspired parser pipeline. The change is intentionally scoped to Claude Code (`cc_*`) usage analysis. Codex (`cx_*`) can adopt the same architecture later, but is not part of this design.

## Goals

- Deprecate the current `startLine`-based Claude Code scanner and parser path.
- Keep the existing usage-analysis IPC surface, renderer pages, report shapes, and SQLite ledger tables where possible.
- Make repeat refreshes fast on large Claude Code JSONL directories.
- Make append-only Claude Code logs parse from byte offsets instead of rereading file prefixes.
- Avoid JSON parsing lines that cannot contribute usage or tool metadata.
- Avoid full aggregate rebuilds when only a small set of files changed.
- Preserve the RMB cost ledger rule: existing usage event costs are not silently repriced when price rules change.
- Keep all changes inside the existing Electron main-process usage-analysis service boundary.

## Non-Goals

- Do not introduce a Rust sidecar, native addon, or new runtime dependency in this change.
- Do not redesign the CC/Codex UI.
- Do not change Codex scanning in the first implementation.
- Do not add a live file watcher in this change.
- Do not parse or persist prompt text, assistant text, tool input payloads, or tool output payloads.
- Do not add historical repricing as part of the parser refactor.

## Existing Context

Synapse already has a usage-analysis module:

- `desktop/electron/services/usage-analysis/cc-parser.ts`
- `desktop/electron/services/usage-analysis/cc-service.ts`
- `desktop/electron/services/usage-analysis/scan.ts`
- `desktop/electron/services/usage-analysis/db-schema.ts`
- `desktop/electron/usage-analysis/ipc-handlers.ts`
- `desktop/src/modules/usage-analysis/`

The current refresh path is already isolated in a worker and stores data in `usage.db`. This is a good boundary to keep.

The current slow points are:

- `parseClaudeUsageFile()` uses `startLine`, but still opens a stream from byte 0 and skips old lines one by one.
- The parser attempts `JSON.parse()` for every non-empty line.
- Refresh loops through discovered files serially.
- Refresh always calls a full namespace aggregate rebuild after file processing.
- The scan file table tracks `line_count` but not `parsed_offset`.

The tokenusage reference implementation shows the better shape:

- file fingerprint by `size + mtime`;
- cached unchanged files;
- append-only parsing by seeking to a stored byte offset;
- line-prefix filtering before JSON decode;
- parallel file discovery and parse workers;
- cache invalidation by parser/pricing version.

## Chosen Approach

Implement the fast path in TypeScript inside the existing Synapse service.

This keeps packaging simple and avoids adding a Rust binary to Electron's startup-critical resources. The important performance win comes from not rereading and reparsing old log content, not from language choice alone.

## Architecture

The new CC refresh pipeline has these stages:

1. Discover Claude Code JSONL files.
2. Fingerprint each file.
3. Compare the fingerprint and parser state stored in SQLite.
4. Classify each file as unchanged, append, replace, missing, or failed.
5. Parse dirty files through the new offset parser.
6. Persist parsed sessions, usage events, tool events, and scan state.
7. Rebuild only affected aggregate buckets.
8. Return the existing refresh summary shape to the renderer.

The IPC methods remain unchanged:

- `usageAnalysis.cc.refresh()`
- `usageAnalysis.cc.getOverview()`
- `usageAnalysis.cc.getTime()`
- `usageAnalysis.cc.getModels()`
- `usageAnalysis.cc.getProjects()`
- `usageAnalysis.cc.getTools()`
- `usageAnalysis.cc.getDetails()`

## Data Model

Extend `cc_scan_files` with parser state:

- `parsed_offset INTEGER NOT NULL DEFAULT 0`
- `parser_version INTEGER NOT NULL DEFAULT 0`
- `pricing_rules_hash TEXT NOT NULL DEFAULT ''`
- `first_seen_at TEXT NOT NULL DEFAULT ''`
- `last_changed_at TEXT NOT NULL DEFAULT ''`

Keep existing columns:

- `file_path`
- `size`
- `mtime_ms`
- `line_count`
- `parse_status`
- `error_kind`
- `last_scanned_at`

`line_count` remains useful for diagnostics and migration compatibility, but append parsing must not depend on it.

Use a CC parser state version constant. Bump it when the stored scan-state shape changes.

Do not use parser version changes as a blanket reason to reparse all historical Claude Code files. A full historical reparse can change stored cost snapshots when users have edited price rules, which conflicts with the usage ledger rule. Parser-version migrations should prefer a metadata-only upgrade when the file was already parsed successfully.

Use a pricing rules hash for newly parsed events. If the price rules hash changes:

- unchanged files remain skipped to preserve ledger costs;
- append parsing uses current rules only for new events;
- replace parsing prices recreated events with current rules.

Do not force a full reparse solely because pricing rules changed.

## File Classification

For each discovered file:

- **Unchanged:** current `size`, `mtime_ms`, `parser_version`, and scan status match stored state. Skip parsing.
- **Append:** current `size > stored.size`, stored `parsed_offset > 0`, parser version matches, and the old file prefix is assumed append-only.
- **Legacy parsed:** stored row is `parsed`, current file is unchanged, but `parsed_offset` or parser state version is missing. Upgrade scan metadata to `parsed_offset = current size` and skip historical reparse.
- **Replace:** current `size < stored.size`, stored offset is invalid for append, the file content is suspected to have been rewritten, or stored parse status is not `parsed`.
- **Failed:** stat, open, read, or parse state write fails.

`mtime_ms` can change during an append. Size growth is the primary append signal. The final persisted state always stores the post-parse fingerprint.

If a file is appended while being parsed, store the actual offset reached by the stream and the fingerprint observed at commit time. A later refresh will catch any remaining bytes.

If a future parser change truly requires recalculating historical rows, it should be an explicit repair path with tests and product acknowledgement, not an automatic side effect of normal refresh.

## Parser Design

Replace `parseClaudeUsageFile(filePath, { startLine })` with an offset-based parser.

Proposed boundary:

```ts
parseClaudeUsageFileSegment({
  filePath,
  startOffset,
  mode,
  previousState,
  priceRules,
  pricedAt,
}): Promise<ParsedClaudeUsageSegment>
```

The parser returns:

- sessions touched by this segment;
- usage events;
- tool events;
- line count read in this segment;
- next byte offset;
- affected dates and hours;
- lightweight parser state needed for future append parsing.

The parser reads with `fs.createReadStream(filePath, { start: startOffset })`.

When `startOffset > 0`, the parser must protect against starting in the middle of a line. It should discard the first partial line unless the offset was known to be a line boundary from a previous parse. The stored `parsed_offset` should always be the byte after the last complete newline processed.

## Line Fast Path

Before `JSON.parse`, classify a line by substring checks.

For Claude Code:

- parse assistant lines that contain `"type":"assistant"` or `"type": "assistant"`;
- parse user lines only if needed for session conversation counters, using a minimal branch;
- skip empty lines, summaries, system entries, and other message types;
- skip any line that lacks both assistant and user markers.

The assistant branch extracts:

- timestamp;
- session id;
- message id;
- request id;
- model;
- token usage;
- thinking/reasoning token count when available;
- tool use block names and ids.

The user branch should never persist content. If counting user messages requires JSON parsing, only store numeric counters and timestamps.

## Dedupe

Keep Claude assistant usage dedupe compatible with tokenusage:

- if both `message.id` and `requestId` are present, use `${messageId}:${requestId}`;
- otherwise fall back to the existing event id behavior.

For append parsing, store a bounded recent dedupe key list per file or session. A limit around 8192 keys is enough for retry/rewrite overlap without unbounded growth.

The dedupe state can live in `cc_scan_files` only if encoded compactly, but a separate table is cleaner if the state grows:

```text
cc_scan_file_state(
  file_path TEXT PRIMARY KEY,
  state_json TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL DEFAULT ''
)
```

Prefer this table if implementation would otherwise overload `cc_scan_files`.

## Persistence

Keep the existing usage ledger tables:

- `cc_sessions`
- `cc_usage_events`
- `cc_tool_events`
- `cc_daily_usage`
- `cc_hourly_usage`

For replace mode:

- delete events for sessions associated with the file;
- insert parsed rows;
- refresh session summaries;
- mark scan state with the latest fingerprint and offset.

For append mode:

- insert or replace only new events;
- update session summaries for touched sessions;
- update scan state with the new offset and fingerprint.

Event ids must remain stable for existing rows. New append events should use the same id scheme as the current parser when possible:

- `${sessionId}:usage:${messageId || lineBoundaryIdentifier}`
- `${sessionId}:tool:${messageId || lineBoundaryIdentifier}:${blockId}`

If line numbers are no longer reliable in append mode, use byte offsets for fallback ids. This avoids collisions when only tail segments are parsed.

## Aggregate Rebuild

Deprecate the unconditional full aggregate rebuild in CC refresh.

The parser and persistence layer should track affected buckets:

- affected dates from usage events and tool events;
- affected hours from usage events and tool events;
- buckets previously associated with replaced sessions.

For affected dates:

1. Delete `cc_daily_usage` rows for those dates.
2. Reinsert daily usage aggregates from `cc_usage_events` for those dates.
3. Reinsert daily tool-call aggregate rows from `cc_tool_events` for those dates.

For affected hours:

1. Delete `cc_hourly_usage` rows for those hours.
2. Reinsert hourly usage aggregates from `cc_usage_events` for those hours.
3. Reinsert hourly tool-call aggregate rows from `cc_tool_events` for those hours.

Keep `rebuildAggregates(db, "cc")` as a repair path for:

- schema migration;
- tests;
- detected aggregate corruption;
- explicit forced rebuild;
- parser version migration if needed.

Report reads may continue to call `ensureAggregatesReady()`, but it should not turn ordinary reads into repeated full rebuilds.

## Discovery

The first implementation may keep `collectJsonlFiles()` if the main bottleneck is parsing.

If cold scans remain slow, replace recursive serial discovery with a bounded parallel directory walker in TypeScript. Do not add a dependency for this unless measurement shows it is necessary.

Discovery must continue to support the roots resolved by `resolveClaudeUsageRoots()`:

- `~/.claude/projects`
- `CLAUDE_CONFIG_DIR/*/projects`
- Claude Desktop local-agent and claude-code session roots

Do not change root resolution semantics in this refactor.

## Error Handling

- Failed files should update `cc_scan_files.parse_status = 'failed'` with `error_kind`.
- A failed dirty file must not delete previously persisted rows unless replacement persistence has already completed transactionally.
- Append parse failure must leave the old `parsed_offset` unchanged.
- Replace parse failure must leave old rows and old scan state intact.
- Aggregate partial rebuild must run in a transaction.
- Database write locks should continue to use the existing retry helper.
- Empty catches are not allowed.

## Privacy

The parser must never persist:

- prompt text;
- assistant text;
- thinking text;
- tool input JSON;
- tool output JSON;
- command output.

Tests should assert that known secret strings in input JSONL do not appear in parsed output or stored report rows.

## Migration

Schema migration is additive:

1. Add new `cc_scan_files` columns.
2. Optionally create `cc_scan_file_state`.
3. Existing rows with missing `parsed_offset` default to `0`.
4. On first refresh after upgrade, already parsed legacy files with matching `size` and `mtime_ms` are upgraded to `parsed_offset = current size` without reparsing history.
5. Files that changed since the old scan record are handled by append or replace classification.

This means upgrade should not force a cold parse for users with a valid existing `cc_scan_files` ledger. Fresh databases and previously failed files still parse normally.

The migration must not delete existing usage rows by itself.

## Testing

Focused main-process tests should cover:

- unchanged current-state files are skipped by fingerprint and parser state version;
- append refresh reads from byte offset instead of line skip;
- append refresh preserves existing event costs and prices only new events;
- append refresh updates scan state offset and line count;
- shrinking a file triggers replace mode;
- legacy parsed scan rows are upgraded to offset state without repricing historical events;
- parser state version changes do not force historical reparse when metadata-only upgrade is possible;
- assistant line prefix filtering skips unrelated JSON lines before parsing;
- user and assistant content are not persisted;
- duplicate Claude assistant usage is deduped by message/request key;
- append fallback ids based on offsets do not collide;
- partial aggregate rebuild updates only affected day/hour buckets;
- aggregate repair path still rebuilds all CC aggregates when explicitly called;
- disappeared files are marked failed without aborting the whole refresh;
- database lock retry still covers scan state, event writes, and aggregate writes.

Validation commands:

```bash
pnpm --filter @synapse/desktop exec vitest run electron/services/usage-analysis/__tests__/cc-parser.test.ts
pnpm --filter @synapse/desktop exec vitest run electron/services/usage-analysis/__tests__/scan.test.ts
pnpm --filter @synapse/desktop exec vitest run electron/services/usage-analysis/__tests__/reports.test.ts
pnpm --filter @synapse/desktop exec vitest run electron/services/usage-analysis/__tests__/refresh-runner.test.ts
pnpm --filter @synapse/desktop run check:hard-constraints
```

## Performance Checks

Add a small synthetic benchmark test or script only if it does not make normal test runs flaky.

At minimum, manual verification should measure:

- cold parse on a fixture directory;
- warm refresh with no file changes;
- append refresh after adding one assistant line to a large file;
- replace refresh after truncating a file.

Expected shape:

- warm refresh should avoid parsing unchanged files;
- append refresh time should scale with appended bytes, not full file size;
- aggregate refresh time should scale with affected buckets, not full usage history.

## Rollout

Implementation should be staged:

1. Add schema fields and parser-state types.
2. Build the offset parser with tests.
3. Replace CC refresh classification and persistence.
4. Add partial aggregate rebuild.
5. Keep full rebuild as a fallback and repair path.
6. Run focused usage-analysis tests and hard-constraint checks.

## Release Notes

This is user-visible and should update `RELEASE_NOTES_PENDING.md` during implementation.

Suggested entry:

```markdown
- Claude Code 使用分析刷新改为增量解析，日志文件追加后只读取新增内容，大型历史记录下刷新更快。
```
