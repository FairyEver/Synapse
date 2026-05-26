# Repository and Knowledge Base Dangerous Operation Protection

## Context

Synapse has several file operations that can destroy or hide user data in repository and Knowledge Base flows. The highest-risk path is repository initialization: it currently removes every non-`.git/` top-level entry before creating the Synapse repository structure. Knowledge Base raw-material operations are narrower because they run inside managed storage and `.raw/`, but batch move and trash operations still deserve explicit safeguards.

This design covers only repository and Knowledge Base behavior. It does not change editor install, editor scan trash, content install, app reset, workflow output, or general content repository purge behavior.

## Goals

- Prevent accidental deletion during repository initialization.
- Remove write side effects from repository directory validation.
- Keep new local repository creation behavior safe and unchanged unless needed for shared helpers.
- Keep Knowledge Base raw file operations inside the managed `.raw/` boundary.
- Add clear audit/logging coverage for Knowledge Base raw mutations and repository initialization decisions.
- Preserve existing shadcn/Radix UI baseline if small confirmation UI changes are needed later.

## Non-Goals

- No global dangerous-operation framework for the whole app.
- No changes to editor installation, editor scan uninstall/trash, app reset, workflow file conversion, or content download.
- No migration away from managed Knowledge Base backing directories.
- No direct UI exposure of managed Knowledge Base real paths.
- No new dependency.

## Repository Initialization

Repository initialization must stop directly deleting existing content with `rm -r`. For non-empty directories, the service should create an initialization plan and require that exact plan to be confirmed before any mutation runs.

The preview should include:

- repository uuid and local path,
- a stable operation token,
- whether the directory is empty,
- top-level non-`.git/` entries,
- entry count and a lightweight fingerprint based on top-level names, type, size, and modified time,
- danger flags for paths that should never be initialized in-place.

Initialization should reject dangerous roots before confirmation. The first denylist should include home, Desktop, Documents, Downloads, filesystem roots, and the current Synapse source checkout. It should also reject a directory that looks like an existing non-Synapse source repository unless it is empty or explicitly created by Synapse.

On confirm, the main process must re-read the directory and verify that the token still matches the current fingerprint. If anything changed, initialization fails and asks the renderer to refresh the preview.

For non-empty directories, existing entries should be moved out of the way instead of permanently removed. The preferred first implementation is a timestamped sibling inside the selected directory:

```txt
<repo>/.synapse-init-backup-YYYYMMDD-HHmmss/
```

Each top-level non-`.git/` entry moves into that backup directory. After the move succeeds, Synapse creates the repository skeleton. If any move fails, initialization stops and does not scaffold partial structure. If the backup directory cannot be created, initialization fails.

The backup directory itself must be excluded from skeleton creation and subsequent initialization previews. A later cleanup action can be considered separately, but this design does not add it.

Empty directory initialization can still scaffold directly, but it should use the same safety check path and audit logging.

## Repository Validation

Directory validation must be read-only. The current path that calls `ensureContentDirectories()` during validation should be split:

- `validateDirectoryStructure(localPath)` only reads and reports.
- a separate repair/ensure action may create missing content directories when explicitly invoked by a user action that already implies mutation.

This removes the surprising behavior where selecting or validating a directory can create folders.

## New Local Repository

New local repository creation already stages into a temporary directory and refuses an existing target. Keep this behavior. It can reuse shared helpers for denied path checks, but it should not gain extra prompts.

## Knowledge Base Managed Runtime

Managed Knowledge Base creation remains allowed to copy the template into app-managed storage. This is not treated like user-selected repository initialization because the backing path is owned by Synapse and hidden from normal project browsing.

The existing rule remains: renderer UI must not expose the real backing directory. All raw/source operations continue to go through the Knowledge Base service APIs.

## Knowledge Base Raw File Operations

Keep the existing path boundary model:

- resolve every raw operation under `<managed-runtime>/.raw/`,
- reject path traversal,
- reject symlink components,
- skip symlink entries during listing,
- use system trash for deletion instead of permanent removal.

Add stricter operation reporting:

- log/audit `createFolder`, `uploadFiles`, `renameEntry`, `moveEntries`, and `trashEntries`,
- include project id, operation name, affected count, skipped count, and skipped reasons,
- avoid logging full user source paths when uploads are from outside managed storage; use basename/count where possible.

For batch trash and batch move in the renderer, users should see a concise confirmation when the selection contains directories or more than one item. The confirmation should list up to five relative paths and the remaining count. It should not mention implementation details or real backing paths.

## Security and Failure Handling

Repository initialization should use a main-process guard before mutating:

- verify the repository config is still present,
- verify the local path still resolves to the same directory,
- verify the current preview token matches,
- verify the path is not denied,
- write an audit/log event before and after mutation.

Knowledge Base raw operations should keep returning skipped entries for partial failures, but the service should log skipped reason summaries. Unexpected failures for the whole request should throw with context.

## Test Coverage

Repository tests should cover:

- non-empty initialization creates backup instead of deleting entries,
- changed directory contents invalidate a previously confirmed token,
- denied paths cannot be initialized,
- validation does not create missing content directories,
- empty directory initialization still creates the skeleton,
- failed backup creation does not partially scaffold.

Knowledge Base tests should cover:

- raw trash stays inside `.raw/`,
- symlink components are rejected for move/trash/rename,
- batch move rejects moving a directory into itself or a descendant,
- mutation result includes skipped entries without leaking full external paths,
- logging/audit hooks are called with operation summaries.

## Decisions

- Repository initialization backups live inside the selected directory as `.synapse-init-backup-YYYYMMDD-HHmmss/`.
- Obvious dangerous roots are hard rejected, including user home folders and the current Synapse source checkout.
- Non-empty non-Git directories may be initialized only through backup-based confirmation.
