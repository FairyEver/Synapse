# Drive Local Sync Design

Date: 2026-06-28
Scope: `server/`, `desktop/`, `shared/`, `docs/`

## Goal

Add Drive file and folder sync between a user's own Synapse Drive items and local filesystem paths. A user can bind a Drive file to a local file, or a Drive folder to a local folder, then keep both sides synchronized while Synapse is running.

The first version should feel like an automatic sync client, but it must avoid unsafe overwrite behavior. Normal additions, edits, moves, renames, and deletes sync automatically. Ambiguous conflicts pause only the affected paths and require an explicit user choice.

## Confirmed Product Decisions

- Sync is an ability of a Drive item, not a global feature that binds arbitrary remote and local paths.
- The first version supports only the user's own Drive files and folders.
- Shared items owned by other users are out of scope, even when the current user has edit permission.
- Sync runs while Synapse is running. When Synapse exits, sync pauses. On the next launch, Synapse catches up using remote changes and a local scan.
- Initial binding allows one side to contain content, or both sides when their included path/type trees and SHA-256 file hashes are exactly equal.
- A Drive file can bind to a local file path only when the local file does not already exist.
- A local file can bind to a new Drive file target only when the Drive target does not already exist.
- A Drive folder can bind to a new or empty local folder.
- A local folder can bind to a new Drive folder target.
- Existing non-empty content on both sides is not merged during initial binding.
- Deletes propagate automatically, but they go to a recoverable trash location instead of being permanently deleted.
- Conflicts pause the affected path and descendants while unrelated paths continue syncing.
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
  ├─ ownerUserId
  ├─ driveItemId
  ├─ localPath
  ├─ kind: file | folder
  ├─ status
  ├─ remoteCursor
  ├─ initialPhase / initialCursor
  ├─ baselineSnapshot
  ├─ excludeRules
  └─ lastSyncState
```

Binding status values:

- `initializing`: validating or transferring initial content before the baseline is complete.
- `active`: watching and syncing.
- `paused`: user or auth/path state paused the binding.
- `conflict`: at least one path requires user resolution.
- `error`: sync cannot proceed until the problem is fixed.
- `removed`: binding no longer runs, but files remain on both sides.

Running work is reported separately from the binding lifecycle, for example as operation status or aggregate progress. An `active` binding can have zero or more `pending`, `running`, `retry_wait`, `conflict`, or `error` operations.

Canceling a binding only stops synchronization. It does not delete local files or Drive items.

Bindings, baselines, operations, conflicts, retry work, and health are scoped to `ownerUserId`. Logout stops watchers, polling, and retries. An account switch restores only the new account's bindings. While logged out, the last account's bindings and local state remain visible but read-only. Offline state retains metadata without network work; reconnection pulls remote changes before scanning local changes.

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

Both sides already exist
  -> compare included path/type manifests
  -> download remote files with at most two concurrent downloads
  -> compare SHA-256 hashes and recheck both trees
  -> create baseline only when unchanged and exactly equal
```

Rejected cases:

```text
Local file exists + Drive file exists with different content
Local folder has content + Drive folder has different included content
Local file selected for Drive folder
Local folder selected for Drive file
Path outside the selected binding root during initialization
```

For folder initialization, exclude rules apply before upload, download, and baseline creation.

Initialization persists a remote cursor before transfer and advances through `transfer`, `reconcile`, and `replay`. A binding becomes `active` only after content transfer, baseline creation, and cursor replay all succeed. Restart recovery uses these fields rather than the presence of a root baseline. Local-to-remote recovery may adopt an already uploaded item only when exactly one candidate under the selected parent has the expected name, type, and complete content hash; ambiguous candidates become conflicts.

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

Forced rules cannot be disabled. Recommended default rules are enabled for new bindings and can be removed or edited. Existing bindings retain their stored choices when the schema changes.

When creating a folder binding, Synapse checks the binding root for `.gitignore`. Import is disabled by default. If enabled, the preview shows the original ordered rules before copying them into `importedGitignore`. Rules use standard gitignore matching, including negation, escaping, directory patterns, and wildcards. Future `.gitignore` edits do not automatically alter sync behavior.

Excluded paths are outside the sync tree:

- They are not uploaded.
- They are not downloaded.
- Their deletion is not propagated.
- They do not enter conflict records.
- They are not included in baseline snapshots.

Rule updates are serialized with sync work. Newly excluded paths are removed only from the baseline; neither side is deleted. Re-included paths go through a full three-way validation before automatic transfer.

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

The server retains change records for 90 days. A daily 02:30 cleanup deletes expired records and advances a global `purgedThroughSequence` watermark in the same transaction. An explicit non-empty cursor at or below that watermark returns `resyncRequired: true`; a client without a cursor can still read the retained range.

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

## Agent And MCP Entry Points

