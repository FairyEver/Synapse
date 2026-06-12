# Knowledge Base Custom Storage Root Design

## Summary

Synapse will let users move all managed Knowledge Base runtime data to a single global custom storage root, such as `/Volumes/Data/SynapseData` or `D:\SynapseData`.

The feature preserves the managed black-box project model. Users still create a knowledge base by name, projects still expose `synapse-kb://<id>`, and Synapse still owns each runtime directory. The only configurable value is the global storage root. Actual runtime paths are always resolved as:

```text
<storage-root>/knowledge-bases/<runtimeId>/
```

The default storage root is the current Electron `userData` path, which keeps existing behavior for users who never change the setting.

## Product Decisions

- Use one global Knowledge Base storage root, not per-knowledge-base paths.
- Changing the root must migrate every existing managed runtime before the switch is committed.
- If migration fails, keep the old root and old data.
- If a custom root is unavailable, block Knowledge Base operations instead of silently falling back to the default root.
- After a successful migration and verification, move the old `knowledge-bases` directory to the system trash or recycle bin.
- If moving the old directory to trash fails after the new location is verified, keep the new location active and report that the old copy remains.
- If restoring the default location later finds that old default copy still present, preserve it by moving it to a timestamped backup directory before placing the current migrated data at the default `knowledge-bases` path.
- Do not expose an "open real folder" action, and do not show real runtime paths in project records.

## Goals

- Support users whose system disk does not have enough room for managed Knowledge Base data.
- Keep `synapse-kb://<id>` stable across migration.
- Keep Claude Code and Claude SDK loading the managed runtime assets from the resolved backing directory.
- Preserve relative links, wiki layout, `.raw/` sources, manifests, and runtime assets by moving the whole `knowledge-bases` tree.
- Make failure behavior conservative and recoverable.
- Keep storage-root changes auditable because they write outside default app data when a custom disk is selected.

## Non-Goals

- No arbitrary per-project backing path.
- No symlink, junction, or alias based migration.
- No automatic migration while Knowledge Base Agent sessions are active.
- No automatic fallback to default storage when a custom disk is missing.
- No automatic rewrite of wiki content, source files, manifests, or old absolute-path references.
- No change to ordinary project Agent conversations, Scheduler, or Workflow behavior.

## Hard Rules

- Renderer-visible project config must keep `path: "synapse-kb://<runtimeId>"`.
- Runtime directories must be derived from the configured global storage root and `runtimeId`.
- The storage root setting is global. It is not a project field.
- A custom root is a Synapse-managed storage root, not a visible user vault.
- The settings UI must not expose an action to open a managed runtime directory.
- Migration must be all-or-nothing from the user's perspective.
- A running Knowledge Base Agent session blocks migration.
- Migration must hold the app UI in a blocking modal until it completes, fails, or reaches a safely cancelled state.
- Cancellation is allowed only during copy and verification. It is disabled once configuration switching begins.
- Migration must be recoverable after a crash, power loss, or forced process termination.
- Custom-root unavailability blocks Knowledge Base create, raw/source management, and Knowledge Base Agent launch.
- When the configured custom root is unavailable, only re-detection is allowed. Moving to another root or restoring the default requires the source root to become readable again.
- Old absolute path references may be diagnosed, but must not be rewritten without a future explicit user action.

## Configuration Model

Add a global Knowledge Base storage configuration to the central config store. The value should represent either:

```ts
type KnowledgeBaseStorageConfig =
  | { mode: "default" }
  | { mode: "custom"; rootPath: string }
```

The resolver should compute:

```text
default mode: <userData>/knowledge-bases/<runtimeId>
custom mode: <rootPath>/knowledge-bases/<runtimeId>
```

Existing project records do not need migration because `runtimeId` already exists in project capabilities.

## Migration Transaction

Changing the root and restoring the default root use the same transaction:

1. Acquire a Knowledge Base storage migration lock.
2. Reject if any Knowledge Base Agent session is running or queued.
3. Inspect Knowledge Base source-manager windows:
   - reject migration if an upload, move, rename, create-folder, or trash operation is active,
   - close idle source-manager windows before migration.
4. Block new Knowledge Base creation, raw/source writes, source-manager operations, source-manager window opening, and Knowledge Base Agent launches.
5. Validate the target root:
   - path is absolute,
   - target is writable or can be created,
   - target is not the currently configured root,
   - target is not a dangerous system path,
   - target is not inside the current `knowledge-bases` tree,
   - target does not already contain a non-empty `knowledge-bases` directory that was not created by this migration,
   - exception: when restoring default storage and the default `knowledge-bases` directory still contains the old copy from a previous successful migration, move that directory aside as `knowledge-bases.backup-before-migration-<timestamp>` during the switch phase instead of overwriting it,
   - when free-space data is available, target space exceeds current runtime bytes plus the greater of 10% or 1 GB,
   - when free-space data is unavailable, record that the check is unknown and allow the guarded copy to proceed.
