# Synapse Content MCP API Reference

## Describe

`content_type_describe`

Parameters:

```json
{ "contentType": "rule" }
```

`contentType` is optional and can be `rule`, `skill`, or `prompt`.

Returns content categories, allowed icon values, allowed background colors, name constraints, and publishing constraints.

## List And Get

`content_rule_list`, `content_skill_list`, `content_prompt_list`

Parameters:

```json
{ "includeDeleted": false }
```

`content_rule_get`, `content_skill_get`, `content_prompt_get`

Parameters:

```json
{ "id": "content-id" }
```

Use `latestHistoryDirname` from `get` when updating or deleting.

## Create

`content_rule_create`

```json
{
  "name": "team-rule",
  "title": "Team Rule",
  "description": "Short description.",
  "category": "coding",
  "content": "# Rule body",
  "iconType": "icon",
  "icon": "wrench",
  "iconBg": "graphite"
}
```

Rule `name` may use lowercase letters, numbers, hyphens, and dots. It is limited to 64 characters, must start and end with a lowercase letter or number, and rejects Windows reserved names such as `con`, `aux`, `nul`, `com1`, or `lpt1`; the reserved segment before a dot is also rejected, so `con.rule` is invalid.

`content_skill_create`

```json
{
  "name": "team-skill",
  "title": "Team Skill",
  "description": "Short description.",
  "category": "development",
  "content": "# Skill body",
  "iconType": "icon",
  "icon": "wrench",
  "iconBg": "graphite",
  "files": [
    {
      "path": "references/guide.md",
      "contentText": "Guide content"
    }
  ]
}
```

Skill `name` may use only lowercase letters, numbers, and hyphens. It is limited to 64 characters, must start and end with a lowercase letter or number, and rejects Windows reserved names such as `con`, `aux`, `nul`, `com1`, or `lpt1`. Do not use dots; Synapse writes this value into the installed Skill directory and `SKILL.md` frontmatter.

`files` are attachments only. Do not include `SKILL.md` or `.synapse.json`; Synapse generates those install files from the Skill body and repository metadata.

To import an existing Skill directory:

```json
{
  "description": "Short description.",
  "iconType": "icon",
  "icon": "wrench",
  "iconBg": "graphite",
  "sourceDirectoryPath": "/absolute/path/to/skill"
}
```

`sourceDirectoryPath` imports the Skill main file and non-hidden attachments. Directory imports are limited to 100 files, 200 attachment directories, depth 8, 10MB per file, and 50MB total.

`content_prompt_create`

```json
{
  "title": "Prompt Title",
  "description": "Short description.",
  "category": "coding",
  "content": "Prompt body",
  "iconType": "icon",
  "icon": "file-text",
  "iconBg": "graphite"
}
```

## Update

`content_rule_update`, `content_skill_update`, `content_prompt_update`

Update payloads use the same fields as create, plus:

```json
{
  "id": "content-id",
  "baseHistoryDirname": "latestHistoryDirname-from-get"
}
```

Updates are rejected unless the current repository profile created the resource.

For `content_skill_update` with `sourceDirectoryPath`, omit appearance fields when you want to preserve the current built-in icon or image icon.

## Delete

`content_rule_delete`, `content_skill_delete`, `content_prompt_delete`

```json
{
  "id": "content-id",
  "baseHistoryDirname": "latestHistoryDirname-from-get"
}
```

Deletes are rejected unless the current repository profile created the resource.

## Image Icons

For image icons, use:

```json
{
  "iconType": "image",
  "iconImagePath": "/absolute/path/to/image.png"
}
```

or:

```json
{
  "iconType": "image",
  "iconImageBase64": "..."
}
```

Provide exactly one image input. The server validates the image and writes `icon.png`.
When updating a Skill from `sourceDirectoryPath` without changing the icon, do not send image input; the existing image icon is preserved.
