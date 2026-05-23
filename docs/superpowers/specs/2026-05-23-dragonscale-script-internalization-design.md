# DragonScale Script Internalization Design

## Goal

Move the DragonScale behavior from `AgriciDaniel/claude-obsidian` into Synapse without writing runnable scripts into user knowledge-base folders.

The migration should preserve the original data protocol and algorithm semantics while making Synapse the production runtime owner.

## Source Baseline

The upstream behavior baseline is `AgriciDaniel/claude-obsidian` commit `75d3b6f`.

Relevant upstream files:

- `scripts/allocate-address.sh`
- `scripts/boundary-score.py`
- `scripts/tiling-check.py`
- `bin/setup-dragonscale.sh`
- `skills/wiki-ingest/SKILL.md`
- `skills/wiki-lint/SKILL.md`
- `skills/autoresearch/SKILL.md`
- `skills/wiki-fold/SKILL.md`

Synapse may vendor these scripts internally for compatibility tests and temporary execution. Synapse must not copy them into a user vault.

## Hard Rules

- User vaults must not contain `scripts/`, Agent skills, Agent commands, Agent hooks, Agent files, or a full operational `CLAUDE.md`.
- User vaults may contain DragonScale state files because they are knowledge-base data:
  - `.vault-meta/address-counter.txt`
  - `.vault-meta/legacy-pages.txt`
  - `.vault-meta/tiling-thresholds.json`
  - `.vault-meta/tiling-cache.json`
  - `.raw/.manifest.json`
- Production behavior should eventually run through Synapse services/tools, not shelling out to vendored scripts.
- During migration, vendored scripts may be used as an oracle or short-term runner only from Synapse-controlled locations.
- Ordinary Agent conversations, Scheduler tasks, Workflow runs, and non-knowledge-base projects must not load DragonScale runtime behavior.

## Target Architecture

```text
User knowledge base/
  .raw/
    .manifest.json
  .vault-meta/
    address-counter.txt
    legacy-pages.txt
    tiling-thresholds.json
    tiling-cache.json
  wiki/
    ...

Synapse internal resources/
  desktop/resources/knowledge-base/dragonscale/upstream/
    allocate-address.sh
    boundary-score.py
    tiling-check.py
    UPSTREAM.md

Synapse services/
  desktop/electron/services/knowledge-base/dragonscale/
    script-runner.ts
    address-service.ts
    boundary-service.ts
    tiling-service.ts
    types.ts
```

## Migration Strategy

### Phase 1: Vendor Upstream Scripts As Oracle

Copy the upstream scripts into a Synapse internal resources directory and record the exact upstream commit.

Purpose:

- Preserve a local reference implementation.
- Use original tests and fixtures to understand behavior.
- Avoid relying on remote GitHub during tests.
- Avoid placing scripts in user vaults.

This phase does not change production ingest behavior by itself.

### Phase 2: Add A Guarded Script Runner

Implement `DragonScaleScriptRunner` to execute vendored scripts only from Synapse resources.

Runner responsibilities:

- Accept an explicit `vaultPath`.
- Reject paths outside the target vault for script-controlled writes.
- Pass `SYNAPSE_KB_VAULT_ROOT=<vaultPath>` to patched scripts.
- Capture `stdout`, `stderr`, and exit code.
- Go through existing permission/audit infrastructure before running shell commands.

This is a temporary bridge for behavior verification and for the most complex script, `tiling-check.py`, if service parity is not ready.

### Phase 3: Internalize Address Allocation

Implement `DragonScaleAddressService` in TypeScript.

It replaces `allocate-address.sh` in production.

Required behavior:

- Ensure `.vault-meta/` exists inside the vault.
- Read `.vault-meta/address-counter.txt`.
- If missing, scan `wiki/**/*.md` frontmatter for the highest `address: c-NNNNNN` and recover next counter as max + 1.
- If corrupt, fail with a structured error instead of resetting.
- Serialize allocations per vault so concurrent ingest operations cannot allocate the same address.
- Allocate `c-NNNNNN` and increment the counter.
- Support a read-only `peek`.
- Support `rebuild` from existing wiki frontmatter.
- Never edit source files under `.raw/` except `.raw/.manifest.json` through the manifest writer.

