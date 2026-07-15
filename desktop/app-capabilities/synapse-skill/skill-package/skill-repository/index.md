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

1. For an existing local Skill folder, call `app_skill_repository_import_local` with `sourceDirectoryPath`.
2. The local folder must contain root `SKILL.md`. Synapse excludes runtime `.env` files, both identity files, other hidden entries, and symlinks; excluded runtime env files are not read.
3. If the upload succeeds, Synapse attempts to write `.synapse.repository.json` through its local permission and audit boundary. Check `identityWritten`; if it is false, the cloud upload succeeded but the local folder was not linked.
4. For later updates, prefer `app_skill_repository_update_local` when the target `repositoryId` is known. `app_skill_repository_import_local` uses `.synapse.repository.json` when present. A legacy cloud identity in `.synapse.json` remains readable and migrates after a successful upload without overwriting a normal Resource Repository identity.
5. Use `app_skill_repository_set_visibility` when the user explicitly wants a repository to become private or public.
6. Use `app_skill_repository_open` to get the management URL. It opens the user's browser only when `openInBrowser` is true.
7. Use `app_skill_repository_open_public` to get the public page URL for a public repository.
8. Use `app_skill_repository_fork` when the user wants their own editable copy of a readable repository.
9. Use `app_skill_repository_create_install_session` when the user wants to install a readable Skill into Synapse Desktop. The response contains a short-lived `deepLinkUrl`.

Installing a Skill uses an install session and Desktop deep link. Downloading an individual repository file is a web UI action, not an MCP install flow.

## Identity Rules

Cloud repository identity is stable by repository id. Do not infer updates from same repository name alone.

If a create upload conflicts by name, tell the user a repository with that name already exists. To update it, they must confirm the target repository id and use `app_skill_repository_update_local`; to create a separate repository, choose a different name.

Repository names use lowercase letters, numbers, and hyphens. They must start and end with a letter or number, cannot contain dots, and cannot use Windows reserved names such as `con`, `aux`, `nul`, `com1`, or `lpt1`.

If the server returns `USER_HANDLE_REQUIRED`, ask the user to set a username in the Synapse console. Do not generate, set, or change the username automatically.

Public URLs use `/skills/<ownerHandle>/<repositoryName>`. If a user or repository is renamed, the web app can redirect old paths where the server still has redirect records.


Migrated legacy Skill copies can keep their fork source when the source Skill was also migrated. If the legacy source was not migrated, the copied Skill remains usable as an independent repository.

Admin removal only hides or restores public Skill repositories from the public surface. It is not a publish review, approval, featured, rating, or release workflow.

## Safety

Uploading reads only publishable local files and writing `.synapse.repository.json` modifies the local Skill folder. These actions go through Synapse permission and audit checks. A denied write permission stops the cloud upload before mutation; a later filesystem write failure is returned as `identityWritten: false`.

Changing visibility, forking, and creating an install session also pass the local content-mutation permission boundary before the cloud action and record allowed, denied, or failed audit outcomes. Audit records do not include install session or deep-link values.

Do not upload arbitrary project folders as Skills. Use a folder that is intended to be a Skill and contains root `SKILL.md`.

Forking and creating install sessions require a signed-in account. Installing consumes the latest repository content; do not promise historical versions or release selection.

## API Reference

See the attached `api-reference.md` for tool signatures and response fields.
