# Knowledge Base Folder Export and Import Design

**Date:** 2026-08-04  
**Status:** Implemented

## Scope

Settings replaces the standalone `新建知识库` button with an outline `知识库` dropdown. Its fixed actions open separate dialogs:

1. `新建知识库` keeps the existing name-only managed creation flow.
2. `导入知识库` selects and validates one complete runtime folder, shows the suggested name and size, and requires a trusted-source confirmation.

Each managed Knowledge Base row also exposes `导出`. Import/export progress can be observed and cancelled during copying or verification. These are settings-only IPC operations and are not MCP capabilities.

## Import contract

- Input is one runtime folder, never its parent `knowledge-bases/` directory.
- A current export is identified by `.synapse-knowledge-base.json`. Legacy input is accepted only for a known plugin identity with `.claude-plugin/plugin.json`, `skills/`, `commands/`, `CLAUDE.md`, `.raw/.manifest.json`, and `wiki/index.md`.
- Preflight recursively records regular files, byte counts, modes, and SHA-256 hashes. Symbolic links, directory junctions, unsupported entries, unsafe relative paths, unknown plugins, missing structure, invalid metadata, and mismatched hashes are rejected.
- The renderer receives only a short-lived token and summary. The source path and snapshot remain in the main process.
- Commit requires trusted-source confirmation and a non-empty name. Synapse creates a new UUID, copies into `<current-storage-root>/knowledge-bases/.<id>.importing`, verifies the copy, atomically renames it to `<id>`, then registers `synapse-kb://<id>`.
- The source is never changed. No content, template, or absolute path rewriting is performed.
- A journal removes incomplete temporary or unregistered destination folders after failure, cancellation, or restart. A successfully registered destination remains authoritative even if journal cleanup later fails.

## Export contract

- Export accepts one managed `projectId` and copies its complete backing runtime to a newly named child folder of the chosen destination.
- The output metadata records schema version, Knowledge Base name, template version, source runtime ID, export time, and each runtime file's size and SHA-256.
- Copy verification happens before the temporary export folder is atomically renamed. The managed source is not modified.
- Export contains no Agent conversations, account/identity data, or application configuration.

## Coordination and security

- Import, export, and global Knowledge Base storage migration are mutually exclusive.
- Export is rejected while any source mutation is active or while the selected Knowledge Base has an active Agent session.
- Folder selection and destination access use the existing permission guard and audit sink. Renderer access is limited to typed preload methods and progress events.
- Import checks target free space before copying, including a safety margin.

## Acceptance coverage

- Dropdown routing and independent dialog reset behavior.
- Legacy single-runtime import, parent-directory rejection, trusted-source confirmation, source preservation, default/custom storage, and symlink rejection.
- Current-format export/import name round trip and metadata verification.
- IPC picker, permission, audit, import, and export boundaries.