Synapse MCP exposes the existing desktop `DriveSyncService`; it does not implement a second sync engine. Public Drive sync capabilities cover snapshot, binding preview/create/pause/resume/remove, exclude-rule replacement, complete rescan, and explicit conflict resolution. Native path choosers, renderer events, and background polling are not public MCP tools.

Agent-facing binding inputs use a stable absolute `localPath` plus an explicit initial direction. `local_to_remote` derives file/folder kind and default Drive name from the local path, and an omitted `targetParentId` means Drive root. `remote_to_local` and `bind_existing` require an owned `driveItemId` and derive remote metadata from that item.

When an Agent receives only a Drive name or path, it resolves the owned item through the paginated Drive tree/list tools and asks the user to disambiguate multiple matches. Lifecycle requests similarly resolve a binding from the sync snapshot by binding id, normalized local path, or Drive metadata; ambiguous phrases such as “that project” never select an arbitrary binding.

The intended Agent workflow is:

```text
ordinary upload wording
  -> one-time file/folder upload

explicit sync wording + stable local path
  -> resolve requested Drive parent, defaulting to root
  -> inspect same-name remote items
  -> preview binding
  -> create binding only when preflight is not blocked
```

Temporary attachment paths and Agent caches cannot become sync roots. Multiple independent local roots create independent bindings sequentially; successful bindings are not rolled back when a later input fails. A same-name remote item is never overwritten by local-to-remote initialization. Exact same-kind content may use `bind_existing`; differing content or type requires a different name/location or an explicit user reconciliation decision.

A ready binding preview includes the initial transfer summary and at most 200 ordered file/folder entries. The complete count remains available when the list is truncated, so an Agent can explain the first upload/download before requesting high-risk creation approval without returning an unbounded payload. `bind_existing` returns an empty transfer plan because it validates existing content rather than transferring it.

Batch lifecycle and conflict requests are an Agent orchestration over the existing single-binding tools: resolve the full set first, execute sequentially, keep prior successes, and summarize partial failures. Changing a binding root, Drive target, or direction is intentionally not an in-place mutation; the Agent must disclose the non-atomic stop-and-recreate workflow, preserve editable rules, and never claim a failed replacement was migrated successfully.

Site republish language remains distinct from local Drive sync. Updating or synchronizing an existing published site uses its remembered source folder and republish flow unless the user explicitly requests a continuing relationship with a local filesystem path.

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

Drive sync schema v2 requires an owner on every binding and stores complete retry/recovery parameters on operations. Schema v3 adds `initialPhase` and `initialCursor`; v2 bindings, baselines, operations, conflicts, files, and stored exclude choices migrate in place. The older v1-to-v2 migration clears unsupported metadata and staging only. Neither migration reads, modifies, uploads, trashes, or deletes a bound local or Drive item.

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

Size and mtime can be used as a quick change detector. Watcher events force a hash refresh for affected paths. Startup, manual scans, recovery, full reconciliation, destructive decisions, conflict resolution, and interrupted-upload recovery use uncached SHA-256 content hashes. Remote overwrites and deletes re-hash the local target immediately before mutation and create a conflict if it changed.

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

A missing binding root is never treated as an ordinary automatic delete. It creates a root `delete_vs_modify` conflict. Keeping the existing side rebuilds the missing side. Confirming deletion moves the remaining side to trash and then removes the binding. Inaccessible paths, unmounted disks, and permission failures are errors rather than deletion evidence.

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

For a folder `keep_local`, the executor mirrors the complete non-excluded local subtree: it recreates a missing remote root, creates missing directories, updates files, and trashes remote-only included entries. Excluded entries are neither read nor changed. The root id and full subtree baseline are replaced only after every remote mutation succeeds.

While a conflict exists:

- Pause the conflicted path and descendants.
- Continue syncing unrelated paths in the same binding when safe.
- Do not auto-overwrite either side.
- Do not log raw conflict file content.

Before a remote move or rename, the executor reads the item's current parent and name and sends only the mutations that are still necessary. Echo suppression records and consumes the actual emitted move and rename events separately.

Conflict sides are persisted in one canonical shape: `exists`, `itemKind`, `pathHint`, `size`, `hash`, and remote `versionId`/`etag` when available. A compatibility reader accepts older `change`, `baseline`, `local`, `operation`, and direct `kind` records. Summaries, available actions, folder handling, and resolution all use that reader. Immediately before applying a resolution, Synapse rereads both sides and refreshes the conflict if identity, type, existence, or known content metadata changed.

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

