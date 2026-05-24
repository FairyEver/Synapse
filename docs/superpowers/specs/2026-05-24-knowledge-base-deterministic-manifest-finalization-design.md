# Knowledge Base Deterministic Manifest Finalization Design

## Goal

Make Knowledge Base ingest deterministic by moving `.raw/.manifest.json` final writes from the Agent to Synapse-owned Electron services.

After this change, `/wiki ingest` and natural-language ingest requests use the same source preflight, the Agent writes semantic wiki Markdown, and Synapse validates the result before writing manifest `sources` and `address_map`.

## Background

The current implementation already keeps runnable Agent capability files out of the user's vault and loads Knowledge Base behavior through Synapse project contributions and a Claude Code SDK local plugin.

The remaining weak point is manifest ownership:

- `/wiki ingest` has deterministic source scanning and hash calculation before prompting the Agent.
- Natural-language ingest can be routed by the injected `wiki-ingest` skill, but it does not necessarily receive the exact same preflight appendix.
- The post-turn finalizer currently owns DragonScale page addresses and manifest `address_map`.
- Manifest `sources` entries still depend on the Agent writing `.raw/.manifest.json` correctly.

This design changes the baseline: the Agent may read manifest state for context, but Synapse is the only final writer for manifest facts.

## Hard Rules

- Do not write runnable Agent skill, rule, hook, command, plugin, agent, script, or full prompt files into the user Knowledge Base vault.
- Keep Knowledge Base Agent behavior in Synapse internal resources and project contributions.
- Ordinary Agent conversations, Scheduler runs, Workflow runs, and non-Knowledge Base projects must not load Knowledge Base ingest preflight, manifest finalization, DragonScale finalization, or KB-only plugin behavior.
- Synapse may write `.raw/.manifest.json`, `.vault-meta/address-counter.txt`, and AI-maintained Markdown under `wiki/`.
- Synapse must not modify user source files under `.raw/` except `.raw/.manifest.json`.
- The user vault must remain an Obsidian-compatible Markdown vault with Synapse metadata, not a Claude Code or Codex project.
- Invalid or ambiguous manifest writes must fail closed: record a warning and leave `sources` unchanged rather than writing guessed facts.
- Paths accepted from the Agent must be normalized, bounded to the project root, and restricted to expected areas.

## Non-Goals

- Do not replace the Agent's semantic wiki-writing work with a deterministic parser.
- Do not parse every possible assistant prose format. The Agent must emit a fenced JSON ingest report using the contract in this document.
- Do not make URL or image ingestion a separate pipeline in this design; they must enter through the same `.raw/` source model when supported.
- Do not repair an invalid manifest silently. Automatic repair is allowed only through an explicit repair action or a clearly marked forced-rebuild command.
- Do not introduce renderer-side filesystem scanning.

## New Baseline

Synapse owns final manifest writes.

The Agent is responsible for:

- reading changed sources from `.raw/`,
- creating or updating wiki Markdown pages under `wiki/`,
- updating `wiki/index.md`, `wiki/hot.md`, and `wiki/log.md`,
- preserving existing page `address:` frontmatter,
- emitting a structured ingest report at the end of the turn.

Synapse is responsible for:

- discovering source files,
- computing hashes,
- deciding which sources are new, changed, unchanged, skipped, or forced,
- validating the Agent's ingest report,
- determining `ingested_at`,
- writing `manifest.sources`,
- allocating DragonScale addresses,
- inserting missing page `address:` frontmatter,
- writing `manifest.address_map`,
- logging finalizer warnings.

## End-To-End Flow

```text
User message
  |
  +-- /wiki ingest
  |     -> command router asks KB contribution for ingest preflight
  |
  +-- natural-language ingest
        -> KB contribution detects ingest intent before the turn

KnowledgeBaseIngestCoordinator.prepareTurn
  |
  +-- read and validate .raw/.manifest.json
  +-- scan .raw/
  +-- compute sha256 for supported sources
  +-- classify new/changed/unchanged/skipped
  +-- store preflight snapshot keyed by turnId
  +-- build ingest prompt appendix

Agent live turn
  |
  +-- writes wiki Markdown
  +-- does not edit .raw/.manifest.json
  +-- emits fenced JSON ingest report

KnowledgeBaseIngestCoordinator.finalizeTurn
  |
  +-- retrieve preflight snapshot
  +-- parse assistant result ingest report
  +-- validate report source paths and wiki paths
  +-- verify referenced wiki pages exist
  +-- merge manifest sources from trusted preflight hashes
  +-- run DragonScale address finalizer
  +-- write one normalized manifest
  +-- log warnings without hiding Agent response
```