Synapse tests should compare this service against the upstream script for representative fixtures.

### Phase 4: Internalize Boundary Scoring

Implement `DragonScaleBoundaryService` in TypeScript.

It replaces `boundary-score.py` in production.

Required behavior:

- Read `wiki/**/*.md`.
- Ignore symlinks, meta pages, fold pages, `_index.md`, `index.md`, `log.md`, `hot.md`, `overview.md`, `dashboard.md`, and paths under `wiki/folds/` or `wiki/meta/`.
- Parse wikilinks using filename-stem resolution.
- Compute `boundary_score = (out_degree - in_degree) * recency_weight`.
- Use the same recency half-life as upstream unless intentionally changed in a documented spec update.
- Emit structured results usable by future `autoresearch`.

### Phase 5: Internalize Semantic Tiling

Implement `DragonScaleTilingService` after address and boundary are stable.

It replaces `tiling-check.py` in production.

Required behavior:

- Read eligible wiki pages.
- Compute embeddings through a Synapse-controlled embedding provider.
- Initially support local Ollama HTTP with the same safety posture as upstream:
  - local URLs only by default,
  - remote endpoints require explicit configuration,
  - page bodies must not be sent to unknown endpoints.
- Cache embeddings in `.vault-meta/tiling-cache.json`.
- Use `.vault-meta/tiling-thresholds.json`.
- Produce a lint report under `wiki/meta/`.

Because embedding results can vary by provider and model version, semantic tiling requires functional equivalence rather than byte-for-byte output equivalence.

## Production Versus Oracle

The upstream scripts are not the long-term production implementation.

Allowed uses:

- Compatibility tests.
- Fixture generation.
- Short-term gated runner while a service is not implemented.

Disallowed uses:

- Copying scripts into user vaults.
- Loading scripts as Agent skills or hooks.
- Running scripts for ordinary projects.
- Running scripts without permission/audit checks.

## Data Compatibility

Synapse must preserve upstream-compatible shapes:

`.raw/.manifest.json`:

```json
{
  "version": 1,
  "created": "YYYY-MM-DD",
  "description": "Ingest delta tracker and address map for the Synapse knowledge base.",
  "sources": {},
  "address_map": {}
}
```

`.vault-meta/address-counter.txt` contains the next integer counter.

`.vault-meta/legacy-pages.txt` contains comments and one legacy page path per line.

`.vault-meta/tiling-thresholds.json` contains model and band configuration.

## Integration Points

Knowledge-base ingest should use DragonScale address allocation through a Synapse internal service/tool, not by asking the model to run a shell script.

Knowledge-base lint should use DragonScale address validation through Synapse services. Semantic tiling can remain disabled until the internal tiling service exists.

Future autoresearch can use boundary scoring only after `DragonScaleBoundaryService` exists.

## Testing Strategy

Test layers:

- Unit tests for service behavior.
- Fixture tests using small vaults.
- Compatibility tests comparing Synapse service outputs with upstream scripts where deterministic.
- Negative tests proving user vault templates do not contain scripts or Agent capability files.

Deterministic compatibility:

- `allocate-address.sh` -> exact compatibility expected.
- `boundary-score.py` -> exact or near-exact numeric compatibility expected.
- `tiling-check.py` -> functional compatibility expected; byte-for-byte reports are not required.

## Initial Implementation Slice

The first implementation plan should stop at:

1. Vendor upstream scripts internally.
2. Add upstream metadata.
3. Add a guarded script runner interface.
4. Implement `DragonScaleAddressService`.
5. Add tests proving user vault templates remain clean.
6. Add tests comparing address service behavior with upstream allocation semantics.

Boundary scoring and semantic tiling belong in separate follow-up plans.
