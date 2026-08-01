# Git Sync Manager Design

## Context

Synapse content repositories are used by teams as shared Rule / Skill / Prompt stores. The current repository file design already reduces many file-level conflicts: content updates append a new `history/<timestamp>__<user>__<random>/` directory instead of rewriting a shared main file.

The main product risk is not ordinary file conflict. The risk is that Git operations can feel stuck, repeated entry points can show inconsistent state, and users may not know whether their local work is saved, waiting to sync, blocked by network, or blocked by repository configuration.

## Goals

- Keep normal content creation, editing, and restore flows local-first: if local write and Git commit succeed, the user sees a saved result even when remote push is slow or unavailable.
- Centralize all Git sync state, retry behavior, and user-facing sync messages in one owner.
- Show Git-related status in one top-right status center instead of scattering duplicate notices across pages.
- Prevent indefinite `syncing` states. Every Git operation must settle into `synced`, `pending`, `offline`, or `attention`.
- Preserve team safety for high-risk operations such as delete and purge.

## Non-Goals

- Do not redesign the content repository file format.
- Do not build a visual conflict editor in this phase.
- Do not add a Git hosting integration or a dependency on a specific remote provider.
- Do not auto-resolve divergent branches beyond the existing safe `pull --rebase` retry path.
- Do not expose raw Git output as product UI copy.

## Existing Code Observations

- `content-write-service.ts` writes append-only history directories with timestamp, user id, and random suffixes.
- `content-submission-service.ts` already commits changes and records `pending_pushes`.
- `content/ipc.ts` currently owns `backgroundPushStates`, which makes background push state local to one IPC module.
- `App.tsx` currently keeps an `isOffline` flag and classifies network errors locally.
- `repository-git-service.ts` handles manual `git pull --ff-only` sync and progress events.
- `git-error-utils.ts` formats common Git failures but returns UI messages directly instead of a reusable typed category.
- `SyncStatusChip` already provides the right top-right location for a centralized status entry.

## Architecture

Add a main-process `RepositorySyncCoordinator` as the only owner of repository sync execution and sync state.

Responsibilities:

- Track one execution loop per repository.
- Read and update pending push metadata, while treating Git upstream/ahead state as the source of truth for whether commits remain unpushed.
- Start push, pull, sync, maintenance, and recovery attempts through existing services.
- Merge duplicate requests from multiple entry points.
- Classify Git failures.
- Schedule retry attempts for recoverable failures.
- Emit one unified sync snapshot per repository.

Renderer-side `RepositoryManager` remains the only consumer and distributor of repository sync snapshots. UI components read status from `RepositoryManager`; they do not classify Git errors, infer offline state, or maintain background push state.

Existing IPC modules should only submit intent:

- Content create/update/restore/delete/purge handlers request push or sync from the coordinator.
- Repository manual sync and flush handlers call the coordinator.
- App quit handling calls the coordinator for pending push flush or summary.

## Sync Snapshot

Each repository gets one `RepositorySyncSnapshot`.

Core fields:

- `repositoryUuid`
- `status`: `synced | syncing | pending | offline | attention`
- `operation`: `push | pull | sync | maintenance | initialize | null`
- `phase`: `preparing | running | retry-wait | blocked | completed`
- `pendingCount`
- `pendingItems`
- `message`
- `detail`
- `failureCategory`
- `lastAttemptAt`
- `nextRetryAt`
- `retryCount`
- `canRetryNow`
- `primaryAction`

All toolbar labels, popover copy, toast copy, and settings summaries come from this snapshot.

## Error Categories

Replace scattered string checks with a centralized classifier that returns a typed category plus user-facing message metadata.

Categories:

