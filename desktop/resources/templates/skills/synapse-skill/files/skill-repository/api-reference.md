# Synapse Skill Repository MCP API Reference

## List

`app_skill_repository_list`

Parameters:

```json
{}
```

Returns private cloud Skill repositories for the signed-in account.

## Get

`app_skill_repository_get`

```json
{
  "repositoryId": "repo-id"
}
```

Returns repository metadata and files.

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

`sourceDirectoryPath` is required. The other fields are optional. If `name`, `title`, or `description` is omitted, Synapse uses Skill metadata or local defaults where available.

Use this for the first upload of a local Skill folder. If local `.synapse.json` already contains a cloud Skill repository id, the tool can update that repository instead of creating a new one.

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

`repositoryId` and `sourceDirectoryPath` are required. Use this when the user has confirmed which cloud repository should be replaced by the local Skill folder.

## Open Management URL

`app_skill_repository_open`

```json
{
  "repositoryId": "repo-id",
  "openInBrowser": true
}
```

Returns the Dashboard management URL. The browser opens only when `openInBrowser` is true.

## Common Errors

- `USER_HANDLE_REQUIRED`: the signed-in user must manually set a username in the Synapse console.
- `SKILL_REPOSITORY_NAME_CONFLICT`: another repository already uses the requested name under the same owner, or the name is reserved by a previous rename.
- `SKILL_REPOSITORY_INVALID_SKILL`: the folder or files do not satisfy Skill repository rules.