6. Persist a migration journal before copying.
7. Copy current `<old-root>/knowledge-bases` to a temporary directory under the target root.
8. Verify copied file counts and total size.
9. Verify each managed runtime has required files and directories:
   - `.claude-plugin/`
   - `skills/`
   - `commands/`
   - `CLAUDE.md`
   - `.raw/.manifest.json`
   - `wiki/index.md`
10. Atomically move the temporary copy into `<new-root>/knowledge-bases`.
11. Mark the journal as entering the non-cancellable switch phase.
12. Persist the new storage root configuration.
13. Resolve every managed project through the new root and verify the runtime is readable.
14. Mark the journal as new-root verified. The new root is now authoritative.
15. Move the old `<old-root>/knowledge-bases` directory to system trash or recycle bin.
16. Clear the migration journal and release the migration lock.

Cancellation handling:

- The migration exposes a cancellable state only during copy and verification.
- A cancellation request stops further copy or verification work, removes the target temporary directory best effort, keeps the old config and data, and resolves the migration as cancelled.
- Once atomic placement or config switching begins, the migration becomes non-cancellable through completion or rollback.
- The main process owns cancellation state. Closing or rerendering the settings page must not abandon a running migration.
- The renderer app shell subscribes to main-process migration state and owns the blocking dialog, so routing or settings-page unmounting cannot remove it.
- The existing app `before-quit` flow must check the migration gate before pending-push handling. While migration is active, it must not enter a timeout path that force-quits the app.

Crash recovery:

- The migration journal records the old root, target root, temporary path, current phase, whether config switching began, and whether the new root was verified. It must not contain document content or secrets.
- On startup, recovery runs before Knowledge Base operations are enabled.
- If interruption occurred before config switching, keep or restore the old config and remove the target temporary directory best effort.
- If interruption occurred after config switching but before new-root verification, verify the new root and every managed runtime. Keep the new config when verification succeeds; restore the old config when it fails.
- If interruption occurred after new-root verification, the new root remains authoritative. Recovery must not roll back to the old root because cleanup may already have moved it to trash. Resume or reconcile old-root cleanup and complete with a warning if the old copy remains.
- Recovery holds the same app-shell blocking dialog until it reaches a terminal success or failure state.

Failure handling:

- Before config persistence: leave config unchanged and keep old data.
- After config persistence but before final verification: restore the previous config and keep old data.
- Temporary directories are cleaned up best effort with structured warnings on cleanup failure.
- Old runtime data is never permanently deleted by the migration.
- Failure to trash the old directory after successful switch and verification does not roll back the new root. Complete with a warning that the old copy remains.
- Restore-default migration preserves any leftover old default copy by renaming it before installing the current copy; the active default `knowledge-bases` directory must contain the latest current data after the switch.

## Claude Code And Runtime Loading

Knowledge Base Agent sessions already resolve `synapse-kb://<id>` to a backing directory before launching Claude Code SDK. After this feature, the resolver must consult the current storage-root config.

Migration must not proceed while a Knowledge Base Agent session is active because Claude Code may be reading or writing the old runtime directory. After migration, new sessions load the same `.claude-plugin/`, skills, commands, hooks, scripts, and `CLAUDE.md` from the new backing directory.

Ordinary projects must not load Knowledge Base runtime files. Scheduler and Workflow retain the existing rule: they receive Knowledge Base behavior only when they explicitly target a managed Knowledge Base and use the project resolver.

## Link And Content Behavior

Relative Markdown links and runtime-relative references should continue working because the whole runtime tree is moved without changing internal layout.

Examples that should remain valid:

```text
../concepts/example.md
wiki/sources/_index.md
.raw/article.pdf
```

Absolute paths that point to the old backing directory may break after migration. The migration should not rewrite these references. Diagnostics may scan wiki and manifest text files for the old root prefix and report a concise warning so users understand why a manually written absolute link may no longer resolve.

## Settings UI

Add a restrained Knowledge Base storage section near project management:

- current storage root,
- `Change location`,
- `Restore default`.

The confirmation dialog for changing location should say that all knowledge bases will be migrated and Knowledge Base operations cannot run during migration. It should not explain implementation internals.

After migration starts, show a blocking migration dialog:

