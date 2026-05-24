# Knowledge Base Programmatic Parallel Ingest Design

## Problem

The current Knowledge Base ingest path has a central post-turn finalizer for `.raw/.manifest.json` and `address_map`, and it can expose a restricted `synapse-kb-ingest-worker` SDK agent to local Knowledge Base conversations. That is enough to prevent the most dangerous naive copy of upstream `agents/wiki-ingest.md`, but it still leaves the actual parallelism to the LLM coordinator.

The remaining gap is orchestration. If the main LLM coordinator decides when to invoke workers, how to partition sources, and how to normalize worker reports, then parallel ingest is still only partially programmatic. Synapse cannot reliably reason about per-source success, retry, source-page ownership, or worker output validity before the merge phase.

The root issue is not the existence of a worker agent. The root issue is ownership:

- workers must not write `.raw/.manifest.json`, `.vault-meta/address-counter.txt`, or DragonScale addresses;
- workers must not compete on shared maintenance pages such as `wiki/index.md`, `wiki/hot.md`, and `wiki/log.md`;
- workers must not concurrently merge shared concept/entity pages without a coordinator;
- Synapse must remain the single writer for manifest source records and `address_map`.
- Synapse, not the LLM, should own source partitioning and worker report validation.

## Goal

Add a Knowledge Base-only programmatic parallel ingest runner that:

- keeps user vaults clean and Obsidian-compatible;
- assigns each changed `.raw/` source to exactly one worker task;
- restricts each worker to one source-owned `wiki/sources/...` target page;
- collects machine-readable worker reports;
- runs one merge coordinator for shared semantic pages;
- writes `.raw/.manifest.json` and `address_map` only through the Synapse finalizer.

## Non-Goals

- Do not write Claude Code agents, skills, hooks, commands, or runnable scripts into the user Knowledge Base directory.
- Do not add a Scheduler or Workflow path for Knowledge Base ingest.
- Do not introduce a renderer UI.
- Do not build a generic Agent worker pool for all Synapse features.
- Do not let workers edit shared maintenance pages or `.raw/.manifest.json`.
- Do not make worker tasks update `wiki/concepts/`, `wiki/entities/`, or `wiki/questions/`.
- Do not make the manifest finalizer trust worker claims without verifying preflight hashes and actual wiki file changes.

## Architecture

Synapse will add `KnowledgeBaseParallelIngestRunner` under `desktop/electron/services/knowledge-base/`. The runner is a Knowledge Base service, not a general Agent Runtime feature. It is invoked only from local renderer Knowledge Base ingest turns after `KnowledgeBaseIngestCoordinator.prepareTurn()` has scanned `.raw/` and stored preflight state.

The runner has two LLM phases with a strict ownership boundary:

1. **Worker phase:** Synapse creates one task per changed source. Each worker reads only the assigned `.raw/...` source and writes only the assigned source-owned page under `wiki/sources/`. Each worker outputs one `synapse_kb_worker_report`.
2. **Merge phase:** Synapse passes validated worker reports to one merge coordinator. The merge coordinator updates shared wiki pages (`wiki/concepts/`, `wiki/entities/`, `wiki/questions/`, `wiki/index.md`, `wiki/hot.md`, and `wiki/log.md`) and emits one final `synapse_kb_ingest_report`.

The manifest finalizer remains the only writer for `.raw/.manifest.json` and `address_map`. The finalizer validates preflight source hashes, wiki snapshot diffs, page existence, duplicate source claims, and address assignment before writing.

The existing SDK subagent contribution remains useful for the current LLM-coordinated path, but the programmatic runner must not depend only on subagent policy hooks. Direct worker sessions need their own root-level write guard, because they may not run as SDK subagents with `context.agentID`.

## Components

### `KnowledgeBaseIngestTaskPlanner`

Creates deterministic tasks from preflight changed sources.

Task fields:

- `taskId`
- `sourcePath`
- `sourceHash`
- `targetPage`
- `mode`

