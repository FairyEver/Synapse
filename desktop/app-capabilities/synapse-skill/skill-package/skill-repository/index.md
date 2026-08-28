# Synapse Skill Repository MCP

Use these tools when the user wants to upload, update, list, inspect, fork, install, or open cloud Skill repositories.

## Scope

This domain is for cloud Skill Repository only:

- `app_skill_repository_list`
- `app_skill_repository_get`
- `app_skill_repository_import_local`
- `app_skill_repository_update_local`
- `app_skill_repository_set_visibility`
- `app_skill_repository_open`
- `app_skill_repository_open_public`
- `app_skill_repository_fork`
- `app_skill_repository_create_install_session`

Do not use these tools for local Resource Repository Rules, local Resource Repository Prompts, Drive files, or direct editor installation.

Skill Repository stores Skills only. Rules and prompt sharing are intentionally not part of this domain. There is no release, rollback, version selection, or team co-editing flow.

## Default Flow

1. For an existing local Skill folder, call `app_skill_repository_import_local` with the exact `sourceDirectoryPath`; whitespace-only input is invalid and Synapse does not trim a valid path.
2. The local folder must contain root `SKILL.md` and no more than 1,000 entries per directory. Synapse excludes runtime `.env` files, both identity files, other hidden entries, and symlinks; excluded runtime env files are not read. Keep root `.env.example` within 1 MiB so Desktop can inspect and materialize its declarations during installation.
3. If the upload succeeds, Synapse rechecks that the local source still matches the uploaded snapshot, then attempts to write `.synapse.repository.json` through its local permission and audit boundary. Check `identityWritten`; if it is false, the cloud upload succeeded but the local folder was not linked. A removed or changed source directory and a concurrent local identity change are preserved as recoverable local-association failures.
4. For later updates, prefer `app_skill_repository_update_local` when the target `repositoryId` is known. `app_skill_repository_import_local` uses `.synapse.repository.json` when present. Identity files must be ordinary non-symlink files inside the Skill directory and no larger than 64 KiB; identity reads use the local permission and audit boundary, and an untrusted or oversized identity stops the upload before any cloud update. Cloud mutation permission and audit use the effective repository id resolved from this identity; `new` is used only for an actual create. Synapse rechecks the current identity immediately before replacing it, so a later request cannot overwrite a newer local association. A legacy cloud identity in `.synapse.json` remains readable under the same limit and migrates after a successful upload without overwriting a normal Resource Repository identity.
5. Use `app_skill_repository_set_visibility` when the user explicitly wants a repository to become private or public.
6. Use `app_skill_repository_open` to get the management URL. It opens the user's browser only when `openInBrowser` is true.
7. Use `app_skill_repository_open_public` to get the public page URL for a public repository.
8. Use `app_skill_repository_fork` when the user wants their own editable copy of a readable repository.
9. Use `app_skill_repository_create_install_session` when the user wants to install a readable Skill into Synapse Desktop. The response contains a short-lived `deepLinkUrl`.

`openInBrowser` is best-effort. If a successful result includes `openWarning`, the upload, visibility change, URL resolution, or install-session creation already succeeded; do not repeat the mutation. Use the returned `managementUrl`, `publicUrl`, or `deepLinkUrl` manually.

Installing a Skill uses an install session and Desktop deep link. Downloading an individual repository file is a web UI action, not an MCP install flow.

## Identity Rules

Cloud repository identity is stable by repository id. Do not infer updates from same repository name alone.

If a create upload conflicts by name, tell the user a repository with that name already exists. To update it, they must confirm the target repository id and use `app_skill_repository_update_local`; to create a separate repository, choose a different name.

When an owner deletes their own repository in the web console, the deletion is permanent and the name becomes available for that owner immediately. An administrator removing a public repository is a reversible moderation action, so that repository keeps its name reserved until it is restored or otherwise permanently removed.

Repository names use lowercase letters, numbers, and hyphens. They must start and end with a letter or number, cannot contain dots, and cannot use Windows reserved names such as `con`, `aux`, `nul`, `com1`, or `lpt1`.

If the server returns `USER_HANDLE_REQUIRED`, ask the user to set a username in the Synapse console. Do not generate, set, or change the username automatically.

Public URLs use `/skills/<ownerHandle>/<repositoryName>`. If a user or repository is renamed, the web app can redirect old paths where the server still has redirect records.


Migrated legacy Skill copies can keep their fork source when the source Skill was also migrated. If the legacy source was not migrated, the copied Skill remains usable as an independent repository.

Admin removal only hides or restores public Skill repositories from the public surface. It is not a publish review, approval, featured, rating, or release workflow.

## Safety

Listing or reading private Skill repositories, including resolving a public URL from a private `repositoryId`, requires local content-read permission and records an allowed, denied, or failed audit outcome. These audit records contain the capability action, source, and repository id when available, but never repository files or file contents. Opening a public URL from an already known `ownerHandle` and `repositoryName` does not read the private repository.

Uploading reads only publishable local files and writing `.synapse.repository.json` modifies the local Skill folder. These actions go through Synapse permission and audit checks. The cloud mutation check targets the repository selected from the explicit input or trusted local identity, and a stale identity that falls back to creation receives a separate `new` check. A denied write permission stops the cloud upload before mutation; a later source-directory change, filesystem write failure, or concurrent identity conflict is returned as `identityWritten: false` without recreating the folder or overwriting newer local state.

Changing visibility, forking, and creating an install session also pass the local content-mutation permission boundary before the cloud action and record allowed, denied, or failed audit outcomes. Audit records do not include install session or deep-link values.

Do not upload arbitrary project folders as Skills. Use a folder that is intended to be a Skill and contains root `SKILL.md`.

Forking and creating install sessions require a signed-in account. Installing consumes the latest repository content; do not promise historical versions or release selection.

## API Reference

See the attached `api-reference.md` for tool signatures and response fields.