## Ingest Intent And Preflight

Knowledge Base ingest intent includes:

- `/wiki ingest`
- `/wiki ingest --force`
- natural-language Chinese requests such as `汲取知识`, `提取知识`, `入库`, `导入这些来源`, `把这些资料整理进知识库`
- natural-language English requests such as `ingest sources`, `process these sources`, `add this to the wiki`
- `/wiki research <topic>` when research writes new wiki pages and should receive address finalization

Only source ingest gets source preflight. Research gets page/address finalization, but does not write `.raw/.manifest.json` `sources` unless it stages a source into `.raw/` and produces a source report.

The preflight result contains:

- manifest read status,
- changed source list with `.raw/...` relative paths and sha256 hashes,
- skipped source list with reasons,
- force flag,
- generated timestamp,
- stable turn id,
- a wiki snapshot for page create/update classification.

If manifest JSON is invalid:

- `/wiki ingest` returns a direct error result before the Agent turn when possible.
- natural-language ingest injects a blocking prompt that tells the Agent to report the invalid manifest and avoid ingest.
- `finalizeTurn` logs a warning if it still observes an invalid manifest.

## Prompt Contract

The ingest prompt must state that the Agent must not edit `.raw/.manifest.json`.

At the end of an ingest turn, the Agent must include exactly one fenced JSON block with marker `synapse_kb_ingest_report`:

```json
{
  "schema": "synapse.kb.ingest.report.v1",
  "processed_sources": [
    {
      "source": ".raw/example.md",
      "pages_created": ["wiki/sources/example.md"],
      "pages_updated": ["wiki/index.md", "wiki/hot.md", "wiki/log.md"]
    }
  ],
  "skipped_sources": [
    {
      "source": ".raw/unchanged.md",
      "reason": "unchanged"
    }
  ]
}
```

The Agent may still summarize the work in normal prose, but Synapse only trusts the JSON report.

## Report Validation

Synapse accepts a report entry only if:

- `schema` equals `synapse.kb.ingest.report.v1`,
- each `source` appears in the preflight changed or forced source list,
- each `source` starts with `.raw/`,
- each page path starts with `wiki/`,
- each page path ends with `.md`,
- no path escapes the project root after normalization,
- every listed created/updated page exists at finalize time,
- `pages_created` and `pages_updated` are arrays of strings,
- the same page is not listed as both created and updated for the same source.

Synapse rejects or ignores:

- unknown source paths,
- paths outside `.raw/` or `wiki/`,
- absolute paths,
- symlinks that leave the project root,
- missing wiki pages,
- malformed JSON,
- multiple conflicting report blocks.

If a report is partially valid, Synapse writes only accepted source entries and logs warnings for rejected entries. If no processed source entry is valid, Synapse does not update `manifest.sources`.

## Page Create/Update Classification

The report carries `pages_created` and `pages_updated`, but Synapse verifies them against a pre-turn wiki snapshot.

The snapshot records relative path, existence, mtime, size, and sha256 for Markdown files under `wiki/`.

Final classification rules:

- A path listed in `pages_created` is accepted as created only if it did not exist in the pre-turn snapshot and exists after the turn.
- A path listed in `pages_updated` is accepted as updated only if it existed before the turn and its sha256 changed, or if it is a canonical maintenance page that the Agent wrote during ingest.
- If the Agent lists a page under the wrong category, Synapse may correct it when the snapshot proves the real category.
- If the snapshot cannot prove either category, Synapse rejects the page path for manifest `sources` and logs a warning.

Canonical maintenance pages are:

- `wiki/index.md`
- `wiki/hot.md`
- `wiki/log.md`

## Manifest Merge

The manifest writer becomes the only service allowed to perform final manifest writes.

For each accepted processed source:

- use the preflight `hash`,
- set `ingested_at` to the finalizer timestamp,
- set `pages_created` to the validated created page list,
- set `pages_updated` to the validated updated page list.

Existing `sources` entries for sources not processed in the current turn are preserved.

Sources skipped as unchanged are preserved and not rewritten unless forced ingest was requested and the source was accepted as processed.

`address_map` is merged from the DragonScale address finalizer in the same final manifest write. The final writer normalizes slash-separated paths and emits stable pretty JSON with a trailing newline.

