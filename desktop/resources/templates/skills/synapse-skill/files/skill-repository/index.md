# Synapse Skill Repository MCP

Use these tools when the user wants to upload, update, list, inspect, or open private cloud Skill repositories.

## Scope

This domain is for cloud Skill Repository only:

- `app_skill_repository_list`
- `app_skill_repository_get`
- `app_skill_repository_import_local`
- `app_skill_repository_update_local`
- `app_skill_repository_open`

Do not use these tools for local Resource Repository Rules, local Resource Repository Prompts, Drive files, editor installation, public Explore, fork, or public install flows.

Phase 1 cloud Skill Repository is private-only. Public browsing, fork, install links, web file editing, history, releases, rollback, and team editing are not available through these tools.

## Default Flow

1. For an existing local Skill folder, call `app_skill_repository_import_local` with `sourceDirectoryPath`.
2. The local folder must contain root `SKILL.md`. The tool uploads `SKILL.md` and non-hidden attachments.
3. If the upload succeeds, Synapse attempts to write `.synapse.json` into the local Skill folder through its local permission and audit boundary. Check `identityWritten`; if it is false, the cloud upload succeeded but the local folder was not linked.
4. For later updates, prefer `app_skill_repository_update_local` when the target `repositoryId` is known. `app_skill_repository_import_local` can also use the local `.synapse.json` cloud identity when present.
5. Use `app_skill_repository_open` to get the management URL. It opens the user's browser only when `openInBrowser` is true.

## Identity Rules

Cloud repository identity is stable by repository id. Do not infer updates from same repository name alone.

If a create upload conflicts by name, tell the user a repository with that name already exists. To update it, they must confirm the target repository id and use `app_skill_repository_update_local`; to create a separate repository, choose a different name.

Repository names use lowercase letters, numbers, and hyphens. They must start and end with a letter or number, cannot contain dots, and cannot use Windows reserved names such as `con`, `aux`, `nul`, `com1`, or `lpt1`.

If the server returns `USER_HANDLE_REQUIRED`, ask the user to set a username in the Synapse console. Do not generate, set, or change the username automatically.

## Safety

Uploading reads local files and writing `.synapse.json` modifies the local Skill folder. These actions go through Synapse permission and audit checks. A denied write permission stops the cloud upload before mutation; a later filesystem write failure is returned as `identityWritten: false`.

Do not upload arbitrary project folders as Skills. Use a folder that is intended to be a Skill and contains root `SKILL.md`.

## API Reference

See the attached `api-reference.md` for tool signatures and response fields.
