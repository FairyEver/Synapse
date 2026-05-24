# Knowledge Base Project Capability Design

> Superseded for new Knowledge Bases: use `docs/superpowers/specs/2026-05-24-managed-knowledge-base-runtime-design.md`.
> This document describes the earlier visible-vault approach and should be treated as historical context only unless a task explicitly targets legacy migration.

## Summary

Synapse will add a Knowledge Base capability to the existing project concept. A knowledge base is still a local project folder, not a repository and not a separate chat product. The folder stores an Obsidian-compatible Markdown vault, while Synapse owns the advanced maintenance behavior: ingest, query, save, lint, hot cache updates, manifest handling, and future automation.

The first version should avoid copying Claude Code plugins or runnable skill files into the user folder. The user can inspect and move their Markdown knowledge, but the convenient maintenance workflow remains a Synapse feature.

## Goals

- Let users create a new local knowledge base from Synapse without installing `claude-obsidian`, Obsidian plugins, MCP servers, or Claude plugin marketplaces.
- Let users open or mark an existing project folder as a knowledge base.
- Keep the underlying knowledge format Obsidian-compatible Markdown.
- Keep Agent chat decoupled from knowledge base UI by running normal project-scoped Agent conversations in the knowledge base folder.
- Avoid scattering knowledge-base checks throughout the Agent runtime. Use one project capability contribution point.
- Preserve product stickiness by keeping advanced prompts, commands, and policies inside Synapse.

## Non-Goals

- No Obsidian canvas feature in the first version.
- No Obsidian Git integration.
- No Obsidian Dataview, Bases, Local REST API, or MCP requirement.
- No DragonScale address assignment, semantic tiling, or log folding in the first version.
- No standalone knowledge base chat UI.
- No full file upload manager. The first version exposes a local `.raw` folder for users to manage source files themselves.
- No repository/content-store integration for knowledge bases.

## User Model

Projects remain local folders. A project may optionally declare the knowledge base capability:

```ts
type SynapseProjectConfig = {
  id: string
  name: string
  path: string
  capabilities?: {
    knowledgeBase?: {
      enabled: true
      schemaVersion: 1
      templateVersion: string
    }
  }
}
```

The project list and project settings should treat this as a project subtype, not a separate top-level entity. UI copy should stay direct: "知识库", "维护文件", "入库", "健康检查" when those actions exist.

## Vault Layout

Synapse creates or repairs the following structure:

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

The folder intentionally does not include `.agents/skills`, Claude plugin commands, hooks, or a complete `CLAUDE.md` that teaches other tools how to reproduce the Synapse maintenance workflow. A short README-style note may explain the folder layout for users, but not include the full operational prompts.

`.synapse-kb.json` stores Synapse metadata:

```json
{
  "type": "synapse.knowledgeBase",
  "schemaVersion": 1,
  "templateVersion": "2026-05-21",
  "createdBy": "Synapse"
}
```

`.raw/` contains user-maintained source files. Synapse may update `.raw/.manifest.json`; it must not modify other source files under `.raw/` during ingest.

`wiki/` contains generated and maintained knowledge pages. The format follows the essential `claude-obsidian` pattern: `index.md` as catalog, `hot.md` as short recent context, `log.md` as append-only operation history, and typed folders for sources, concepts, entities, questions, and meta reports.

## Synapse Internal Resources

Knowledge base maintenance prompts live inside Synapse, not in the user folder:

```txt
desktop/resources/knowledge-base/
  templates/
    .synapse-kb.json
    .raw/.manifest.json
    wiki/index.md
    wiki/hot.md
    wiki/log.md
    wiki/overview.md
    wiki/sources/_index.md
    wiki/concepts/_index.md
    wiki/entities/_index.md
    wiki/questions/_index.md
  prompts/
    bootstrap.md
    ingest.md
    query.md
    save.md
    lint.md
    hot-cache.md
```

The prompt package should be derived from the core `claude-obsidian` behavior, with product-specific cleanup:

- Remove community footer and marketing copy.
- Remove Obsidian plugin installation steps.
- Remove MCP/REST API setup requirements.
- Remove canvas, Git, Dataview/Bases, and DragonScale instructions from first-version prompts.
- Keep the core vault schema, source inbox, manifest, hot/index/log lifecycle, frontmatter, wikilinks, citations, and lint checks.

## Project Capability Boundary

Add a generic project capability contribution point rather than knowledge-base conditionals throughout Agent code:

```ts
type AgentProjectContribution = {
  hiddenContext?: string
  commands?: RegisteredPromptCommand[]
  toolPolicy?: ProjectToolPolicy
}
```

Knowledge base projects contribute:

- Bootstrap context describing the vault protocol.
- A compact `wiki/hot.md` snapshot when present.
- Prompt commands for `/kb`, `/kb ingest`, `/kb save`, and `/kb lint`.
- Natural-language routing guidance for "ingest", "query", "save this", and "lint the wiki".
- Tool policy that protects `.raw` source files while allowing writes to `wiki/` and `.raw/.manifest.json`.

Ordinary projects return no contribution. The existing Agent conversation UI remains the same.

## Agent Behavior

When a knowledge base project starts an Agent conversation:

1. The working directory remains the project folder.
2. Synapse obtains contributions from the project capability registry.
3. The bootstrap contribution is sent once per new live Agent session.
4. The Agent reads `wiki/hot.md` first, then `wiki/index.md`, then relevant pages.
5. The Agent writes maintained knowledge only under `wiki/` and `.raw/.manifest.json`.

For ordinary projects, Agent behavior must remain unchanged.

Command behavior:

- `/kb`: report knowledge base status and available operations.
- `/kb ingest`: process changed source files from `.raw/`.
- `/kb save`: save valuable conversation content into `wiki/questions/` or `wiki/meta/`.
- `/kb lint`: create a lint report under `wiki/meta/`.

Natural-language requests such as "ingest all", "save this", and "lint the wiki" should still work inside knowledge base projects through the bootstrap guidance, but slash commands use the `/kb` prefix to avoid leaking generic commands into ordinary project conversations.

The first version can keep these as prompt commands. Later versions may add UI buttons that send the same commands to the current project Agent session.

## User Flows

### New Knowledge Base

```txt
User chooses "新建知识库"
-> selects folder/name
-> Synapse creates the folder
-> copies the knowledge base template
-> adds a project config entry with knowledgeBase enabled
-> user can open Agent chat for that project
```

### Open Existing Knowledge Base

```txt
User chooses "打开知识库"
-> selects an existing folder
-> Synapse detects .synapse-kb.json or the wiki/.raw shape
-> Synapse repairs missing required files only after user confirmation
-> project is added or updated with knowledgeBase enabled
```

### Mark Existing Project

```txt
User opens project settings
-> enables knowledge base capability
-> Synapse creates missing .raw/wiki files without overwriting existing content
-> project gains the knowledge base badge and maintenance actions
```

### Maintain Files

```txt
User clicks "维护文件"
-> Synapse ensures <project.path>/.raw exists
-> Synapse opens that folder in the OS file manager
```

## Safety

- All template writes must stay inside the selected project folder.
- Repair must be additive by default. Do not overwrite existing wiki pages unless the user explicitly confirms.
- Sensitive filesystem writes go through existing permission and audit infrastructure.
- The first version should rely on prompt discipline plus a narrow tool policy where practical. A later hardening pass can enforce file-write denial for `.raw/*` except `.raw/.manifest.json`.
- Missing or malformed `.manifest.json` should be repaired conservatively.

## Testing

Focused tests should cover:

- Config normalization preserves older project entries without `capabilities`.
- New knowledge base creation writes the expected template files.
- Existing knowledge base detection handles `.synapse-kb.json` and folder-shape fallback.
- Repair does not overwrite existing user files.
- "维护文件" opens or creates `.raw` inside the project path.
- Agent project contributions are empty for ordinary projects.
- Agent project contributions are present for knowledge base projects.
- Prompt commands are only registered for knowledge base projects.

## First Implementation Slice

The first implementation should stop at:

1. Project config type and normalization.
2. Knowledge base template resources.
3. Knowledge base project creation/open/marking service.
4. Project list/settings UI affordances: badge and "维护文件".
5. Project capability contribution point.
6. Knowledge base prompt commands wired through the contribution point.

Do not add a separate knowledge base module page until the project capability flow is working.

## Design Decisions

- The first UI entry should appear wherever users already manage projects, including the project list/management surface and Settings > Projects if both exist in the active UI.
- Slash commands should use the `/kb` prefix in the first version. This keeps generic Agent command space clean.
- Query should be mostly natural-language behavior inside a knowledge base project. A `/kb query` alias may be added later, but it is not required for the first slice.
