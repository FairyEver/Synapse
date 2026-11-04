# Skill Hub MCP API 参考

由 `node desktop/scripts/docs/generate-skill-hub-reference.mjs` 从工具输入定义生成。公开入口只有 search 和 invoke。操作流程与返回值见 [Skill Hub 指南](index.md)。

## app_skill_hub_skill_list

List current team Skills in Synapse Skill Hub (团队 Skill 目录、搜索), optionally filtered by team, creator and store text. Pagination: cursor-based. Continue with nextCursor until null; restart after filters or account change. Permissions: network.connect; current account only.

```json
{
  "type": "object",
  "properties": {
    "cursor": {
      "type": "string",
      "minLength": 1,
      "maxLength": 2048
    },
    "limit": {
      "type": "integer",
      "exclusiveMinimum": 0,
      "maximum": 100
    },
    "teamId": {
      "type": "string",
      "pattern": "^[A-Za-z0-9_-]{1,128}$"
    },
    "createdByMe": {
      "type": "boolean"
    },
    "query": {
      "type": "string",
      "maxLength": 200
    }
  },
  "required": [],
  "additionalProperties": false
}
```

## app_skill_hub_skill_get

Read one team Skill from Synapse Skill Hub using exactly one skillId or trusted Console detail reference. Returns package name, package description, current version, revision and maintenance permissions; no package bytes. Permissions: network.connect; current account only.

```json
{
  "type": "object",
  "properties": {
    "skillId": {
      "type": "string",
      "pattern": "^[A-Za-z0-9_-]{1,128}$"
    },
    "reference": {
      "type": "string",
      "minLength": 1,
      "maxLength": 2048
    }
  },
  "required": [],
  "additionalProperties": false
}
```

## app_skill_hub_team_list

List only my active teams for Synapse Skill Hub upload (本人团队、选择上传团队). Use selectionState none/single/multiple across all memberships; only single has defaultTeamId. Pagination: cursor-based. Continue with nextCursor until null; do not infer team count from the current page. Permissions: network.connect; current account only.

```json
{
  "type": "object",
  "properties": {
    "cursor": {
      "type": "string",
      "minLength": 1,
      "maxLength": 2048
    },
    "limit": {
      "type": "integer",
      "exclusiveMinimum": 0,
      "maximum": 100
    }
  },
  "required": [],
  "additionalProperties": false
}
```

## app_skill_hub_package_download

Verify and export the latest team Skill into a new absolute local destinationDirectory. Never overwrites an existing directory. Optional expectedVersionId only checks the current version. Permissions: network.connect; fs.write.outside-userdata; current account only.

```json
{
  "type": "object",
  "properties": {
    "skillId": {
      "type": "string",
      "pattern": "^[A-Za-z0-9_-]{1,128}$"
    },
    "destinationDirectory": {
      "type": "string",
      "maxLength": 8192
    },
    "expectedVersionId": {
      "type": "string",
      "pattern": "^[A-Za-z0-9_-]{1,128}$"
    }
  },
  "required": [
    "skillId",
    "destinationDirectory"
  ],
  "additionalProperties": false
}
```

## app_skill_hub_package_prepare

Check a local Skill directory, Markdown or ZIP for team publication (准备、检查打包). Returns an account/team/caller-bound preparedSourceId, package fields, file manifest, fingerprint and warnings, without ZIP/Base64. No team means no file read; multiple teams require an explicit teamId. Permissions: network.connect; fs.read.outside-userdata when reading local files; current account only.

```json
{
  "type": "object",
  "properties": {
    "sourcePath": {
      "type": "string",
      "maxLength": 8192
    },
    "teamId": {
      "type": "string",
      "pattern": "^[A-Za-z0-9_-]{1,128}$"
    }
  },
  "required": [
    "sourcePath"
  ],
  "additionalProperties": false
}
```

## app_skill_hub_skill_create

Publish a complete prepared Skill to the explicit team (上传、首次发布). Optional displayName/displayDescription/iconPath are store metadata. Use a stable requestId; after a lost result query the original receipt. Permissions: network.connect; fs.read.outside-userdata when reading local files; current account only.

