# Synapse Resource Repository MCP

You have access to Synapse Resource Repository MCP tools for publishing and managing repository resources: Rules, Skills, and Prompts.

## Scope Boundary

Use this skill only for Synapse Resource Repository resources:

- Rules
- Skills
- Prompts

Do not use this domain file for database records, Automation schedules/items, workflow definitions, editor installation, provider settings, or general file editing. For another current Synapse MCP domain, return to `SKILL.md` for routing and read the matching `<domain>/index.md` attachment before using that domain's tools.

## Default Flow

1. Call `app_resource_repository_type_describe` before create or update to discover valid categories, icons, background colors, name constraints, and attachment constraints.
2. Choose the resource-specific tool group: `app_resource_repository_rule_*`, `app_resource_repository_skill_*`, or `app_resource_repository_prompt_*`.
3. For updates and deletes, call the matching `app_resource_repository_*_get` first and pass `latestHistoryDirname` as `baseHistoryDirname`.
4. When updating an existing local Skill directory, prefer `sourceDirectoryPath` instead of rebuilding its body and attachments with inline `files`. Omit appearance fields when the icon is unchanged.
5. After create, update, or delete, report the returned id, status, title, and latest history version. Distinguish a locally generated repository version from a remotely synchronized version, and claim a remote push only after its status is verified.

## Ownership Rules

Skills in the current writable Resource Repository are collaboratively editable. Any repository profile that can write the active repository may update an existing Skill, including a Skill created by another profile. The original `createdBy` remains unchanged and the new version records the current profile as its modifier.

Only the original creator may delete a Skill. Rule and Prompt updates and deletes also remain limited to their original creator. These Resource Repository rules do not change Cloud Skill Repository ownership.

Do not pass `force`; Resource Repository MCP does not support force update or force delete.

## Appearance Rules

For built-in icon backgrounds:

- Use `iconType: "icon"`.
- Choose `icon` and `iconBg` from `app_resource_repository_type_describe`.

For image backgrounds:

- Use `iconType: "image"`.
- Provide exactly one of `iconImagePath` or `iconImageBase64`.
- The MCP server validates the input as an image and center-crops/resizes it to a square PNG.
- When updating a Skill with `sourceDirectoryPath` and not changing the icon, omit appearance fields to preserve the current icon or image.

## Skill Attachments

For Skill resources, use one of these attachment modes:

- `files`: explicit attachment list with relative `path` and either `contentText` or `contentBase64`.
- `sourceDirectoryPath`: import an existing local Skill directory.

Do not provide both `files` and `sourceDirectoryPath`.

When using `files`, keep paths relative to the Skill root, such as `references/checklist.md`. Do not use absolute paths, path traversal, `SKILL.md`, runtime `.env` files, `.synapse.json`, or `.synapse.repository.json`. The server normalizes paths, rejects duplicates and Skill install control files, skips unsafe names from source directories, and enforces count and size limits.

When using `sourceDirectoryPath`, Synapse excludes `.env`, `.env.*` except the exact lowercase root filename `.env.example`, both Synapse identity files, other hidden entries, and symlinks. Case variants such as `.ENV.EXAMPLE` are runtime env-like files and are excluded without being read. Source directory imports are limited to 1,000 root entries, 100 files, 200 attachment directories, depth 8, 10MB per file, and 50MB total. Keep a root `.env.example` within the desktop installer's 1 MiB environment-file limit and 100-declaration limit. If frontmatter exists in the main file, use its metadata when the user has not provided explicit fields.

## Resource Fields

Rules, Skills, and Prompts all support optional `usage` text for concise usage guidance. Omit it when no separate usage guidance is needed.

Rules require:

- `name`
- `title`
- `description`
- `category`
- `content`
- appearance fields

Rule names and Skill names are normalized to lowercase and can be at most 64 characters. They must start and end with a lowercase letter or number. Rule names may use lowercase letters, numbers, hyphens, and dots; Windows reserved segments such as `con`, `aux`, `nul`, `com1`, and `lpt1` are rejected, including names like `con.rule`. Skill names may use only lowercase letters, numbers, and hyphens; do not use dots, and do not use Windows reserved names such as `con`, `aux`, `nul`, `com1`, or `lpt1`.

Skills require:

- `name`
- `title`
- `description`
- `category`
- `content` or `sourceDirectoryPath`
- appearance fields, except Skill updates with `sourceDirectoryPath` may omit them to preserve the current appearance
- optional attachments

Prompts require:

- `title`
- `description`
- `category`
- `content`
- appearance fields

## API Reference

See the attached `api-reference.md` for tool names, parameters, and mutation rules.