- `network`: DNS, unreachable network, connection reset, failed connect.
- `timeout`: any remote Git timeout.
- `auth`: credential, SSH key, permission denied.
- `upstream-missing`: no upstream or tracking branch.
- `diverged`: non-fast-forward, rejected, rebase conflict, divergent branch.
- `missing-path`: local repository path disappeared.
- `not-git`: selected directory is not a Git repository.
- `ignored-paths`: content path ignored by `.gitignore`.
- `git-missing`: `git` command unavailable.
- `no-changes`: nothing to commit.
- `unknown`: fallback, with raw Git detail kept in logs.

Retry policy:

- `network` and `timeout` are recoverable and eligible for automatic retry.
- `auth`, `upstream-missing`, `diverged`, `missing-path`, `not-git`, `ignored-paths`, and `git-missing` require user action.
- `unknown` does not loop automatically unless the coordinator can prove it came from a transient remote operation.

## Execution Model

Per repository, the coordinator owns a single execution loop.

Request types:

- `requestPush(repositoryUuid, reason)`
- `requestSync(repositoryUuid, reason)`
- `requestRecovery(repositoryUuid, reason)`
- `flushOrReportAll()`

Rules:

- If no operation is running, the coordinator starts the requested operation.
- If an operation is already running, the coordinator records `rerunRequested` and does not start another Git process.
- After a push finishes, if pending items still exist or `rerunRequested` is true, the coordinator starts another pass.
- Manual sync first flushes pending local commits. If there are no pending commits, it pulls remote updates.
- Push failures caused by remote being ahead trigger `pull --rebase` then push retry.
- All remote Git operations use a shared timeout.
- Every running operation must emit a final snapshot.
- Git System App and content-repository mutations share a FIFO lock keyed by the normalized local Git root. A running lock is released only from the owning operation's `finally` path; elapsed time never force-releases it.
- Content create, update, delete, restore, purge, maintenance, pending enqueue, and push hold that real-root lock across the complete mutation transaction. Public lock-owning entry points are separate from internal already-locked entry points; nested `skipLock` modes are not allowed.
- Diverged content sync may retry with ordinary `pull --rebase`, but it must not use a merge strategy that silently selects either side. If the rebase started by this attempt conflicts, abort that rebase, preserve the pre-rebase worktree state, stop before push, and enter `attention`.

Retry:

- Recoverable failures schedule `nextRetryAt` with capped backoff.
- Manual retry bypasses `nextRetryAt`.
- App launch, network recovery, and repository switch may trigger recovery checks.

## Operation Policy

Normal content operations:

- Create, update, and restore are local-first.
- If local write and commit succeed, return saved.
- Push failure records pending state and sync snapshot. It does not turn the save into a failure.
- Automatic commits normalize repository-relative paths and use literal pathspecs plus path-limited commits. They never consume unrelated entries already present in the user's index.
- Existing repository/global identity is used only when both `user.name` and `user.email` are configured. Otherwise a complete Synapse Bot identity is supplied to that commit command only; repository configuration is never rewritten.
- If the commit succeeds but pending metadata cannot be recorded, return `recovery-needed`: the content is locally saved, and reload recovers pending state from Git ahead/local-only commits.

High-risk operations:

- Delete and purge should keep the current remote check behavior before mutation.
- If remote is unavailable, do not silently perform destructive offline work in this phase.
- A future phase can add explicit offline delete drafts, but that is out of scope here.

Initialization:

- Repository initialization may enqueue its commit if push fails.
- Its push and retry state should also be owned by the coordinator.

## UI Design

Use the top-right shell action area as the single Git status center.

Entry states:

- `已同步`
- `同步中`
- `N 条待同步`
- `网络不可用`
- `需要处理`

Clicking the entry opens a small detail panel. Use existing shadcn UI primitives such as `Popover` or `Sheet`, following the current Radix/shadcn baseline.

Opening the panel is read-only. It must not start a network operation by itself.

Panel content:

- Current repository name.
- Current status message.
- Next step, if any.
- Pending count and pending items.
- Last attempt time.
- Next automatic retry time.
- Failure reason if blocked.
- Actions: `立即同步`, `打开仓库设置`, and a context-specific action when useful.

