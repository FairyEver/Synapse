# Wiki Phase 1 Design

## Context

Synapse already supports marking a project as a knowledge base and scaffolding an Obsidian-compatible Markdown vault. Knowledge base conversations receive a bootstrap prompt and `wiki/hot.md` context on new live sessions. The current implementation is intentionally lightweight: it registers a `/wiki` prompt command and ships static prompts for `ingest`, `save`, `lint`, `query`, and `hot-cache`.

The next phase should close the most important gaps versus the original `AgriciDaniel/claude-obsidian` project without copying its plugin ecosystem wholesale.

## Original Implementation Analysis

The original `claude-obsidian` implementation is a Claude Code plugin resource pack, not a standalone backend service. Its main mechanisms are:

- `commands/wiki.md`: command entry for setup, scaffold checks, and routing.
- `skills/wiki/SKILL.md`: top-level orchestration, vault structure, hot cache rules, and operation routing.
- `skills/wiki-ingest/SKILL.md`: ingest workflow. It defines `.raw/.manifest.json` delta tracking, source hashing, source summaries, entity/concept pages, index/log/hot updates, and contradiction callouts.
- `skills/wiki-query/SKILL.md`: query workflow. It defines quick, standard, and deep query modes that read `wiki/hot.md`, `wiki/index.md`, and selected wiki pages.
- `hooks/hooks.json`: SessionStart and PostCompact restore `wiki/hot.md`; Stop prompts hot cache refresh if wiki files changed.
- `agents/wiki-ingest.md`: optional parallel batch-ingest worker instructions.

The original system is mostly prompt and hook driven. Its “determinism” comes from explicit rules around manifest hashing and hot cache maintenance, while the LLM still writes wiki pages and updates indexes.

## Product Goal

Build a Synapse-native Wiki Phase 1 that gives users the important original behavior:

- New or changed `.raw/` sources are detected reliably.
- `/wiki ingest` processes only the sources that need work.
- `/wiki query` gives a clear vault-backed answering path.
- `/wiki hot` refreshes recent context on demand.
- `/wiki status` tells the user what state the vault is in.

Do this without requiring users to install Claude Code plugins, Obsidian plugins, MCP servers, Git hooks, or external scripts.

## Non-Goals

Do not implement these in Phase 1:

- Six wiki modes.
- AutoResearch.
- Canvas workflows.
- Obsidian community plugin management.
- Git auto-commit.
- DragonScale addresses, semantic tiling, folds, or frontier scoring.
- URL ingest, image ingest, or parallel batch agents.
- A vector database or embedding retrieval layer.

## Recommended Architecture

Use a hybrid model: deterministic local preflight in Electron main process plus LLM-authored wiki content through the existing Agent conversation.

Electron should own file-system facts that should not depend on model judgment:

- List source files under `.raw/`.
- Ignore `.raw/.manifest.json` and hidden/system files.
- Compute stable hashes for source files.
- Read and validate `.raw/.manifest.json`.
- Classify sources as changed, unchanged, missing from manifest, or manifest-invalid.
- Generate a precise prompt payload for the agent.

The agent should still own semantic writing:

- Read changed source files.
- Create or update `wiki/sources/`, `wiki/entities/`, `wiki/concepts/`, and relevant wiki pages.
- Update `wiki/index.md`, `wiki/log.md`, and `wiki/hot.md`.
- Write manifest entries after semantic work completes.
- Cite pages with wikilinks and avoid guessed paths.

This keeps Synapse reliable where it can be reliable, while preserving the original LLM Wiki pattern where the model performs synthesis.

## Command Surface

The knowledge base project contribution should register one command: `/wiki`.

Supported subcommands:

- `/wiki status`
- `/wiki ingest`
- `/wiki ingest force`
- `/wiki query <question>`
- `/wiki query quick <question>`
- `/wiki query deep <question>`
- `/wiki hot`
- `/wiki save`
- `/wiki lint`

Only Phase 1 needs to enhance `status`, `ingest`, `query`, and `hot`. Existing `save` and `lint` can remain prompt-backed.

## `/wiki status`

`/wiki status` should not start semantic work. It should return a status prompt or command result based on deterministic inspection.

It should report:

- Whether required vault files exist.
- Template version from `.synapse-kb.json`.
- Whether `.raw/.manifest.json` is readable.
- Count of source files under `.raw/`.
- Count of changed and unchanged sources.
- `wiki/hot.md` last modified time when available.
- Available commands.

The UI already creates and repairs knowledge bases, so this command replaces the original plugin setup check rather than duplicating setup UX.

## `/wiki ingest`

Before building the prompt, Synapse should run an ingest preflight:

1. Walk `.raw/` recursively.
2. Exclude `.raw/.manifest.json`, directories, hidden temp files, and unsupported binary files.
3. Hash each source with SHA-256.
4. Parse manifest as:

