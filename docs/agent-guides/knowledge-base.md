# Knowledge Base Module Guide

## Purpose

The Knowledge Base feature creates an Obsidian-compatible Markdown vault that users can open, browse, graph, and edit with local Obsidian tools. Synapse owns the advanced AI maintenance behavior: ingest, query, save, lint, hot cache updates, manifest handling, and future automation.

This split is intentional. The vault format is portable; the maintenance workflow is a Synapse product capability.

## Canonical Design

Read these before changing the module:

- `docs/superpowers/specs/2026-05-21-knowledge-base-project-capability-design.md`
- `docs/superpowers/plans/2026-05-21-knowledge-base-project-capability.md`
- `docs/superpowers/plans/2026-05-21-wiki-phase1.md`

## Hard Rules

- Do not write runnable Agent capability files into a user knowledge-base folder.
- Do not add `.agents/skills`, `.claude/skills`, `.codex/skills`, Claude plugin commands, hooks, or a full `CLAUDE.md` to the vault template.
- Do not make the vault independently usable as a Claude Code, Codex, or other Agent Skills project.
- Keep operational prompts inside Synapse resources: `desktop/resources/knowledge-base/prompts/`.
- Keep user vault templates limited to Obsidian-compatible Markdown structure plus Synapse metadata such as `.synapse-kb.json` and `.raw/.manifest.json`.
- Synapse may update `.raw/.manifest.json`; it must not edit other source files under `.raw/`.
- AI-maintained knowledge belongs under `wiki/`.
- Natural-language ingest/query/save/lint behavior must come from Synapse project contributions and internal prompts, not from copying runnable skills into the user vault.

## Allowed Vault Shape

```txt
knowledge-folder/
  .synapse-kb.json
  .raw/
    .manifest.json
  wiki/
    index.md
    hot.md
    log.md
    overview.md
    sources/
      _index.md
    concepts/
      _index.md
    entities/
      _index.md
    questions/
      _index.md
    meta/
  _attachments/
```

## Implementation Notes

- Deterministic file facts belong in Electron main-process services: manifest parsing, source discovery, hashing, and command prompt assembly.
- Semantic wiki writing happens through the project-scoped Agent conversation inside Synapse.
- Ingest manifest finalization is Synapse-owned. The Agent writes semantic wiki Markdown and emits `synapse.kb.ingest.report.v1`; Synapse validates the report, computes source hashes, and writes `.raw/.manifest.json` `sources` and `address_map`.
- `/wiki ingest` remains a Synapse internal prompt command. Future aliases such as `/kb ingest` should stay inside the Synapse command/contribution layer.
- If adding tests, include negative assertions that the vault template does not create `.agents/skills`, `.claude/skills`, `.codex/skills`, or plugin command files.