- Watcher flushes, remote polls, manual scans, conflict resolutions, and retries share one FIFO queue per binding. A binding runs serially; different bindings can run concurrently.
- Duplicate pending events for the same path are coalesced when safe.
- Different bindings can run concurrently with a global limit.
- Large transfers expose progress and should not block unrelated small operations.
- Uploads use immutable staging snapshots under `userData`. Source size, mtime, and hash are checked before and after copying; upload length and baseline data come from the snapshot.
- Temporary network errors, HTTP 408/425/429/5xx, and EBUSY/EMFILE/ENFILE retry indefinitely while online and unpaused, using exponential backoff with ±20% jitter from 1 second to 5 minutes.
- Auth, missing local path, type mismatch, permission, quota, and unrecoverable local filesystem errors require user action.
- All running operations must settle into a final visible state.
- Startup changes inherited `running` work to `retry_wait`. A completed upload without a baseline is verified against the staged hash before the baseline is committed; an unverifiable result becomes a conflict or terminal error.
- Retryable and interrupted uploads retain their immutable staging snapshot. Recovery first looks up an already-created Drive item by durable id or exact parent/name/path, downloads it, and verifies the staged hash before deciding whether another upload is necessary.
- Operations persist each completed remote move, rename, or trash mutation immediately. Retry rereads the Drive item and skips substeps already reflected remotely.
- Pause, stop, logout, and account replacement abort the active request, invalidate queued work, and then run their lifecycle change exclusively. Interrupted transfers become `retry_wait`; stopping a binding waits for the current indivisible filesystem step to settle, then clears its operations, conflicts, baselines, and staging so no later side effect can start.
- Upload, download, folder transfer, and HTTP calls receive an `AbortSignal`. Aborted uploads cancel their server session, and temporary downloads are removed. Credential replacement waits up to five seconds for pre-identity-change listeners before continuing.

## Full Reconciliation

Initialization recovery, expired cursors, manual complete scans, and anomalous legacy initialization use the same three-way reconciliation:

```text
uncached local SHA-256 tree + downloaded remote SHA-256 tree + baseline
  -> identify moves by durable remote item id
  -> transfer one-sided additions and safe one-sided changes
  -> preserve equal two-sided additions as a new baseline
  -> create conflicts for ambiguous changes and delete-vs-modify cases
```

The scan records the current cursor before enumerating either tree, downloads remote files into an isolated verification directory with concurrency two, removes that directory afterward, then replays changes from the recorded cursor. A second `resyncRequired` during the same reconciliation is surfaced as an error instead of recursively scanning forever.

Each downloaded verification file is hashed and removed inside its worker before the next file is retained, so verification disk usage is bounded by download concurrency rather than the entire remote tree. Startup, reconnection, resume, periodic polling, watcher rescan requests, and retry use the same catch-up sequence: validate roots, scan local changes, pull remote changes while protecting those paths, apply safe remote work and cursor progress, then scan and upload remaining local changes.

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
  └─ actions: open local, open Drive, settings, pause, retry, complete scan
```

The UI should use existing shadcn/Radix components and Tailwind tokens. It should avoid explanatory marketing copy. Show initialization, running progress, retry count and next attempt, offline read-only state, conflicts, and terminal errors distinctly. An initializing binding must not be described as healthy or offer resume.

`DriveSyncSnapshotDto.health.connectivity` is always `online` or `offline`; offline and logged-out snapshots are read-only. Snapshot load failures remain distinct from an empty binding list. The status center can resolve a binding's Drive ancestry through the read-only `drive.item.get` bridge and open that folder in the existing Drive view without navigating to an external page.

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
- Collision checks normalize Unicode to NFC before case folding. Windows rejects reserved device names, invalid/control characters, and trailing spaces or periods before any local write.
- Upload snapshots verify every path component before and after opening, use `O_NOFOLLOW` for the final file, copy from one open file handle, and compare device/inode plus size, mtime, and hash before upload.
- Temporary transfer files are excluded from sync.
- Local deletes use system trash or a Synapse local trash area.
- Drive deletes use Drive trash.
- Conflict resolution requires an explicit user action.
- Account logout stops execution without changing another account's state. Permission changes, quota failures, or inaccessible local roots pause the binding or mark it as error.
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
- Accept two-sided existing files only when SHA-256 content matches; reject same-size mismatches and changes during validation.
- Accept two-sided non-empty folders only when included path/type trees and file hashes match; reject differences and changes during validation.
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
- Cursor expiration falls back to full local/remote/baseline reconciliation, followed by cursor replay.
- Network failure retries and eventually settles into visible state.
- Missing local root pauses safely.
- Missing watcher filenames and the 30-second poll request a full binding scan, so watcher loss eventually converges.
- Partial folder initialization trashes a newly-created remote root; if trashing fails, the binding retains the real root id and a visible recovery error.
- Upload completion response loss is recovered by remote identity/path plus staged hash without creating a duplicate.

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
- Folder move detection should start conservative. If identity proof is weak, surface confirmation instead of guessing.
- Shared-item sync should be treated as a later design because it changes ownership, delete propagation, permission expiry, and multi-user conflict behavior.
