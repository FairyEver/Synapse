# Knowledge Base Module Guide

## Purpose

Knowledge Base is a Synapse-managed project subtype. Users create it from project settings by entering a name; Synapse creates the real backing directory under Synapse-managed storage and registers the project with a virtual `synapse-kb://<id>` path.

The backing directory is initialized from `desktop/resources/knowledge-base/synapse-knowledge-base-template/`. That template is Synapse-branded runtime state synced from an upstream developer source by `pnpm run kb:sync-template`. It may contain Claude Code plugin, command, hook, skill, script, prompt, and wiki files because it is Synapse-owned runtime state, not a user-selected visible folder.

## Canonical Design

Read these before changing the module:

- `docs/superpowers/specs/2026-05-24-managed-knowledge-base-runtime-design.md`
- `docs/superpowers/specs/2026-06-10-knowledge-base-custom-storage-root-design.md`
- `docs/superpowers/plans/2026-05-24-managed-knowledge-base-runtime.md`

Older visible-vault docs are superseded for new knowledge bases.

## Hard Rules

- New knowledge bases are managed black-box projects; users do not choose or see the real backing path for an individual knowledge base.
- Synapse may expose one global Knowledge Base storage root setting. Runtime directories must still be created as `<storage-root>/knowledge-bases/<runtimeId>/`, and the renderer project path must remain `synapse-kb://<id>`.
- Changing the global storage root must migrate all existing managed runtimes transactionally. Failure keeps the old root and old data.
- Storage migration must hold the UI in a blocking modal. Copy and verification phases may be cancelled safely; switching configuration and cleaning up the old root may not be cancelled.
- If a custom storage root is unavailable, Knowledge Base creation, raw/source management, and Knowledge Base Agent sessions must be blocked until the root is restored or migrated through the explicit settings action.
- Do not reintroduce SDK session injection for Knowledge Base plugins, skills, hooks, commands, agents, or prompts. The managed backing directory already carries the runtime assets.
- Ordinary projects must not load Knowledge Base runtime files or quick actions.
- Scheduler, Workflow, and other Agent entry points must not receive Knowledge Base behavior unless they explicitly target a managed Knowledge Base project and resolve its backing directory through the project model.
- Knowledge Base-specific code stays in `desktop/electron/services/knowledge-base/`, `desktop/resources/knowledge-base/`, or narrow renderer project-capability UI. Do not scatter Knowledge Base checks through generic Agent runtime paths.
- The UI must not expose an "open real folder" action for managed knowledge bases.
- Source/material management must go through Synapse APIs and write into the managed backing directory.
- Synapse may copy user-provided files into `.raw/`; AI-maintained knowledge belongs under `wiki/`.

## Managed Runtime Shape

```txt
<storage-root>/knowledge-bases/<runtimeId>/
  .claude-plugin/
  commands/
  hooks/
  skills/
  scripts/
  CLAUDE.md
  .raw/
    .manifest.json
  wiki/
    hot.md
    index.md
    log.md
```

## Implementation Notes

- `pnpm run kb:sync-template` refreshes the developer template from the upstream runtime source and applies Synapse Knowledge Base branding before committing the template.
- Project config stores `capabilities.knowledgeBase.managed: true` and `runtimeId`.
- Renderer project lists show the Knowledge Base name, not its real path.
- Agent conversations resolve managed Knowledge Base projects to their backing directory before launching the session.
- The storage root defaults to Electron `userData`. A custom root is global, not per project.
- Composer quick actions are renderer-local conveniences and only appear for Knowledge Base projects.
- File conversion and source staging remain Synapse-owned because users add files through the Synapse UI.