Other UI surfaces:

- Content create/edit/detail flows show minimal save feedback only.
- Settings can show basic repository connection status, but detailed Git state should link back to or reuse the status center.
- Sync-related toasts use messages from `RepositorySyncSnapshot` and do not format Git errors themselves.

## Boundary Cases

- Multiple save entry points fire at once: merge into one coordinator execution loop.
- Repeated sync clicks: merge, do not spawn concurrent Git commands.
- App exits after commit but before the pending row is durable: reload compares `HEAD` with its upstream, or with all remotes when no upstream exists, and restores a pending snapshot.
- Network flaps: leave `syncing`, move to `offline` or `pending`, and retry later.
- Remote ahead: attempt `pull --rebase` then push.
- Rebase conflict or divergent branch: move to `attention`; tell user to resolve with their Git tool.
- Authentication failure: move to `attention`; no automatic retry loop.
- Upstream missing: move to `attention`; tell user to configure upstream.
- Repository directory missing: move to `attention`; point to repository settings.
- Pending push database damage: do not block content reading; report sync status needs repair.
- Switching active repository: show the active repository snapshot while preserving other repositories' pending state.
- Quitting with pending pushes: show one pending summary and call coordinator if user chooses to sync first.

## Data Changes

Extend pending push metadata to support recovery and status display:

- `last_attempt_at`
- `next_retry_at`
- `last_error_category`

Keep the existing fields:

- `commit_hash`
- `action`
- `target_id`
- `title`
- `created_at`
- `retry_count`
- `last_error`

The migration must preserve existing pending rows.

## Implementation Slices

1. Add shared repository sync types and centralized Git failure classifier.
2. Extend pending push storage with retry metadata.
3. Add `RepositorySyncCoordinator` and move background push ownership out of `content/ipc.ts`.
4. Route content and repository IPC handlers through the coordinator.
5. Add unified snapshot events and renderer `RepositoryManager` snapshot state.
6. Replace `App.tsx` local offline state and scattered pending dialogs with the top-right Git status center.
7. Add tests and remove duplicate status formatting.

## Testing

Unit tests:

- Git failure classifier maps known Git outputs to categories.
- Pending push storage migrates existing rows and preserves ordering.
- Coordinator merges duplicate requests for one repository.
- Coordinator emits final snapshots after success, timeout, network failure, auth failure, and divergence.
- Retry scheduling only applies to recoverable categories.

IPC/service tests:

- Content create/update/restore schedule coordinator push after pending enqueue.
- Pre-staged unrelated paths remain staged and absent from automatic content commits for create, update, delete, rename, and special-character paths.
- A real same-line divergence stops on conflict, preserves both commits, and leaves no Synapse-started rebase behind.
- Pending metadata write failure and commit-before-exit recovery are detected from Git ahead/local-only state.
- Same-root mutations serialize for the full file-write/commit/enqueue transaction while different roots remain independent.
- Delete/purge still perform remote checks before destructive mutation.
- Manual sync flushes pending pushes before pull.
- App quit pending flow uses coordinator-owned flush behavior.

Renderer tests:

- `RepositoryManager` exposes one sync snapshot source.
- Toolbar status center renders `synced`, `syncing`, `pending`, `offline`, and `attention`.
- Content pages do not independently infer offline or pending state.

Verification commands:

- `pnpm --filter @synapse/desktop run check:hard-constraints`
- `pnpm --filter @synapse/desktop run test`

## Acceptance Criteria

- There is no independent `backgroundPushStates` owner outside the coordinator.
- There is no local `isOffline` sync state in `App.tsx`.
- Git status messages shown in the app come from the centralized snapshot.
- Normal create/update/restore saves are not blocked by remote push failure after local commit succeeds.
- Recoverable remote failures do not leave the UI stuck in `syncing`.
- The top-right status center is the primary place to inspect Git sync state.
- Opening the status center does not trigger a sync by itself.
