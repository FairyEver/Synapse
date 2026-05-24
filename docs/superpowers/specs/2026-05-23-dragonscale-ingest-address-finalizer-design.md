# DragonScale Ingest Address Finalizer Design

> Superseded for manifest `sources` ownership by `docs/superpowers/specs/2026-05-24-knowledge-base-deterministic-manifest-finalization-design.md`. DragonScale address finalization remains valid, but manifest `sources` are now finalized by Synapse rather than the Agent.

## Goal

Connect DragonScale address assignment to knowledge-base ingest without putting runnable DragonScale scripts, hooks, commands, or skills into the user's vault.

The phase 2 behavior is:

- `/wiki ingest` and natural-language ingest requests still let the Agent create and update wiki pages.
- After a successful ingest turn, Synapse deterministically assigns addresses to eligible wiki pages through `DragonScaleAddressService`.
- Synapse updates `.vault-meta/address-counter.txt` through the address service.
- Synapse updates `.raw/.manifest.json` `address_map` itself.

This gives Synapse the DragonScale Mechanism 2 address semantics while keeping the user vault as an Obsidian-compatible knowledge vault.

## Current State

Phase 1 already exists on `main`:

- `desktop/electron/services/knowledge-base/dragonscale/address-service.ts`
- `desktop/electron/services/knowledge-base/dragonscale/script-runner.ts`
- vendored upstream scripts under `desktop/resources/knowledge-base/dragonscale/upstream/`
- tests proving user vault templates do not receive runnable scripts

Current ingest is still prompt-backed:

- `/wiki ingest` is built by `desktop/electron/services/knowledge-base/wiki-command-prompts.ts`.
- Natural-language ingest is triggered by the injected Claude Code SDK plugin skill `desktop/resources/knowledge-base/claude-plugin/skills/wiki-ingest/SKILL.md`.
- `manifest.ts` can read manifests but does not yet provide a safe writer.
- The Agent is currently instructed to maintain `address_map`, which is not deterministic enough.

## Hard Rules

- Do not copy DragonScale scripts, skills, commands, hooks, agents, or a full `CLAUDE.md` into the user vault.
- Do not let the Agent edit `.vault-meta/address-counter.txt`.
- Synapse may write:
  - `.vault-meta/address-counter.txt`
  - `.raw/.manifest.json`
  - wiki Markdown files under `wiki/`
- Synapse must not modify source files under `.raw/` except `.raw/.manifest.json`.
- Ordinary Agent conversations, Scheduler runs, Workflow runs, and non-knowledge-base projects must not load or run the DragonScale finalizer.
- Boundary scoring and semantic tiling remain out of scope for this phase.

## Chosen Design

Use a Synapse-owned post-turn finalizer.

The Agent keeps doing semantic work:

- read changed `.raw/` sources,
- create or update `wiki/sources/`, `wiki/concepts/`, and `wiki/entities/`,
- update `wiki/index.md`, `wiki/hot.md`, `wiki/log.md`,
- update manifest `sources` entries with hashes and pages touched.

Synapse takes over DragonScale address work after the turn:

1. Detect that the user message was an ingest request.
2. Let the Agent finish the turn.
3. Scan eligible wiki pages.
4. Reuse existing `address:` frontmatter where present.
5. Reuse existing `manifest.address_map[path]` where present.
6. Allocate new `c-NNNNNN` addresses only for eligible pages that still lack an address.
7. Insert missing `address:` into page frontmatter.
8. Write merged `address_map` to `.raw/.manifest.json`.

This mirrors the upstream single-writer rule while moving the writer from the Agent/script layer into Synapse.

## Why Not Preallocate Addresses In The Prompt

Preallocating an address pool before the Agent writes pages is simpler, but it has worse semantics:

- Synapse does not know how many new pages the Agent will create.
- It would reserve unused addresses more often than the upstream per-page allocator.
- It still leaves `address_map` correctness to the Agent.
- Natural-language ingest and `/wiki ingest` would need duplicated prompt machinery.

The finalizer is more robust because it works from the actual files the Agent wrote.

## Architecture

```text
Agent turn
  |
  | /wiki ingest or natural-language ingest
  v
Agent writes wiki pages and source manifest entries
  |
  v
AgentRuntime afterTurn contribution hook
  |
  v
KnowledgeBaseIngestFinalizer
  |
  +-- read .raw/.manifest.json
  +-- scan wiki/**/*.md
  +-- preserve existing page addresses
  +-- allocate missing addresses through DragonScaleAddressService
  +-- write page frontmatter
  +-- write manifest address_map
```

New implementation units:

- `desktop/electron/services/agent-runtime/project-contributions.ts`
  - Add a minimal generic `afterTurn` contribution hook.
- `desktop/electron/services/agent-runtime/conversation-router.ts`
  - Invoke `afterTurn` after a live Agent turn finishes.
  - Log finalizer failures without hiding the Agent result.
- `desktop/electron/services/knowledge-base/ingest-intent.ts`
  - Detect `/wiki ingest` and natural-language ingest requests.
- `desktop/electron/services/knowledge-base/ingest-finalizer.ts`
  - Own the deterministic DragonScale post-pass.
- `desktop/electron/services/knowledge-base/manifest.ts`
  - Add a safe manifest writer.