`targetPage` must be unique. The planner should reuse an existing source page when manifest history already points to one. Otherwise it derives a stable page under `wiki/sources/` from the source path. If two sources collide on the same derived slug, the planner appends a deterministic suffix from the source path hash.

### `KnowledgeBaseWorkerSessionRunner`

Runs one restricted worker task through Claude Agent SDK.

The worker prompt includes only:

- assigned source path;
- assigned target page;
- a small amount of existing context such as `wiki/hot.md` and relevant source page content if it exists;
- strict output requirements for `synapse_kb_worker_report`.

Worker write policy:

- allow writes only to the exact assigned `targetPage`;
- reject writes to `.raw/.manifest.json`;
- reject writes to `.vault-meta`;
- reject writes to `wiki/index.md`, `wiki/hot.md`, `wiki/log.md`;
- reject writes to `wiki/concepts`, `wiki/entities`, and `wiki/questions`;
- reject writes outside the Knowledge Base project path.

This policy must be enforced in code through SDK `canUseTool` or an equivalent worker-session guard, not only through prompt text.

### `KnowledgeBaseWorkerReportParser`

Parses exactly one fenced `synapse_kb_worker_report` JSON block.

Schema:

```json
{
  "schema": "synapse.kb.worker.report.v1",
  "task_id": "kb-ingest-worker-1",
  "source": ".raw/example.md",
  "target_page": "wiki/sources/example.md",
  "pages_created": ["wiki/sources/example.md"],
  "pages_updated": [],
  "candidate_concepts": [],
  "candidate_entities": [],
  "candidate_questions": [],
  "skipped": null
}
```

The parser rejects missing, multiple, invalid JSON, wrong schema, source mismatch, task mismatch, target mismatch, and page lists outside the assigned target page.

### `KnowledgeBaseMergeCoordinator`

Runs once after worker reports are validated.

Inputs:

- preflight state;
- accepted worker reports;
- source page paths;
- candidate concepts/entities/questions;
- `wiki/hot.md` and `wiki/index.md` context.

Responsibilities:

- update shared semantic pages;
- update `wiki/index.md`;
- update `wiki/hot.md`;
- append `wiki/log.md`;
- emit exactly one `synapse_kb_ingest_report`.

The merge coordinator may update source pages only when applying a narrowly justified correction to worker output. It still must not write `.raw/.manifest.json`, `.vault-meta`, hashes, `ingested_at`, or `address_map`.

### `KnowledgeBaseParallelIngestRunner`

Owns the orchestration:

1. plans tasks;
2. runs workers with bounded concurrency;
3. validates reports and actual file state;
4. runs merge coordinator;
5. parses final ingest report;
6. calls `KnowledgeBaseManifestFinalizer.finalizeBatch()` or the single aggregate `finalize()` path as appropriate.

Default concurrency should be conservative, such as `3`. The initial implementation should use a fixed internal default rather than a user-facing setting.

## Integration Points

- `KnowledgeBaseIngestCoordinator.prepareTurn()`
  - still owns source scanning and preflight state.
  - may choose programmatic mode when changed source count reaches a threshold.
- `KnowledgeBaseIngestCoordinator.finalizeTurn()`
  - remains the current path for single-turn or LLM-coordinated ingest.
  - should not be burdened with worker orchestration details.
- `createKnowledgeBaseAgentContribution()`
  - invokes the runner only for local renderer Knowledge Base ingest turns.
  - scheduled, workflow, bridge, and ordinary Agent turns do not receive this path.
- `KnowledgeBaseManifestFinalizer`
  - remains the only manifest/address writer.
  - keeps project-level locking and address finalization.

## Data Flow