```json
{
  "type": "object",
  "properties": {
    "teamId": {
      "type": "string",
      "pattern": "^[A-Za-z0-9_-]{1,128}$"
    },
    "preparedSourceId": {
      "type": "string",
      "pattern": "^[A-Za-z0-9_-]{1,128}$"
    },
    "displayName": {
      "type": "string",
      "maxLength": 200
    },
    "displayDescription": {
      "type": "string",
      "maxLength": 4000
    },
    "iconPath": {
      "type": "string",
      "maxLength": 8192
    },
    "requestId": {
      "type": "string",
      "pattern": "^[A-Za-z0-9_-]{1,128}$"
    }
  },
  "required": [
    "teamId",
    "preparedSourceId",
    "requestId"
  ],
  "additionalProperties": false
}
```

## app_skill_hub_version_create

Publish a complete new package for a maintained team Skill (更新 Skill、上传新版), using expectedVersionId from a fresh read and a stable requestId. Identical current content is unchanged. Store metadata is preserved. Permissions: network.connect; current account only.

```json
{
  "type": "object",
  "properties": {
    "skillId": {
      "type": "string",
      "pattern": "^[A-Za-z0-9_-]{1,128}$"
    },
    "preparedSourceId": {
      "type": "string",
      "pattern": "^[A-Za-z0-9_-]{1,128}$"
    },
    "expectedVersionId": {
      "type": "string",
      "pattern": "^[A-Za-z0-9_-]{1,128}$"
    },
    "requestId": {
      "type": "string",
      "pattern": "^[A-Za-z0-9_-]{1,128}$"
    }
  },
  "required": [
    "skillId",
    "preparedSourceId",
    "expectedVersionId",
    "requestId"
  ],
  "additionalProperties": false
}
```

## app_skill_hub_skill_update

Update only store display name, introduction, or icon from a local image path, with expectedRevision and stable requestId. Omit to keep; iconPath null clears the icon. Package fields and team cannot change here. Permissions: network.connect; fs.read.outside-userdata when reading local files; current account only.

```json
{
  "type": "object",
  "properties": {
    "expectedRevision": {
      "type": "integer",
      "exclusiveMinimum": 0,
      "maximum": 9007199254740991
    },
    "requestId": {
      "type": "string",
      "pattern": "^[A-Za-z0-9_-]{1,128}$"
    },
    "displayName": {
      "type": "string",
      "maxLength": 200
    },
    "displayDescription": {
      "type": "string",
      "maxLength": 4000
    },
    "skillId": {
      "type": "string",
      "pattern": "^[A-Za-z0-9_-]{1,128}$"
    },
    "iconPath": {
      "anyOf": [
        {
          "type": "string",
          "maxLength": 8192
        },
        {
          "type": "null"
        }
      ]
    }
  },
  "required": [
    "expectedRevision",
    "requestId",
    "skillId"
  ],
  "additionalProperties": false
}
```

## app_skill_hub_skill_delete

Soft-delete a specifically identified maintained team Skill using expectedRevision and stable requestId. All package versions remain retained. Ordinary users cannot restore. Permissions: network.connect; current account only.

```json
{
  "type": "object",
  "properties": {
    "expectedRevision": {
      "type": "integer",
      "exclusiveMinimum": 0,
      "maximum": 9007199254740991
    },
    "requestId": {
      "type": "string",
      "pattern": "^[A-Za-z0-9_-]{1,128}$"
    },
    "skillId": {
      "type": "string",
      "pattern": "^[A-Za-z0-9_-]{1,128}$"
    }
  },
  "required": [
    "expectedRevision",
    "requestId",
    "skillId"
  ],
  "additionalProperties": false
}
```

## app_skill_hub_receipt_get

Check a write receipt (查验结果、断线恢复、回执) with the original action and requestId under the original account. A not_found result does not prove failure; never change the key to retry. Permissions: network.connect; current account only.

```json
{
  "type": "object",
  "properties": {
    "action": {
      "type": "string",
      "enum": [
        "app.skill_hub.skill.create",
        "app.skill_hub.version.create",
        "app.skill_hub.skill.update",
        "app.skill_hub.skill.delete"
      ]
    },
    "requestId": {
      "type": "string",
      "pattern": "^[A-Za-z0-9_-]{1,128}$"
    }
  },
  "required": [
    "action",
    "requestId"
  ],
  "additionalProperties": false
}
```
