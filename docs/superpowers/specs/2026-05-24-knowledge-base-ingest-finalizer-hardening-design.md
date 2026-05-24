# Knowledge Base Ingest Finalizer Hardening Design

## Goal

Harden the deterministic Knowledge Base ingest path so natural-language ingest, manifest finalization, and user-facing warnings fail closed without producing false errors or cross-turn manifest races.

## Scope

This change is limited to Synapse-owned Knowledge Base agent contribution and Electron service code. It does not add renderer filesystem scanning, Scheduler behavior, Workflow behavior, or any runnable Agent files inside the user's vault.

## Hard Rules

- Keep Knowledge Base-only behavior isolated under `desktop/electron/services/knowledge-base/` and the generic Agent project-contribution hooks already used by the Agent runtime.
- Do not write skills, hooks, commands, plugins, scripts, or full prompts into the user Knowledge Base vault.
- Source ingest finalization must fail closed: if no processed source entry is accepted, do not update `manifest.sources`, do not run DragonScale address backfill, and do not write `address_map`.
- Research finalization may still run DragonScale address finalization because it is not a source ingest finalizer.
- Manifest finalization for one project path must be serialized across concurrent turns.
- User-facing warning messages must map the actual parser warning codes emitted by `ingest-report.ts`.

## Current Problems

1. Natural-language ingest uses `prepareTurn()` but cannot return a direct command result. When there are no source changes or the manifest is invalid, the returned result content is sent to the Agent as a prompt. `afterTurn()` then calls `finalizeTurn()` and reports a false `preflight-missing` warning.
2. `KnowledgeBaseManifestFinalizer.finalize()` reads, modifies, and writes `.raw/.manifest.json` without a project-level lock. Concurrent ingest turns can lose each other's `sources` or `address_map` updates.
3. Source ingest finalization calls the DragonScale address finalizer even when every processed source is rejected. That can mutate wiki page frontmatter, `.vault-meta/address-counter.txt`, and manifest `address_map` despite having no valid source report.
4. `ingest-report.ts` emits `report-multiple`, `report-json`, and `report-schema`, but `ingest-coordinator.ts` formats `report-duplicate`, `report-json-invalid`, and `report-schema-invalid`.

## Design

### Natural-Language No-Op Finalization

Keep the Agent runtime interface unchanged. When natural-language ingest receives a direct `prepareTurn()` result, the Knowledge Base contribution records that this turn does not require source finalization. The turn may still run through the Agent because the current runtime only lets slash commands short-circuit directly, but `afterTurn()` will consume the no-op marker and return no user-facing error.

This keeps the fix local to Knowledge Base code and avoids adding a broader Agent runtime short-circuit API for one module.

### Project-Level Manifest Lock

Wrap the entire `KnowledgeBaseManifestFinalizer.finalize()` body in a module-level lock keyed by resolved project path. The manifest read must happen inside the lock. A second finalizer for the same vault waits, rereads the manifest after the first write, then merges its source entry into the fresh manifest.

The lock lives in Synapse service memory only. It does not write lock files into the user vault.

### Fail-Closed Address Finalization

Run DragonScale address finalization from source ingest only after at least one source entry has been accepted. If no source entry is accepted, return warnings and leave address state untouched.

`/wiki research <topic>` remains unchanged because it explicitly creates or updates wiki pages without `.raw` source entries and only needs address finalization.

### Warning Message Consistency

Update the coordinator warning formatter to recognize the actual parser codes:

- `report-multiple`
- `report-json`
- `report-schema`
- `report-object`

Add tests so malformed reports produce concise Chinese user-facing messages instead of raw internal codes.

## Testing Requirements

- Natural-language ingest with unchanged sources must not emit a `preflight-missing` finalization error.
- Natural-language ingest with invalid manifest must not emit a `preflight-missing` finalization error.
- Concurrent source manifest finalizers for the same project must preserve both accepted source entries.
- Source finalization with zero accepted sources must not call the address finalizer or write `address_map`.
- Duplicate, malformed JSON, and schema-mismatched ingest reports must produce mapped user-facing warning messages.
- Existing focused Knowledge Base and Agent Runtime tests must remain green.

## Success Criteria

- Natural-language ingest no-op paths no longer create false finalization errors.
- `.raw/.manifest.json` source merges are race-safe per vault.
- Source ingest finalization does not mutate address state when the report accepts no sources.
- User-facing ingest warning messages match current parser warning codes.
- The implementation remains isolated from ordinary Agent, Scheduler, and Workflow behavior.