1. User says `/wiki ingest` or natural-language ingest.
2. `KnowledgeBaseIngestCoordinator.prepareTurn()` scans changed `.raw/` sources and snapshots `wiki/`.
3. If changed source count is below the internal threshold, Synapse uses the existing single coordinator flow.
4. If changed source count reaches the threshold, `KnowledgeBaseParallelIngestRunner` creates one worker task per changed source.
5. Workers run concurrently with bounded concurrency.
6. Each worker writes only its assigned `wiki/sources/...` page.
7. Each worker emits one `synapse_kb_worker_report`.
8. Synapse validates worker reports against task assignments, preflight hashes, and actual file state.
9. Synapse runs one merge coordinator with accepted worker reports.
10. Merge coordinator updates shared wiki pages and emits one final `synapse_kb_ingest_report`.
11. Synapse parses the final report and calls the manifest finalizer.
12. `KnowledgeBaseManifestFinalizer` writes manifest `sources` and `address_map` under the project lock.

## Error Handling

- If the final report is missing or invalid, manifest finalization is skipped with an event message.
- If a worker report is missing or invalid, that worker task is marked failed and excluded from the merge phase.
- If a worker writes outside its assigned target page, the write is denied before execution.
- If a worker report claims a different source, task, or target page, that report is rejected.
- If a worker task fails, the runner may continue with successful tasks, but the final user-visible event must list failed source paths.
- If all worker tasks fail, the merge coordinator is not run and manifest finalization is skipped.
- If a report source was not in the preflight source list, that source is rejected.
- If a raw source hash changed after preflight, that source is rejected.
- If multiple report entries claim the same source, duplicates after the first are rejected.
- If multiple sources claim the same non-maintenance wiki page in one batch, finalization warns about shared ownership. The entries may still be written when the page exists and passed diff validation, because some shared semantic pages are legitimate; the warning identifies review risk.
- Manifest and address writes remain serialized by project.

## Rollout

Phase 1:

- add task planner;
- add worker report parser;
- add direct worker-session write guard;
- add runner with bounded concurrency;
- run merge coordinator once;
- keep current single coordinator flow as fallback.

Phase 2:

- add worker retry for transient SDK failures;
- add pending recovery state for partially successful parallel runs;
- add progress events;
- add internal telemetry for worker counts, rejected reports, and finalizer warnings.

Not part of initial rollout:

- user-facing concurrency settings;
- UI progress dashboard;
- cross-session pause/resume;
- Scheduler or Workflow integration.

## Tests

- task planner assigns one unique target page per changed source;
- task planner reuses existing manifest source pages when available;
- worker report parser rejects missing, duplicate, invalid, wrong-schema, source-mismatch, and target-mismatch reports;
- worker session guard denies writes outside the assigned source page;
- worker session guard denies writes to `.raw/.manifest.json`, `.vault-meta`, and shared wiki pages;
- runner continues when one worker fails and reports the failed source;
- runner skips merge when all workers fail;
- merge coordinator is invoked once with accepted worker reports;
- finalizer receives only validated processed sources;
- manifest/address writes remain serialized by existing finalizer tests;
- ordinary Agent, Scheduler, Workflow, and bridge-triggered turns do not invoke the parallel runner.

## Hard Rules

- User Knowledge Base directories remain Obsidian-compatible vaults, not Claude Code projects.
- Internal Knowledge Base agent capabilities live under Synapse resources/services only.
- Ordinary Agent, Scheduler, Workflow, and bridge-triggered turns must not receive Knowledge Base worker agents.
- `.raw/.manifest.json` and `address_map` are written only by Synapse finalizers.
- Programmatic ingest workers never edit `wiki/index.md`, `wiki/hot.md`, `wiki/log.md`, `.raw/.manifest.json`, `.vault-meta`, `wiki/concepts/`, `wiki/entities/`, or `wiki/questions/`.
- Programmatic ingest workers write only their assigned `wiki/sources/...` target page.
- Prompt instructions are not sufficient for write isolation; worker write policy must be enforced in code.
- Shared semantic pages are single-writer through the merge coordinator.
- Manifest and address state are single-writer through `KnowledgeBaseManifestFinalizer`.
