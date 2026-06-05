# Synapse Knowledge Base White Label Design

## Summary

Synapse Knowledge Base should no longer expose the upstream `claude-obsidian` name in product surfaces, runtime defaults, source primary paths, or normal developer-facing implementation names.

The feature continues to sync from the upstream runtime source for behavior, but the synced template is converted into a Synapse-owned runtime identity before it is committed, packaged, copied into managed knowledge bases, or loaded by the Agent SDK.

This design supersedes the `claude-obsidian-template` naming in the managed runtime design for new implementation work. It does not change the Knowledge Base product model, storage shape, native slash behavior, or managed runtime isolation rules.

## Goals

- Replace the Synapse-owned template identity with `synapse-knowledge-base`.
- Rename the committed template directory to `desktop/resources/knowledge-base/synapse-knowledge-base-template/`.
- Rename the sync script to `scripts/sync-synapse-knowledge-base-template.mjs`.
- Keep `pnpm run kb:sync-template` as the developer command, pointed at the new script.
- Keep upstream sync possible from `AgriciDaniel/claude-obsidian`.
- Automatically white-label newly synced template contents so future syncs do not reintroduce the upstream brand.
- Preserve Knowledge Base behavior, including local SDK plugin loading, native slash passthrough, `.raw` source management, wiki files, manifest shape, and address metadata.
- Keep existing managed knowledge bases untouched unless a later explicit migration is designed.

## Non-Goals

- Do not rename core user workflows such as `/wiki-ingest`, `/wiki-query`, `/wiki-lint`, `/save`, or the `wiki/` and `.raw/` storage concepts.
- Do not reimplement the upstream runtime behavior in Synapse services.
- Do not introduce SDK runtime injection or temporary overlay assets.
- Do not migrate or rewrite existing user knowledge base runtime content.
- Do not remove required license or attribution material.
- Do not make the managed runtime directory user-visible.

## Allowed Upstream References

The string `claude-obsidian` should be absent from product code, runtime default context, templates loaded by the Agent, tests that model current behavior, and normal documentation.

It may remain only in:

- The sync script's upstream repository URL and source constants.
- `SOURCE.json`, `LICENSE*`, `NOTICE*`, and necessary attribution files.
- Historical docs or migration tests that explicitly describe the old name and are not used as current implementation guidance.

These exceptions are for developer sync and compliance only. They must not appear in UI, Agent timeline text, exported conversation text, new managed knowledge base starter content, or default Agent runtime instructions.

## Template Path And Script Names

The canonical template path becomes:

```text
desktop/resources/knowledge-base/synapse-knowledge-base-template/
```

The canonical sync script becomes:

```text
scripts/sync-synapse-knowledge-base-template.mjs
```

Root `package.json` keeps the existing command:

```json
{
  "scripts": {
    "kb:sync-template": "node scripts/sync-synapse-knowledge-base-template.mjs"
  }
}
```

The old `desktop/resources/knowledge-base/claude-obsidian-template/` path is no longer canonical. A short-term read-only fallback is allowed in `KnowledgeBaseService` so incomplete development checkouts or one-version resource packaging mistakes do not break Knowledge Base creation immediately. The fallback must log a structured warning and should not be referenced by new docs as the normal path.

## Sync Pipeline

The sync script still clones:

```text
https://github.com/AgriciDaniel/claude-obsidian
```

Then it writes a Synapse-branded template:

1. Clone upstream into a temporary directory.
2. Resolve the upstream commit.
3. Empty `synapse-knowledge-base-template/`, preserving only files the script intentionally regenerates or copies for compliance.
4. Copy upstream files into the Synapse template, excluding `.git`.
5. Run a deterministic white-label pass.
6. Preserve or regenerate license, notice, attribution, and source metadata.
7. Run post-sync validation.

The white-label pass should update at least:

- `.claude-plugin/plugin.json`
  - `name: "synapse-knowledge-base"`
  - Synapse-owned description.
  - No user-facing upstream homepage or repository identity in plugin metadata.
- `CLAUDE.md`, `AGENTS.md`, `GEMINI.md`, and `README.md`
  - Replace with Synapse Knowledge Base runtime instructions.
  - Remove upstream marketplace install instructions and marketing copy.
- `skills/**/SKILL.md`, `commands/**/*.md`, `hooks/**`, and `scripts/**`
  - Replace upstream branding with Synapse Knowledge Base wording.
  - Preserve operational semantics and command names.
- Upstream demo `wiki/`, `.raw/`, and meta content
  - Either remove during sync or rely on creation-time reset, but packaged default runtime context must not contain upstream branding in files that can be loaded by the Agent by default.

`SOURCE.json` should contain upstream metadata and Synapse template identity:

```json
{
  "templateName": "synapse-knowledge-base",
  "repo": "https://github.com/AgriciDaniel/claude-obsidian",
  "commit": "<upstream commit>",
  "syncedAt": "YYYY-MM-DD",
  "notes": "Upstream source metadata for developer sync and attribution only."
}
```

## Runtime Compatibility

Renaming must not change how Knowledge Base runs.

- `KnowledgeBaseService` resolves the new template path by default.
- `SYNAPSE_KB_MANAGED_TEMPLATE_ROOT` continues to override the template root for tests and local verification.
- If the new template path is absent and the old path exists, `KnowledgeBaseService` may use the old path as a temporary fallback with a structured warning.
- New managed knowledge bases are still created under app-managed storage.
- Creation still copies the full runtime template and then calls the existing reset path for starter `wiki/`, `.raw/`, and `.vault-meta`.
- Agent SDK sessions for managed knowledge bases still pass the backing directory as a local plugin.
- Ordinary projects, Scheduler, Workflow, and other Agent launches do not receive Knowledge Base runtime behavior unless they explicitly target a managed Knowledge Base project.
- Existing native slash allowlists and passthrough annotations continue to use command names like `/wiki-ingest`.
- `.raw/.manifest.json`, `wiki/`, `.vault-meta/address-counter.txt`, and source file management semantics do not change.

## Slash And Capability Names

Knowledge Base commands and skills are behavior names, not upstream brand names. They stay stable unless a later compatibility design introduces aliases.

Keep:

- `/wiki`
- `/wiki-ingest`
- `/wiki-query`
- `/wiki-lint`
- `/wiki-fold`
- `/save`
- `/autoresearch`
- `/canvas`
- `/defuddle`

For `obsidian-bases` and `obsidian-markdown`, the first implementation should avoid breaking runtime skill discovery. If those directory names are still required by the synced runtime, keep the skill names and remove upstream-branded UI descriptions. A later change may introduce Synapse aliases, but it must keep old names as compatibility entries until existing runtimes and prompts are migrated safely.

## Documentation Updates

Update current guidance so future agents do not reintroduce the old path:

- `docs/agent-guides/knowledge-base.md`
- The managed runtime design should receive a short superseding note that points to this design for template naming and white-label sync behavior.
- Historical plans may remain unchanged if they are clearly historical and not used as current guidance.
- `RELEASE_NOTES_PENDING.md` should mention the user-facing change once implementation lands.

Current docs should describe the upstream source as a developer sync source only. They should not call the product or runtime `claude-obsidian`.

## Tests

The implementation should include focused tests for:

- Sync branding helpers replace or remove upstream brand strings from normal template files.
- Sync validation fails when `claude-obsidian` remains outside the allowed files.
- `.claude-plugin/plugin.json` parses and uses `synapse-knowledge-base`.
- The synced template still contains required runtime assets:
  - `.claude-plugin/`
  - `skills/wiki-ingest/`
  - `commands/save.md`
  - `hooks/`
  - `scripts/`
  - `CLAUDE.md`
- `KnowledgeBaseService` resolves the new canonical path.
- `KnowledgeBaseService` can use the old path as a logged fallback when the new path is absent.
- Managed runtime creation still resets starter wiki/raw/meta content and preserves runtime assets.
- Agent slash catalog still inserts the same command text for Knowledge Base capabilities.

## Verification

After implementation, run the narrowest relevant checks:

```bash
pnpm --filter @synapse/desktop run test -- electron/services/knowledge-base
pnpm --filter @synapse/desktop run test -- src/modules/agent
```

Run a repository scan with an allowlist for upstream source and attribution files:

```bash
rg -n "claude-obsidian|Claude \\+ Obsidian" \
  --glob '!desktop/resources/knowledge-base/synapse-knowledge-base-template/SOURCE.json' \
  --glob '!desktop/resources/knowledge-base/synapse-knowledge-base-template/LICENSE*' \
  --glob '!desktop/resources/knowledge-base/synapse-knowledge-base-template/NOTICE*' \
  --glob '!desktop/resources/knowledge-base/synapse-knowledge-base-template/ATTRIBUTION*'
```

Expected remaining hits should be limited to the sync script upstream constants, compliance files, and explicit historical documentation.

## Acceptance Criteria

- New synced template identity is `synapse-knowledge-base`.
- New managed knowledge bases do not contain upstream demo wiki/raw content after creation.
- Default Agent runtime instructions for new managed knowledge bases do not expose the upstream brand.
- UI, Agent timeline, exported conversation text, logs intended for users, and current implementation docs do not expose the upstream brand.
- Existing Knowledge Base slash workflows continue to work.
- Existing managed knowledge bases are not automatically rewritten.
- Upstream sync remains possible and repeatable.
- License and source attribution remain available for compliance.
