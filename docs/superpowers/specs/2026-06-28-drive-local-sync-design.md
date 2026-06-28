# Drive Local Sync Design

Date: 2026-06-28
Scope: `server/`, `desktop/`, `shared/`, `docs/`

## Goal

Add Drive file and folder sync between a user's own Synapse Drive items and local filesystem paths. A user can bind a Drive file to a local file, or a Drive folder to a local folder, then keep both sides synchronized while Synapse is running.

The first version should feel like an automatic sync client, but it must avoid unsafe overwrite behavior. Normal additions, edits, moves, renames, and deletes sync automatically. Ambiguous conflicts pause and require an explicit user choice.

## Confirmed Product Decisions

- Sync is an ability of a Drive item, not a global feature that binds arbitrary remote and local paths.
- The first version supports only the user's own Drive files and folders.
- Shared items owned by other users are out of scope, even when the current user has edit permission.
- Sync runs while Synapse is running. When Synapse exits, sync pauses. On the next launch, Synapse catches up using remote changes and a local scan.
- Initial binding allows only one side to already contain content.
- A Drive file can bind to a local file path only when the local file does not already exist.
- A local file can bind to a new Drive file target only when the Drive target does not already exist.
- A Drive folder can bind to a new or empty local folder.
- A local folder can bind to a new Drive folder target.
- Existing non-empty content on both sides is not merged during initial binding.
- Deletes propagate automatically, but they go to a recoverable trash location instead of being permanently deleted.
- Conflicts pause and require user resolution.
- Move and rename are first-class sync operations, not merely delete plus create.
- `.git/` is always excluded and cannot be enabled by users.
- Git commands are never run by Drive sync. Syncing a Git repository root affects only worktree files.
- Synapse default exclude rules apply to each binding and can be edited, except forced rules.
- When creating a folder binding, Synapse can offer to import `.gitignore` rules once into that binding's exclude rules. Later `.gitignore` changes do not automatically change sync behavior.
- Drive rows expose sync actions and state. A top-level sync status center summarizes all bindings, conflicts, errors, and active work.

## Non-Goals

- Do not sync items shared by other users in the first version.
- Do not keep syncing after Synapse exits.
- Do not implement initial two-sided folder merge.
- Do not implement Git commit, branch, pull, push, or conflict operations.
- Do not sync `.git/`.
- Do not expose a raw storage key, signed URL, auth header, or internal object path in UI, MCP responses, logs, or audit details.
- Do not silently overwrite either side when both sides changed from the same baseline and the relationship cannot be proven.
- Do not add a global Drive sync exclude setting as the primary configuration surface. Exclude rules belong to a binding.

## Product Model

Drive sync introduces a `SyncBinding` between one Drive item and one local path.

```text
Drive item
  ├─ file
  └─ folder
       │
       v
SyncBinding
  ├─ driveItemId
  ├─ localPath
  ├─ kind: file | folder
  ├─ status
  ├─ remoteCursor
  ├─ baselineSnapshot
  ├─ excludeRules
  └─ lastSyncState
```

Binding status values:

- `active`: watching and syncing.
- `paused`: user or auth/path state paused the binding.
- `conflict`: at least one path requires user resolution.
- `error`: sync cannot proceed until the problem is fixed.
- `removed`: binding no longer runs, but files remain on both sides.

Running work is reported separately from the binding lifecycle, for example as operation status or aggregate progress. An `active` binding can have zero or more `pending`, `running`, `retry_wait`, `conflict`, or `error` operations.

Canceling a binding only stops synchronization. It does not delete local files or Drive items.

## Initial Binding Rules

Initial binding establishes a shared baseline. It does not merge two independent histories.

```text
Drive file exists + local file does not exist
  -> download Drive file
  -> create baseline
  -> start sync

Local file exists + Drive target does not exist
  -> upload local file
  -> create Drive item and baseline
  -> start sync

Drive folder exists + local folder is new or empty
  -> download folder tree
  -> create baseline
  -> start sync

Local folder exists + Drive target does not exist
  -> upload folder tree
  -> create Drive folder and baseline
  -> start sync
```

Rejected cases:

```text
Local file exists + Drive file exists
Local folder has content + Drive folder has content
Local file selected for Drive folder
Local folder selected for Drive file
Path outside the selected binding root during initialization
```

For folder initialization, exclude rules apply before upload, download, and baseline creation.

## Exclude Rules

Exclude rules are stored on each binding.

```text
SyncBinding.excludeRules
  ├─ forced
  │   ├─ .git/
  │   ├─ Synapse sync temporary files
  │   └─ in-progress transfer files
  ├─ defaults
  │   ├─ node_modules/
  │   ├─ vendor/
  │   ├─ dist/
  │   ├─ build/
  │   ├─ coverage/
  │   ├─ .cache/
  │   ├─ .tmp/
  │   ├─ .DS_Store
  │   └─ *.log
  ├─ importedGitignore
  └─ userRules
```

Forced rules cannot be disabled. Default rules can be removed or edited.

When creating a folder binding, Synapse checks the binding root for `.gitignore`. If present, the binding flow offers to import the rules into `importedGitignore`. Imported rules become ordinary binding rules. Future `.gitignore` edits do not automatically alter sync behavior.

Excluded paths are outside the sync tree:

- They are not uploaded.
- They are not downloaded.
- Their deletion is not propagated.
- They do not enter conflict records.
- They are not included in baseline snapshots.

## Architecture

Use a server-side Drive change log plus a desktop-side watcher and sync engine.

```text
                 ┌─────────────────────┐
                 │ Drive Change Log     │
                 │ server-side cursor   │
                 └──────────┬──────────┘
                            │
                            v
┌──────────────┐     ┌──────────────┐     ┌────────────────┐
│ Local Watcher│ --> │ Sync Engine  │ --> │ Drive API       │
│ fs events    │     │ desktop main │     │ upload/download │
└──────────────┘     └──────┬───────┘     └────────────────┘
                            │
                            v
                    ┌──────────────┐
                    │ Sync Store   │
                    │ DataRepo     │
                    └──────────────┘
```

The server records remote Drive changes as facts. The desktop sync engine decides what to do by comparing remote state, local state, and the binding baseline.

## Server Drive Change Log

Drive mutations should write ordered change records. The client stores a cursor and asks for changes after that cursor.

Suggested `DriveChange` shape:

```ts
type DriveChange = {
  id: string
  sequence: string
  userId: string
  itemId: string
  parentId: string | null
  type:
    | "created"
    | "content_updated"
    | "renamed"
    | "moved"
    | "trashed"
    | "restored"
    | "deleted"
  versionId?: string | null
  etag?: string | null
  name?: string
  pathHint?: string
  actor?: string | null
  occurredAt: string
}
```

Change log requirements:

- Changes are scoped by user.
- Cursors are monotonic and stable enough for catch-up after app restart.
- Item ids remain the durable identity for files and folders.
- Rename and move are represented explicitly.
- Content changes include enough version or etag information for baseline comparison.
- Storage implementation details are never exposed.

The change log does not need to keep data forever. It must either retain enough history for normal desktop catch-up or report that a full remote rescan is required.

## Desktop Sync Service

Add a main-process Drive sync owner.

```text
DriveSyncService
  ├─ BindingManager
  │   ├─ createBinding
  │   ├─ pauseBinding / resumeBinding
  │   ├─ updateExcludeRules
  │   └─ removeBinding
  ├─ LocalWatcher
  │   ├─ watch active folder bindings
  │   └─ debounce filesystem events
  ├─ RemoteChangePoller
  │   └─ pull Drive changes by cursor
  ├─ SyncPlanner
  │   └─ baseline + local + remote -> operations/conflicts
  ├─ SyncExecutor
  │   ├─ upload / download
  │   ├─ move / rename
  │   ├─ trash / restore
  │   └─ update baseline
  └─ ConflictManager
      └─ resolveConflict
```

The renderer does not access the sync store directly. Renderer entry points call IPC methods, and the main process owns local file access, permission checks, audit, and synchronization.

## Local Data

Use DataRepository namespaces for local sync state.

```text
app.drive-sync.bindings       sqlite
app.drive-sync.baseline       sqlite
app.drive-sync.conflicts      sqlite
app.drive-sync.operations     sqlite
app.drive-sync.events         jsonl or sqlite
app.drive-sync.settings       json
```