## DragonScale Address Finalization

The existing post-turn address behavior remains, but it is folded into the same final manifest transaction:

- scan eligible wiki pages,
- reuse page `address:` frontmatter,
- reuse existing `manifest.address_map[path]`,
- allocate new `c-NNNNNN` addresses through `DragonScaleAddressService`,
- insert missing page `address:` frontmatter,
- update `address_map`.

Address allocation continues to update `.vault-meta/address-counter.txt`. The Agent must not edit this counter.

## Error Handling And Warnings

Finalizer failures must not erase the Agent response.

Synapse records structured warnings for:

- invalid manifest,
- missing preflight snapshot,
- malformed report,
- rejected source path,
- rejected wiki path,
- missing page,
- path outside project root,
- symlink rejection,
- hash mismatch between preflight and finalize rescan,
- manifest write failure,
- address allocation failure.

Warnings must include:

- boundary, such as `knowledge-base.ingest-finalizer`,
- project id or path when safe,
- conversation id,
- turn id,
- warning code,
- short human-readable message.

The user-facing result should remain concise. The first implementation may rely on structured logs and Agent event metadata; renderer UI for warnings is outside this design unless existing Agent events already surface them.

## Concurrency

Knowledge Base ingest finalization must serialize per project path.

If two ingest turns run for the same project:

- only one finalizer writes manifest at a time,
- the second finalizer rereads manifest after the first write,
- unchanged unrelated `sources` and `address_map` entries are preserved.

The lock must live in Synapse-owned service code, not in the user vault.

## SDK And Vault Isolation

The Claude Code SDK local plugin remains internal to Synapse and is loaded per Knowledge Base conversation through session options.

The plugin may contain the `wiki-ingest` skill and supporting instructions, but these files live under `desktop/resources/knowledge-base/claude-plugin/`, not in the user vault.

The implementation must preserve tests that assert user vault templates do not contain:

- `.agents/skills`
- `.claude/skills`
- `.codex/skills`
- Claude plugin command files
- hooks
- runnable DragonScale scripts
- full `CLAUDE.md`

## File Ownership

Expected Synapse-owned implementation files:

- `desktop/electron/services/knowledge-base/ingest-coordinator.ts`
- `desktop/electron/services/knowledge-base/ingest-turn-store.ts`
- `desktop/electron/services/knowledge-base/ingest-report.ts`
- `desktop/electron/services/knowledge-base/wiki-snapshot.ts`
- `desktop/electron/services/knowledge-base/manifest-finalizer.ts`
- existing `manifest.ts`
- existing `source-scan.ts`
- existing `ingest-finalizer.ts`, either renamed or reduced to page address finalization
- existing `agent-contribution.ts`
- existing Agent Runtime project contribution interfaces

No Knowledge Base-specific finalizer logic should be added to Scheduler, Workflow, renderer modules, or ordinary Agent runtime behavior beyond a generic project-contribution hook.

## Testing Requirements

Unit tests must cover:

- natural-language ingest receives the same source preflight as `/wiki ingest`,
- report parser accepts the exact fenced JSON contract,
- report parser rejects malformed or conflicting reports,
- path validation rejects absolute paths and traversal,
- wiki snapshot detects created pages,
- wiki snapshot detects updated pages,
- manifest finalizer writes trusted preflight hashes,
- manifest finalizer writes `ingested_at`,
- manifest finalizer preserves unrelated sources,
- manifest finalizer refuses to write `sources` when no valid report entry exists,
- address finalization still updates `address_map`,
- invalid manifest logs a warning,
- finalizer warning does not hide the Agent result,
- non-Knowledge Base projects do not run ingest preflight or finalizer.

Integration tests must cover:

- `/wiki ingest` full prompt includes source hashes and report contract,
- natural-language `汲取知识` full prompt includes the same source hashes and report contract,
- post-turn finalization writes both `sources` and `address_map`,
- user vault templates remain free of runnable Agent capability files.

## Success Criteria

- `/wiki ingest` and natural-language ingest share one deterministic source preflight path.
- The Agent no longer needs to edit `.raw/.manifest.json`.
- Synapse writes manifest `sources` using trusted hashes and validated page paths.
- Synapse writes manifest `address_map` through DragonScale finalization.
- Invalid reports do not corrupt manifest state.
- Invalid manifests produce structured warnings instead of silent skips.
- Existing Knowledge Base vault cleanliness rules remain true.
- Focused tests and hard-constraint checks pass.
