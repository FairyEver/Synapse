# Managed Knowledge Base Runtime Design

## Summary

Synapse will change Knowledge Base from a user-selected visible vault into a Synapse-managed project type.

A knowledge base is still a project for Agent conversation routing, but users no longer choose or see its real filesystem location. Synapse creates the actual runtime directory under application-managed storage, initializes it from an internal `claude-obsidian`-derived template, and registers that directory as the hidden backing path for the project.

This supersedes the earlier visible-vault design in `2026-05-21-knowledge-base-project-capability-design.md` for new knowledge bases.

## Product Decision

Use option B: managed black-box knowledge bases.

The product promise is:

- Users create a Synapse knowledge base project by name.
- Users start conversations from the existing Agent conversation interface by selecting that project.
- Users manage source files through Synapse UI, not by browsing the real runtime folder.
- The actual directory may contain Claude Code plugin, skill, command, hook, prompt, script, and wiki files because it is Synapse-owned runtime state.
- User-facing export/import can be added later, but the first migration focuses on creation and normal Agent conversation.

## Goals

- Keep Knowledge Base compatible with the existing project-scoped Agent conversation UI.
- Prevent the normal user path from exposing the backing directory as a folder they can open directly in Claude Code.
- Reuse the upstream `AgriciDaniel/claude-obsidian` structure as an internal template instead of reimplementing its behavior in Synapse services.
- Remove the old requirement that runnable Agent files must not exist inside the knowledge base runtime directory.
- Remove SDK runtime injection from the normal Knowledge Base Agent launch path.
- Keep existing useful Synapse UI affordances for knowledge bases: special project detection, quick commands, maintenance/source management entry points, and file conversion.
- Keep Knowledge Base-specific logic isolated from ordinary Agent conversations, Scheduler, Workflow, and other Agent entry points.

## Non-Goals

- No user-selected folder for new knowledge bases in this migration.
- No import/export in the first implementation slice.
- No attempt to make the managed backing directory cryptographically inaccessible to advanced users with local filesystem knowledge.
- No rewrite of upstream `claude-obsidian` behavior into Synapse-owned coordinator/finalizer code unless a behavior cannot be handled by the template runtime.
- No SDK-level temporary plugin, skill, hook, or command injection for the knowledge base runtime.
- No change to ordinary project Agent conversations.

## Hard Rules

- New knowledge bases must be created in a Synapse-owned application data directory, not in a user-selected folder.
- The UI must not show the real backing path or offer "open real folder" for managed knowledge bases.
- Managed knowledge base projects must still be selectable in the existing Agent conversation project selector.
- Knowledge Base-specific UI remains allowed only when the selected project is a managed knowledge base.
- Ordinary projects must not load Knowledge Base plugin, skill, hook, command, prompt, or template files.
- Scheduler and Workflow Agent launches must not automatically receive Knowledge Base runtime behavior.
- SDK runtime injection used only to hide Agent assets from visible user vaults should be removed from the new path.
- Developer template sync tooling is allowed, but it must be exposed through a root `package.json` developer command only and must not run in user workspaces.

## User Model

Project management adds or keeps a **New Knowledge Base** action.

Creation flow:

```text
User chooses "新建知识库"
-> enters a name
-> Synapse creates a managed runtime directory
-> Synapse copies the internal claude-obsidian template into that directory
-> Synapse registers a project with type knowledge-base and a hidden backing path
-> user can select that project in Agent chat
```

The user-facing project record should expose only product fields:

```ts
type ManagedKnowledgeBaseProject = {
  id: string
  name: string
  type: "knowledge-base"
  managed: true
}
```

Electron-side storage may retain the backing path:

```ts
type ManagedKnowledgeBaseProjectRecord = ManagedKnowledgeBaseProject & {
  backingPath: string
  templateSource: {
    repo: "AgriciDaniel/claude-obsidian"
    commit: string
    templateVersion: string
  }
}
```

Renderer UI should not render `backingPath`.

## Managed Runtime Layout

Synapse creates backing directories under app-managed storage, for example:

```text
<userData>/knowledge-bases/<kbId>/
```

The backing directory may include the full internal runtime layout required by `claude-obsidian`, including:

```text
.claude/
.claude-plugin/
agents/
commands/
hooks/
scripts/
skills/
wiki/
.raw/
.vault-meta/
_attachments/
CLAUDE.md
```

This directory is no longer treated as a user-owned clean vault. It is runtime state.

Later export can generate a clean portable vault from this runtime. Export output should be data-oriented and may omit runnable Agent assets unless the product explicitly adds an "export full developer runtime" option.

## Template Sync Tooling

Add a developer-only sync command to the root workspace `package.json`.

Recommended command name:

```json
{
  "scripts": {
    "kb:sync-template": "node scripts/sync-claude-obsidian-template.mjs"
  }
}
```

The command should run a repository script, for example:

```text
scripts/sync-claude-obsidian-template.mjs
```

The script behind the command downloads or checks out:

```text
https://github.com/AgriciDaniel/claude-obsidian
```

The current upstream `main` HEAD observed during this design is:

```text
75d3b6feb77b96c6bb16599c4550cc9703553d87
```

The script should copy the upstream template into a committed Synapse resource directory such as:

```text
desktop/resources/knowledge-base/claude-obsidian-template/
```

The copied resource should include source metadata:

```text
desktop/resources/knowledge-base/claude-obsidian-template/SOURCE.json
```

with fields such as:

```json
{
  "repo": "https://github.com/AgriciDaniel/claude-obsidian",
  "commit": "75d3b6feb77b96c6bb16599c4550cc9703553d87",
  "syncedAt": "2026-05-24",
  "notes": "Developer-only template source for managed Synapse knowledge bases."
}
```

The `kb:sync-template` command is not a user feature. It should be run by developers when intentionally updating the embedded template. The script must preserve upstream license and attribution files.

## Agent Runtime

For managed knowledge base projects, Agent launch should use the backing directory as the working directory.

Because the backing directory already contains the required Claude/Agent runtime files from the template, Synapse does not need to inject temporary SDK plugin, skill, hook, command, or prompt assets at session start.

Agent conversation flow:

```text
User opens Agent conversation
-> selects managed knowledge base project
-> Synapse resolves project id to hidden backingPath
-> Agent runs with cwd = backingPath
-> claude-obsidian template files provide wiki behavior
-> Synapse renderer shows knowledge-base-specific quick actions
```

The only Knowledge Base-specific Agent handling that should remain in the shared Agent path is project resolution and UI capability metadata. Runtime behavior should come from the managed directory template.

## UI Behavior

Knowledge Base remains a project subtype in existing settings and Agent UI.

Keep:

- New knowledge base action in project management.
- Knowledge base badge or type indicator where existing project UI needs it.
- Agent composer quick commands for knowledge base projects.
- Source/material management button.
- Maintenance file entry points such as hot/wiki/manifest views where already useful.
- File conversion before source staging.

Change:

- New knowledge base creation asks for name only.
- Do not ask for a folder path.
- Do not show or open the real backing directory.
- Source/material management should use Synapse UI to copy files into the managed runtime.

First slice does not need import/export UI. It should avoid promising export until implemented.

## Source Management

The existing source manager and file conversion direction remain useful.

For managed knowledge bases:

```text
User adds files in Synapse UI
-> Synapse copies original files into backingPath-managed storage
-> Synapse converts supported files when needed
-> generated Markdown/source files are placed into the managed runtime layout
-> user triggers or requests ingest through Agent chat or UI quick action
```

The user should not need to know `.raw` or the backing directory path.

## Code Migration Strategy

Do not keep old-scheme code merely because it was recently written.

Retain code that serves the managed design:

- Knowledge base project type detection.
- Knowledge base-specific Agent UI state.
- Composer quick commands for knowledge base projects.
- Source/material manager UI and IPC if it works through Synapse APIs.
- File conversion and staging code that can write into a managed backing path.
- Basic creation/repair code that initializes a directory from a template.

Remove or retire code whose only purpose was the old visible-vault design:

- SDK runtime injection for Knowledge Base plugins, skills, hooks, commands, or prompts.
- Logic that exists only to keep runnable Agent assets out of a user-visible vault.
- Complex Synapse-owned reimplementations of upstream `claude-obsidian` behavior when the managed template can provide it directly.
- Project capability contribution code that injects Knowledge Base runtime behavior into otherwise normal project Agent sessions.
- Tests that assert the old invariant that managed Knowledge Base runtime directories must not contain Claude/Agent runnable assets.

Before deletion, classify each changed file as:

- **Keep**: needed for managed Knowledge Base.
- **Move/Adapt**: useful but currently assumes user-visible vault paths.
- **Delete**: only exists for the old anti-exposure strategy.

## Safety And Permissions

Writes to managed runtime directories are still filesystem writes and should use existing Electron permission/audit infrastructure where required by project rules.

Creation must be collision-safe by `kbId`, not by user-visible name.

Renaming a knowledge base changes display name only and should not rename the backing directory in the first slice.

Deleting a managed knowledge base should require confirmation and should be implemented as a later explicit destructive operation if not already available.

## Testing

Focused tests should cover:

- New knowledge base creation creates a project without asking for a user path.
- The project record stores `type: "knowledge-base"` and `managed: true`.
- Renderer project data does not expose the backing path.
- Agent launch resolves the managed project to its backing path.
- Ordinary projects do not load Knowledge Base runtime behavior.
- Knowledge Base quick commands appear only for managed knowledge base projects.
- Source manager copies files into the managed backing path through Synapse APIs.
- No SDK runtime injection is called for managed knowledge base Agent sessions.
- Template sync metadata records upstream repository and commit.

## Migration Notes

Existing experimental visible-vault knowledge bases should be treated separately from new managed knowledge bases.

The first migration can avoid automatic conversion. It is acceptable to support only new managed knowledge bases initially, then add manual import/export later.

Documentation and old specs should be considered stale where they say a knowledge base is a user-selected local folder. New implementation plans should use this managed-runtime design as the source of truth.
