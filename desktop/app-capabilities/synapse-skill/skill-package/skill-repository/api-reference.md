# Synapse Skill Repository MCP API Reference

## List

`app_skill_repository_list`

Parameters:

```json
{}
```

Returns cloud Skill repositories owned by the signed-in account.

This private read requires local content-read permission and writes a redacted audit outcome.

## Get

`app_skill_repository_get`

```json
{
  "repositoryId": "repo-id"
}
```

Returns repository metadata and files.

This private read requires local content-read permission and writes a redacted audit outcome without repository files or file contents.

## Import Local Skill

`app_skill_repository_import_local`

```json
{
  "sourceDirectoryPath": "/absolute/path/to/skill",
  "name": "team-skill",
  "title": "Team Skill",
  "description": "Short description.",
  "openInBrowser": false
}
```

`sourceDirectoryPath` is required. Pass the exact path; whitespace-only input is invalid and Synapse does not trim a valid path. The other fields are optional. If `name`, `title`, or `description` is omitted, Synapse uses Skill metadata or local defaults where available.

Use this for the first upload of a local Skill folder. The source root is limited to 1,000 entries. Synapse excludes runtime `.env` files, `.synapse.json`, `.synapse.repository.json`, other hidden entries, and symlinks. Keep root `.env.example` within 1 MiB so Desktop can inspect and materialize its declarations during installation. If local `.synapse.repository.json` contains a cloud Skill repository id, the tool can update that repository instead of creating a new one. Cloud mutation permission and audit target that effective repository id; `skill-repository:new` is checked only for an actual create, including a separate fallback after a stale local identity is not found. The identity file must be an ordinary non-symlink file inside the Skill directory and no larger than 64 KiB; Synapse checks and audits the read, and stops before any cloud update if the identity is untrusted, oversized, or changes while being read. Legacy cloud identity in `.synapse.json` follows the same limit and checks and remains compatible until the next successful upload migrates it. If another process changes `.synapse.repository.json` while the upload is running, Synapse preserves that newer local identity instead of overwriting it.

Returns the repository id, repository name, owner handle, management URL, and local identity write status:

```json
{
  "repositoryId": "repo-id",
  "name": "team-skill",
  "owner": "liyang",
  "managementUrl": "https://synapse.example/console/skill-repositories/repo-id",
  "identityWritten": true,
  "identityMigrated": false,
  "sourceImportSummary": {
    "fileCount": 3,
    "totalBytes": 2048,
    "runtimeEnvExcluded": true,
    "controlFilesExcluded": [".synapse.json"],
    "hiddenEntryCount": 1,
    "symlinkCount": 0
  }
}
```

If `identityWritten` is false, the cloud upload succeeded but Synapse could not write `.synapse.repository.json` locally. This includes a source directory that was removed or changed and a concurrent local identity change detected after the cloud upload started. Synapse does not recreate a missing source directory. The result may include `identityWriteError`. `identityMigrated` reports successful legacy identity migration; cleanup problems appear as `identityMigrationWarning` without changing the successful cloud upload result.

For every tool with `openInBrowser`, external opening is best-effort. If the result contains `openWarning`, the primary operation already succeeded; do not retry a mutation just to reopen the link. Use the returned `managementUrl`, `publicUrl`, or `deepLinkUrl` manually.

## Update Local Skill

`app_skill_repository_update_local`

```json
{
  "repositoryId": "repo-id",
  "sourceDirectoryPath": "/absolute/path/to/skill",
  "name": "team-skill",
  "title": "Team Skill",
  "description": "Short description.",
  "openInBrowser": false
}
```

`repositoryId` and `sourceDirectoryPath` are required. Use this when the user has confirmed which cloud repository should be replaced by the local Skill folder. Cloud mutation permission and audit target this repository id before the account service call.

The response uses the same shape as `app_skill_repository_import_local`, including `identityWritten`.

## Set Visibility

Visibility changes, forks, and install-session creation require local content-mutation permission and write a redacted audit outcome before or after the cloud action. Denied permission prevents the account service call.

`app_skill_repository_set_visibility`

```json
{
  "repositoryId": "repo-id",
  "visibility": "public",
  "openInBrowser": false
}
```

`repositoryId` and `visibility` are required. `visibility` must be `private` or `public`.

Returns the updated repository and its management URL. The browser opens only when `openInBrowser` is true.

```json
{
  "repository": {
    "id": "repo-id",
    "name": "team-skill",
    "title": "Team Skill",
    "visibility": "public",
    "status": "active"
  },
  "managementUrl": "https://synapse.example/console/skill-repositories/repo-id"
}
```

## Open Management URL

`app_skill_repository_open`

```json
{
  "repositoryId": "repo-id",
  "openInBrowser": true
}
```

Returns the Dashboard management URL. The browser opens only when `openInBrowser` is true.

## Open Public URL

`app_skill_repository_open_public`

```json
{
  "repositoryId": "repo-id",
  "openInBrowser": true
}
```

Or, when the public path is already known:

```json
{
  "ownerHandle": "liyang",
  "repositoryName": "team-skill",
  "openInBrowser": false
}
```

Returns `publicUrl`, `ownerHandle`, `repositoryName`, and `repositoryId` when a repository id was used. The browser opens only when `openInBrowser` is true.

When `repositoryId` is used, resolving the private repository requires local content-read permission and writes a redacted audit outcome. Supplying an already known `ownerHandle` and `repositoryName` does not read the private repository.

## Fork

`app_skill_repository_fork`

```json
{
  "repositoryId": "repo-id",
  "name": "team-skill-copy",
  "title": "Team Skill Copy"
}
```

`repositoryId` is required. `name` and `title` are optional. Returns the new repository detail and its management URL when available.

## Create Install Session

`app_skill_repository_create_install_session`

```json
{
  "repositoryId": "repo-id",
  "openInBrowser": false
}
```

Returns a short-lived install session:

```json
{
  "id": "install-session-id",
  "repositoryId": "repo-id",
  "repositoryName": "team-skill",
  "ownerHandle": "liyang",
  "title": "Team Skill",
  "packageSha256": "64-char-sha256",
  "packageSize": 1234,
  "expiresAt": "2026-07-02T12:00:00.000Z",
  "deepLinkUrl": "synapse://skill-install?session=install-session-id"
}
```

Use `deepLinkUrl` to open Synapse Desktop installation. The URL is short-lived and installs the latest repository content packaged for that session.


## Common Errors

- `USER_HANDLE_REQUIRED`: the signed-in user must manually set a username in the Synapse console.
- `SKILL_REPOSITORY_NAME_CONFLICT`: another repository already uses the requested name under the same owner, or the name is reserved by a previous rename.
- `SKILL_REPOSITORY_INVALID_SKILL`: the folder or files do not satisfy Skill repository rules.
- `SKILL_REPOSITORY_FORBIDDEN`: the signed-in user cannot read or mutate the target repository.
- `SKILL_REPOSITORY_INSTALL_SESSION_NOT_FOUND`: the install session does not exist, expired, or was already consumed.
- `SKILL_REPOSITORY_LEGACY_FORK_SOURCE_MISSING`: legacy migration could not find the copied Skill source, so the migrated repository is independent.