- `desktop/electron/services/knowledge-base/wiki-page-addresses.ts`
  - Focused helpers for wiki page eligibility, frontmatter parsing, and address insertion.

## Agent Runtime Integration

`AgentProjectContribution` gets an optional hook:

```ts
afterTurn?(input: AgentProjectAfterTurnInput): Promise<void> | void
```

The context contains:

- original `AgentMessage`,
- `AgentRuntimeTurnResult`,
- `conversationId`,
- whether the live session was newly created.

`mergeAgentProjectContributions` calls all `afterTurn` hooks sequentially.

Only the knowledge-base contribution registers this hook. The runtime extension is generic but inert for ordinary projects.

## Ingest Intent Detection

The finalizer should run only for knowledge-base ingest turns.

Positive examples:

- `/wiki ingest`
- `/wiki ingest --force`
- `汲取知识`
- `提取知识`
- `导入这些来源`
- `把这些资料整理进知识库`
- `ingest sources`
- `process these sources`
- `add this to the wiki`

Negative examples:

- `/wiki query`
- `/wiki hot`
- `查询知识库`
- `刷新热点`
- `保存这段对话`

The detector should be a small pure function with tests. It is intentionally conservative to avoid assigning addresses during unrelated conversations.

## Finalizer Page Eligibility

The finalizer scans Markdown files under `wiki/`.

Eligible:

- `.md` files under `wiki/sources/`, `wiki/concepts/`, `wiki/entities/`, `wiki/questions/`, and other non-meta wiki folders.
- Files with no `type` or a non-meta `type` frontmatter.
- Files with `created:` missing or `created:` on or after `2026-04-23`.

Excluded:

- `_index.md`
- `index.md`
- `log.md`
- `hot.md`
- `overview.md`
- `dashboard.md`
- `Wiki Map.md`
- `getting-started.md`
- files under `wiki/folds/`
- files under `wiki/meta/`
- files with `type: meta`
- files with `type: fold`
- files with `created:` before `2026-04-23`
- symlinked files or paths that leave the project root

Legacy pages are not backfilled in this phase.

## Address Rules

For each eligible page:

1. If the page already has `address: c-NNNNNN` in frontmatter:
   - keep it,
   - upsert `address_map[relativePagePath] = address`,
   - do not increment the counter.
2. Else if `manifest.address_map[relativePagePath]` exists:
   - insert that address into frontmatter,
   - do not increment the counter.
3. Else:
   - call `DragonScaleAddressService.allocate(projectPath)`,
   - insert the returned address into frontmatter,
   - upsert `address_map[relativePagePath] = address`.

If a page lacks frontmatter, insert a minimal frontmatter block with `address` at the top. Do not invent `type`, `title`, `status`, or `tags`; those remain the Agent's responsibility.

If the manifest contains stale `address_map` entries for missing pages, phase 2 preserves them. Deleting stale mappings is a separate cleanup feature.

## Manifest Writing

Add a safe writer for `.raw/.manifest.json`.

The writer must:

- ensure the target path stays inside the project path,
- reject symlinked `.raw` or `.raw/.manifest.json` paths,
- preserve existing `version`, `created`, `description`, and `sources`,
- write `address_map` as normalized slash-separated paths,
- write stable pretty JSON with trailing newline.

If the manifest is invalid, the finalizer should skip writes and log a warning. The ingest command already reports invalid manifests before sending an ingest prompt.

## Prompt And Skill Updates

Update the prompt-backed ingest instructions:

- The Agent must not edit `.vault-meta/address-counter.txt`.
- The Agent must not invent new DragonScale addresses.
- The Agent should preserve existing `address:` fields if it rewrites a page.
- The Agent should keep `sources[rawPath].pages_created` and `pages_updated` accurate.
- Synapse will run the DragonScale address finalizer after the turn.

This update must be made in both:

- `desktop/resources/knowledge-base/prompts/ingest.md`
- `desktop/resources/knowledge-base/claude-plugin/skills/wiki-ingest/SKILL.md`

## Error Handling

Finalizer failures must not erase or replace the Agent's response.

If finalization fails:

- log a structured warning,
- leave wiki pages and manifest as they are,
- do not retry automatically inside the same turn.

Corrupt address counters should surface as finalizer warnings. A later repair command can expose `DragonScaleAddressService.rebuild`.

## Tests

Required tests:

- Intent detection for slash and natural-language ingest.
- Negative intent tests for query/hot/save.
- Manifest writer preserves fields and rejects symlinks.
- Finalizer inserts addresses into pages missing `address:`.
- Finalizer reuses existing frontmatter addresses.
- Finalizer reuses existing `address_map` entries.
- Finalizer excludes meta and legacy pages.
- Finalizer updates `address_map` without changing manifest `sources`.
- Agent runtime calls knowledge-base `afterTurn` only for knowledge-base projects.
- `/wiki ingest` prompt and `wiki-ingest` skill tell the Agent that Synapse owns DragonScale address finalization.

## Success Criteria

- `/wiki ingest` can create wiki pages without manually assigning addresses; Synapse adds addresses after the turn.
- Natural-language ingest requests trigger the same finalizer path.
- `.vault-meta/address-counter.txt` is created only when a new eligible page needs an address.
- `.raw/.manifest.json` `address_map` is updated by Synapse.
- User vault templates still do not contain runnable Agent files or DragonScale scripts.
- Focused tests, hard constraints, and typecheck pass.