All records include `schemaVersion`.

Baseline entries should store enough identity to avoid relying only on timestamps:

```ts
type BaselineEntry = {
  bindingId: string
  relativePath: string
  kind: "file" | "folder"
  remoteItemId: string
  remoteVersionId?: string | null
  remoteEtag?: string | null
  localSize?: number
  localMtimeMs?: number
  localHash?: string | null
  lastSyncedAt: string
  deletedAt?: string | null
}
```

Hashing can be lazy. Size and mtime can be used as a quick check, but destructive decisions and conflict resolution should compute content hashes when needed.

## Change Planning

The planner compares local state, remote state, and baseline.

```text
local current + remote current + baseline
        │
        v
only local changed       -> upload / rename / move / trash remote
only remote changed      -> download / rename / move / trash local
neither changed          -> skip
both changed, same source proven
                          -> update baseline
both changed, source unclear
                          -> conflict
```

The planner must prefer a safe pause over a guessed overwrite.

## Move And Rename

Move and rename preserve identity.

```text
Local same file identity: a.md -> docs/a.md
  -> Drive remoteItemId moves or renames

Drive same item id: docs/a.md -> archive/a.md
  -> local file moves or renames
```

The first version can infer local identity from baseline plus a combination of:

- content hash,
- size,
- nearby filesystem events,
- previous path,
- binding-relative path changes.

If identity cannot be proven, the planner creates a confirmation or conflict state instead of treating the event as an automatic move.

## Delete Behavior

Deletes propagate, but do not permanently destroy content.

```text
Local delete
  -> move Drive item to Drive trash
  -> update baseline as deleted
  -> keep recoverable status

Remote trash
  -> move local path to system trash or Synapse local trash
  -> update baseline as deleted
  -> keep recoverable status
```

If local trashing fails, do not permanently delete. Put the binding or path into `error` and ask the user to handle it.

If Drive trashing fails because of auth, quota, permission, or network state, keep the local deletion event pending only when safe. Otherwise pause the path and show the failure in the status center.

## Conflict Model

Conflict types:

```text
content-content      both sides edited the same file
path-path            both sides moved or renamed the same item differently
delete-local-edit-remote
delete-remote-edit-local
create-create        both sides created the same relative path differently
identity-uncertain   possible move/rename cannot be proven
```

Suggested record:

```ts
type SyncConflict = {
  id: string
  bindingId: string
  relativePath: string
  type: string
  localSnapshot: Record<string, unknown>
  remoteSnapshot: Record<string, unknown>
  availableActions: Array<"keep_local" | "keep_remote" | "keep_both" | "confirm_delete">
  createdAt: string
  resolvedAt?: string | null
}
```

Resolution actions:

- `keep_local`: upload the local state as the remote current version and update baseline.
- `keep_remote`: download the remote state over the local path and update baseline.
- `keep_both`: create a conflict copy for one side, bring both files into the sync tree, and update baseline.
- `confirm_delete`: propagate the delete after explicit user confirmation.

While a conflict exists:

- Pause the conflicted path and descendants.
- Continue syncing unrelated paths in the same binding when safe.
- Do not auto-overwrite either side.
- Do not log raw conflict file content.

## Sync Operations And Retry

Represent work as operations.

```text
pending -> running -> succeeded
              │
              ├-> retry_wait
              ├-> conflict
              └-> error
```

Rules:

- Same binding and same relative path run serially.
- Different bindings can run concurrently with a global limit.
- Large transfers expose progress and should not block unrelated small operations.
- Network and temporary server failures can retry with backoff.
- Auth, missing local path, type mismatch, permission, quota, and unrecoverable local filesystem errors require user action.
- All running operations must settle into a final visible state.

## UI Entry Points

Drive item rows:

```text
not bound
  └─ sync to this computer

bound
  ├─ sync settings
  ├─ pause / resume
  ├─ open local path
  └─ stop syncing
```

Drive row status labels:

```text
未同步
同步中
已同步
已暂停
有冲突
需要处理
```

Top-level sync status center:

```text
Drive 同步
  ├─ active binding count
  ├─ running operation count
  ├─ conflict count
  ├─ error count
  └─ actions: open local, open Drive, settings, pause, retry
```

The UI should use existing shadcn/Radix components and Tailwind tokens. It should avoid explanatory marketing copy. Show state, next action, and necessary labels only.

## Permission, Audit, And Safety

Creating a binding must:

- require an authenticated account,
- verify the Drive item belongs to the current user,
- verify the local path is allowed and accessible,
- verify the initial binding rule,
- show the local root path that will be written,
- record an audit event.

Runtime safeguards:

- Local writes are confined to the binding root.
- Path traversal and symlink escapes are rejected.
- Temporary transfer files are excluded from sync.
- Local deletes use system trash or a Synapse local trash area.
- Drive deletes use Drive trash.
- Conflict resolution requires an explicit user action.
- Account logout, item loss, permission changes, quota failures, or missing local roots pause the binding or mark it as error.
- Baseline and conflict records are retained until the user removes the binding or resolves conflicts.

## Git Repository Behavior

Drive sync treats a Git repository as a normal directory tree with a forced `.git/` exclusion.

```text
Git repository root binding
  ├─ .git/          forced excluded
  ├─ .gitignore     normal file unless excluded by user rule
  ├─ docs/prd.md    syncable
  ├─ assets/a.png   syncable
  └─ dist/          default excluded unless user enables it
```

Drive sync never runs:

- `git add`,
- `git commit`,
- `git pull`,
- `git push`,
- branch operations,
- merge or rebase operations.

If a remote Drive change updates a file inside a Git worktree, Git may show an ordinary local worktree change. That is expected and is not managed by Drive sync.

## Testing Focus

Initial binding:

- Drive file to missing local file.
- Local file to new Drive target.
- Drive folder to empty local folder.
- Local folder to new Drive target.
- Reject two-sided existing files.
- Reject two-sided non-empty folders.
- Apply exclude rules during initialization.

Conflict:

- Both sides edit the same file.
- Local delete and remote edit.
- Remote delete and local edit.
- Both sides rename differently.
- Both sides create the same path with different content.
- Unproven move or rename becomes `identity-uncertain`.
- Resolve by keeping local, keeping remote, and keeping both.

Delete:

- Local delete moves Drive item to trash.
- Remote trash moves local path to recoverable trash.
- Local trash failure becomes error and does not permanently delete.
- Drive trash failure becomes retry or error.

Git repository:

- `.git/` is always excluded.
- Worktree files sync normally.
- No Git command is invoked.
- Imported `.gitignore` rules are copied once and then managed independently.

Recovery:

- Local changes made while Synapse was closed are detected on restart.
- Remote changes made while Synapse was closed are pulled by cursor.
- Cursor expiration falls back to remote rescan.
- Network failure retries and eventually settles into visible state.
- Missing local root pauses safely.

## Implementation Phases

Phase 1: infrastructure

- Add Drive change log and cursor API.
- Add sync DataRepository schemas.
- Add binding lifecycle IPC.
- Add status center shell integration.

Phase 2: file sync

- Bind Drive file to local path.
- Bind local file to new Drive target.
- Sync content changes.
- Trash deletes safely.
- Create and resolve file conflicts.

Phase 3: folder sync

- Initialize folder trees.
- Add local watcher.
- Add remote cursor catch-up.
- Support move and rename.
- Add binding exclude rule management.
- Add optional one-time `.gitignore` import.

Phase 4: hardening

- Add transfer progress, backoff, and limits.
- Expand conflict UI.
- Add large-directory performance tests.
- Add recovery and failure diagnostics.
- Reserve permission hooks for future shared-item sync.

## Open Implementation Notes

- The final local trash implementation can use the operating system trash when available, with a Synapse local trash fallback for unsupported or failing cases.
- The Drive change log retention window should be chosen with server storage cost in mind. The client must handle cursor expiration with a full rescan.
- Folder move detection should start conservative. If identity proof is weak, surface confirmation instead of guessing.
- Shared-item sync should be treated as a later design because it changes ownership, delete propagation, permission expiry, and multi-user conflict behavior.