- Use the existing shadcn/Radix `Dialog` and shared `Progress` component.
- Mount the dialog at app-shell level and drive it from main-process migration state.
- Do not show a close button.
- Prevent closing through the overlay, `Esc`, routing, settings navigation, or window close.
- Intercept app quit requests while migration is active. A quit request should focus the migration dialog instead of hiding or closing the main window.
- Show one title, the current phase, progress where measurable, and one footer action.
- During copy and verification, the footer action is `Cancel migration`.
- During switching and cleanup, disable cancellation and show the current phase.
- After success, failure, or safe cancellation, replace the footer action with `Close`.
- Preserve keyboard focus inside the dialog and announce phase changes through accessible status semantics.

Progress states should be short:

- preparing,
- copying,
- verifying,
- switching,
- cleaning up.

Copy should show determinate progress when total bytes are known. Other phases may use the existing indeterminate treatment. Motion must communicate state only and respect reduced-motion behavior.

Errors should be actionable and concise:

- storage location is unavailable,
- target is not writable,
- target is unsafe,
- not enough disk space,
- a Knowledge Base session is running,
- a source operation is still running,
- migration failed and the old location is still in use.

When free space cannot be confirmed, show a warning before migration rather than treating it as an error.

Use `impeccable` product-UI guidance together with the existing shadcn/Radix settings components and theme tokens. Keep the dialog compact, familiar, and operational. Do not add custom colors, gradients, nested cards, ornamental motion, or explanatory marketing text.

## Diagnostics

Diagnostics should report:

- whether the Knowledge Base storage root is default or custom,
- whether the configured root is accessible,
- whether `<storage-root>/knowledge-bases` exists or can be created when appropriate,
- whether every managed runtime resolves and is readable,
- whether required runtime files exist,
- whether old absolute-root references were detected.

Diagnostics must be read-only. They must not rewrite wiki content, manifests, config, or runtime files.

When a custom root is unavailable, the settings surface should show only `Recheck`. `Change location` and `Restore default` stay unavailable because the source data cannot be migrated safely. The feature does not provide a destructive "start empty" recovery path.

## Security And Audit

Selecting a custom storage root and moving runtime data outside default `userData` are sensitive filesystem operations. Main-process handlers must use the existing `PermissionGuard` and `AuditSink` patterns for external writes and trash operations.

Audit metadata should include operation name, old root category, new root category, project count, copied byte count where available, and outcome. It should avoid logging source document contents or secrets. Real paths may be logged where existing filesystem audit policy allows them, but renderer errors should remain concise.

## Test Coverage

- Default resolver keeps existing `<userData>/knowledge-bases/<runtimeId>` behavior.
- Custom resolver uses `<custom-root>/knowledge-bases/<runtimeId>`.
- New managed Knowledge Base creation writes to the configured root.
- Target validation rejects relative paths, dangerous paths, and paths inside the current `knowledge-bases` tree.
- Selecting the currently configured root is treated as a no-op and does not start migration.
- Migration rejects when a Knowledge Base Agent session is running.
- Migration rejects while a source-manager mutation is active and closes idle source-manager windows.
- Source-manager windows cannot reopen during migration.
- Migration UI cannot be closed through overlay, `Esc`, navigation, window close, or app quit while work is active.
- The app-shell dialog survives settings-page unmounting and restores from main-process migration state after renderer reload.
- Existing before-quit timeout handling cannot force-quit during migration.
- Cancellation during copy or verification keeps old config and data and cleans up the target temporary directory best effort.
- Cancellation is disabled during switching and cleanup.
- Available-space validation requires runtime bytes plus the greater of 10% or 1 GB.
- Unknown free space allows migration with an explicit warning and still rolls back safely on copy failure.
- Startup recovery before config switching keeps the old root and cleans temporary data.
- Startup recovery after config switching but before verification keeps a verified new root or restores the old root.
- Startup recovery after new-root verification never rolls back and reconciles old-root cleanup.
- Copy failure keeps old config and old data.
- Verification failure keeps or restores old config and old data.
- Successful migration switches config, resolves all runtimes from the new root, and trashes the old `knowledge-bases` directory.
- Trash failure after a successful switch keeps the new root active and reports that the old copy remains.
- Restoring default after a trash failure preserves the old default copy in a timestamped backup and restores the current data to the default `knowledge-bases` directory.
- Custom-root unavailability blocks create, raw/source management, and Knowledge Base Agent launch.
- Custom-root unavailability exposes re-detection only and does not permit restore-default migration until the source returns.
- Claude Code session creation receives the new resolved backing directory after migration.
- Relative links remain unchanged.
- Old absolute path references are reported by diagnostics but not rewritten.
- Windows drive-letter paths and missing-drive behavior are covered with path-level tests.
- `pnpm --filter @synapse/desktop run check:hard-constraints` remains passing.