```json
{
  "version": 1,
  "sources": {
    ".raw/example.md": {
      "hash": "sha256...",
      "ingested_at": "2026-05-21T12:00:00.000Z",
      "pages_created": ["wiki/sources/example.md"],
      "pages_updated": ["wiki/index.md", "wiki/hot.md"]
    }
  }
}
```

5. Classify sources:
   - `new`: no manifest entry.
   - `changed`: manifest hash differs.
   - `unchanged`: manifest hash matches.
   - `skipped`: unsupported or unreadable.
6. If no sources need work, return a short command result instead of sending a long prompt.
7. If sources need work, send an ingest prompt containing:
   - Changed source list with relative path and hash.
   - Unchanged count.
   - Manifest write requirements.
   - Existing wiki rules from `ingest.md`.

The agent must update `.raw/.manifest.json` after writing wiki pages. This mirrors the original implementation but makes source selection deterministic.

`/wiki ingest force` should include all supported source files even when hashes match.

## `/wiki query`

`/wiki query` should route to an explicit query prompt. It should not rely only on the bootstrap prompt.

Modes:

- `quick`: read only `wiki/hot.md` and `wiki/index.md`; if insufficient, say so.
- `standard`: read hot, index, then 3-5 relevant pages.
- `deep`: read all clearly relevant pages and offer to save the result if it is valuable.

The prompt must include:

- The user question.
- The selected mode.
- Rule: answer only from the vault when the question is about the knowledge base.
- Rule: cite pages with wikilinks.
- Rule: do not guess file paths from wikilink titles; resolve real files through `wiki/index.md`, Glob, or Grep.

Phase 1 does not need web search fallback.

## `/wiki hot`

`/wiki hot` should route to `hot-cache.md` with deterministic context:

- Last modified wiki files if cheaply available.
- Recent `wiki/log.md` entries.
- Current `wiki/index.md` summary if needed.

The prompt should ask the agent to overwrite `wiki/hot.md` using the current format, under 500 words.

Automatic hot refresh should be conservative:

- `/wiki ingest` must instruct the agent to refresh `wiki/hot.md`.
- `/wiki save` already instructs hot refresh and should keep doing so.
- `/wiki query deep` can offer saving the answer and refreshing hot.
- Ordinary chat turns should not trigger background file writes in Phase 1.

This avoids adding broad AgentRuntime hooks while still preserving the original hot cache value.

## Data and File Boundaries

All vault files stay inside the user’s project folder. The durable user-facing format remains Obsidian-compatible Markdown.

Synapse may add or maintain:

- `.synapse-kb.json`
- `.raw/.manifest.json`
- `wiki/*`
- `_attachments/`

Synapse must not modify user source files under `.raw/`, except `.raw/.manifest.json`.

## Error Handling

If manifest JSON is invalid:

- Do not overwrite it silently.
- Report the parse error in `/wiki status`.
- For `/wiki ingest`, send a prompt that asks the agent to stop and tell the user to repair the manifest, unless a deterministic repair path is implemented later.

If a source file cannot be read:

- Include it under skipped sources with the reason.
- Continue with other readable sources.

If the vault shape is incomplete:

- `/wiki status` should say what is missing.
- `/wiki ingest`, `/wiki query`, and `/wiki hot` should refuse with a clear message and suggest repairing/opening the knowledge base from the project list.

## Testing Strategy

Unit tests should cover:

- Manifest parsing and invalid manifest handling.
- Source discovery under `.raw/`.
- Hash-based new/changed/unchanged classification.
- Force ingest classification.
- `/wiki status` prompt/result output.
- `/wiki ingest` prompt includes changed sources and excludes unchanged sources.
- `/wiki query` mode parsing.
- `/wiki hot` prompt routing.

Existing command routing tests should be updated for `/wiki` behavior only, not broad AgentRuntime refactors.

## Implementation Boundaries

Preferred file additions:

- `desktop/electron/services/knowledge-base/manifest.ts`
- `desktop/electron/services/knowledge-base/source-scan.ts`
- `desktop/electron/services/knowledge-base/wiki-command-prompts.ts`
- Tests beside the existing knowledge base service tests.

Preferred modifications:

- `desktop/electron/services/knowledge-base/agent-contribution.ts`
- `desktop/resources/knowledge-base/prompts/query.md`
- `desktop/resources/knowledge-base/prompts/hot-cache.md`
- `desktop/resources/knowledge-base/prompts/ingest.md`

Avoid renderer changes in Phase 1 unless tests reveal command listing copy needs a small update.

## Open Decision

The only unresolved product decision is whether `/wiki ingest` should return a short result when there are no changed files, or still send a prompt so the agent can explain status conversationally.

Recommendation: return a short command result. It is faster, cheaper, and clearer.
